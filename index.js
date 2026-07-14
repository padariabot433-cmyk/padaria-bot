import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import qrcode from 'qrcode';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';

import { connectDB, Order, Customer } from './src/db.js';
import { useMongoAuthState } from './src/authState.js';
import { handleMessage } from './src/orderFlow.js';
import { adminAuth } from './src/adminAuth.js';
import { menuRouter } from './src/menuRoutes.js';
import { startDailyReminder } from './src/dailyReminder.js';
import { startWeeklyBackup } from './src/backup.js';
import { createBotInstanceId, acquireBotLock, refreshBotLock, releaseBotLock } from './src/botLock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const app = express();

// Logs de diagnóstico (mensagem recebida, JID @lid, etc). Fica desligado em
// produção por padrão — ligue com DEBUG_LOGS=true no Render se precisar investigar algo.
const DEBUG_LOGS = process.env.DEBUG_LOGS === 'true';
function debugLog(...args) {
  if (DEBUG_LOGS) console.log(...args);
}

// Só avisa no log — não bloqueia o app, mas ajuda a evitar senha fácil de adivinhar
function checkPasswordStrength(password) {
  if (!password) return;
  const isWeak = password.length < 8 || /^(123456|senha|padaria|admin|password)$/i.test(password);
  if (isWeak) {
    console.log('⚠️ ADMIN_PASSWORD parece fraca (curta ou muito comum). Considere trocar por algo mais forte.');
  }
}
checkPasswordStrength(process.env.ADMIN_PASSWORD);

app.use(express.urlencoded({ extended: true })); // para ler os formulários do painel
app.use(express.json());

// CORS restrito: só o domínio do painel (GitHub Pages) pode chamar a API.
// Isso PRECISA vir antes de qualquer rota, pra responder o preflight (OPTIONS)
// com os headers certos independentemente de senha/autenticação.
const ALLOWED_ORIGIN = process.env.SITE_ORIGIN || 'https://padariabot433-cmyk.github.io';

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

let latestQR = null;
let connectionStatus = 'iniciando';
const botInstanceId = createBotInstanceId();
let botLockRefresh = null;
let hasBotLock = false;

// Contadores simples pra monitorar o bug do @lid sem precisar de logs de debug ligados.
// Zeram a cada restart do serviço (é só um pulso de "isso ainda tá acontecendo?").
const stats = {
  startedAt: new Date(),
  lidContacts: 0,
  messagesReceived: 0,
};

// Backoff crescente pra reconexão: evita martelar o WhatsApp se a conexão
// cair várias vezes seguidas. Zera assim que a conexão fica estável de novo.
let reconnectAttempts = 0;
const BASE_RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 60000;

// Serve a página de redirecionamento (index.html da raiz)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve o painel (header.html, controls.html, summary.html, index.html)
// protegido pela mesma senha
app.use('/site', adminAuth, express.static(path.join(__dirname, 'site')));

// Status simples do bot
app.get('/status', (req, res) => {
  const uptimeMin = Math.floor((Date.now() - stats.startedAt.getTime()) / 60000);
  res.send(
    `Bot da padaria está no ar. Status da conexão: ${connectionStatus}\n\n` +
      `Desde o último restart (${uptimeMin} min atrás):\n` +
      `Mensagens recebidas: ${stats.messagesReceived}\n` +
      `Contatos via @lid: ${stats.lidContacts}`
  );
});

// O painel antigo (/pedidos) foi aposentado — quem tiver o link salvo
// é redirecionado automaticamente pro painel atual em /site.
app.get('/pedidos', (req, res) => {
  res.redirect('/site/index.html');
});

// API do cardápio, usada pelo editor dentro do painel (/site)
app.use('/api/menu', adminAuth, menuRouter);

app.get('/api/orders', adminAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      await connectDB();
    }

    const { limit = 50, status, day } = req.query;
    const query = {};

    if (status) {
      query.status = status;
    }

    if (day) {
      const start = new Date(day);
      start.setHours(0, 0, 0, 0);
      const end = new Date(day);
      end.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: start, $lte: end };
    }

    const orders = await Order.find(query).sort({ createdAt: -1 }).limit(Number(limit));
    res.json(orders);
  } catch (error) {
    console.error('Erro ao buscar pedidos:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/orders/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};
    const allowed = ['customerName', 'customerJid', 'address', 'status', 'items', 'total'];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    if (updates.status && !['pendente', 'devendo', 'ok', 'confirmado', 'entregue', 'cancelado'].includes(updates.status)) {
      return res.status(400).json({ error: 'Status inválido.' });
    }

    if (updates.items && !Array.isArray(updates.items)) {
      return res.status(400).json({ error: 'Itens devem ser um array.' });
    }

    if (updates.items && !updates.total) {
      updates.total = updates.items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }

    Object.assign(order, updates);
    await order.save();

    // Se o número (JID) do pedido foi corrigido no painel, propaga essa
    // correção para o cadastro do cliente — assim o bot passa a reconhecer
    // esse número da próxima vez (repetir pedido, cache de nome, etc).
    if (updates.customerJid) {
      await Customer.findOneAndUpdate(
        { jid: updates.customerJid },
        {
          jid: updates.customerJid,
          name: order.customerName || undefined,
          updatedAt: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    res.json(order);
  } catch (error) {
    console.error('Erro ao editar pedido:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/orders/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const order = await Order.findByIdAndDelete(id);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }
    res.json({ deleted: true });
  } catch (error) {
    console.error('Erro ao excluir pedido:', error);
    res.status(500).json({ error: error.message });
  }
});

// Página simples para escanear o QR code sem precisar olhar o terminal
app.get('/qr', async (req, res) => {
  if (connectionStatus === 'conectado') {
    return res.send('✅ WhatsApp já está conectado. Não é necessário escanear.');
  }
  if (!latestQR) {
    return res.send('Aguardando QR code... atualize a página em alguns segundos.');
  }
  const qrImage = await qrcode.toDataURL(latestQR);
  res.send(`
    <html>
      <body style="text-align:center; font-family: sans-serif;">
        <h2>Escaneie este QR code com o WhatsApp</h2>
        <img src="${qrImage}" />
        <p>WhatsApp > Aparelhos conectados > Conectar um aparelho</p>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor HTTP rodando na porta ${PORT}`);
});

let reminderStarted = false;

async function startBot() {
  await connectDB();

  hasBotLock = await acquireBotLock(botInstanceId);
  if (!hasBotLock) {
    console.log('⚠️ Outra instância do bot já está ativa. Esta instância não iniciará o WhatsApp para evitar conflito de sessão.');
    connectionStatus = 'desconectado';
    return;
  }

  botLockRefresh = setInterval(async () => {
    try {
      const refreshed = await refreshBotLock(botInstanceId);
      if (!refreshed) {
        console.log('⚠️ O lock do bot WhatsApp foi perdido. Esta instância vai parar.');
        clearInterval(botLockRefresh);
        botLockRefresh = null;
        hasBotLock = false;
      }
    } catch (err) {
      console.error('Erro ao atualizar lock do bot:', err);
    }
  }, 10_000);

  const { state, saveCreds } = await useMongoAuthState();
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQR = qr;
      connectionStatus = 'aguardando_qr';
      console.log('📱 Novo QR code gerado. Acesse /qr no navegador para escanear.');
    }

    if (connection === 'close') {
      connectionStatus = 'desconectado';
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      const isConflict = statusCode === DisconnectReason.connectionReplaced;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !isConflict;

      console.log('Conexão fechada.', statusCode, 'Reconectar?', shouldReconnect);

      if (isConflict) {
        if (botLockRefresh) {
          clearInterval(botLockRefresh);
          botLockRefresh = null;
        }
        if (hasBotLock) {
          await releaseBotLock(botInstanceId);
          hasBotLock = false;
        }
        console.log(
          '⚠️ Sessão substituída por outra conexão (provavelmente duas instâncias rodando ao mesmo tempo). ' +
          'Esta instância vai parar de tentar reconectar.'
        );
        return;
      }

      if (!shouldReconnect) {
        if (botLockRefresh) {
          clearInterval(botLockRefresh);
          botLockRefresh = null;
        }
        if (hasBotLock) {
          await releaseBotLock(botInstanceId);
          hasBotLock = false;
        }
        console.log('Sessão encerrada (logout). Apague o auth no MongoDB para gerar novo QR.');
        return;
      }

      const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY_MS);
      reconnectAttempts += 1;
      console.log(`⏳ Tentando reconectar em ${delay / 1000}s (tentativa ${reconnectAttempts})...`);
      setTimeout(() => startBot(), delay);
    } else if (connection === 'open') {
      connectionStatus = 'conectado';
      latestQR = null;
      reconnectAttempts = 0;
      console.log('✅ WhatsApp conectado com sucesso!');

      if (!reminderStarted) {
        startDailyReminder(sock);
        startWeeklyBackup(sock);
        reminderStarted = true;
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    debugLog(`📩 messages.upsert disparado. type: ${type}, quantidade: ${messages.length}`);

    if (type !== 'notify') return;

    for (const msg of messages) {
      debugLog(`   → mensagem de ${msg.key.remoteJid}, fromMe: ${msg.key.fromMe}, tem conteúdo: ${!!msg.message}`);

      if (!msg.message || msg.key.fromMe) {
        debugLog('   → ignorada (sem conteúdo ou é mensagem própria)');
        continue;
      }

      const jid = msg.key.remoteJid;
      if (jid === 'status@broadcast' || jid.endsWith('@g.us')) {
        debugLog('   → ignorada (status ou grupo)');
        continue;
      }

      // Quando o remetente usa @lid (id anônimo do WhatsApp), o Baileys às vezes
      // traz o telefone real nesse campo alternativo. Usamos ele só pra exibir/
      // salvar o contato — a resposta continua indo pro "jid" original (@lid).
      const realPhoneJid = msg.key.remoteJidAlt || jid;
      stats.messagesReceived += 1;

      if (realPhoneJid !== jid) {
        stats.lidContacts += 1;
        debugLog(`ℹ️ Contato veio como @lid (${jid}), telefone real encontrado: ${realPhoneJid}`);
      } else {
        debugLog(`ℹ️ Contato sem telefone real disponível, vamos responder pelo @lid mesmo: ${jid}`);
      }

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        '';

      if (!text) continue;

      try {
        await handleMessage(sock, jid, text, msg.pushName, realPhoneJid);
      } catch (err) {
        console.error('Erro ao processar mensagem:', err);
        await sock.sendMessage(jid, {
          text: 'Ops, tive um problema aqui. Pode tentar de novo? 🙏',
        });
      }
    }
  });
}

process.on('unhandledRejection', (err) => {
  console.error('⚠️ Erro não tratado (unhandledRejection), ignorando para manter o bot no ar:', err);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ Exceção não tratada (uncaughtException), ignorando para manter o bot no ar:', err);
});

startBot().catch((err) => {
  console.error('Erro fatal ao iniciar o bot:', err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  if (botLockRefresh) {
    clearInterval(botLockRefresh);
    botLockRefresh = null;
  }
  if (hasBotLock) {
    await releaseBotLock(botInstanceId);
    hasBotLock = false;
  }
  process.exit(0);
});
