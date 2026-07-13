import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import qrcode from 'qrcode';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';

import { connectDB, Order } from './src/db.js';
import { useMongoAuthState } from './src/authState.js';
import { handleMessage } from './src/orderFlow.js';
import { adminAuth } from './src/adminAuth.js';
import { adminRouter } from './src/adminRoutes.js';
import { startDailyReminder } from './src/dailyReminder.js';
import { startWeeklyBackup } from './src/backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.SITE_ORIGIN || 'https://padariabot433-cmyk.github.io';
const app = express();

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
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

let latestQR = null;
let connectionStatus = 'iniciando';
let reminderStarted = false;

// Serve a página de redirecionamento (index.html da raiz)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve o painel protegido pela mesma senha do /pedidos
app.use('/site', adminAuth, express.static(path.join(__dirname, 'site')));

// Status simples do bot
app.get('/status', (req, res) => {
  res.send(`Bot da padaria está no ar. Status da conexão: ${connectionStatus}`);
});

// Painel de pedidos, protegido por senha (ADMIN_PASSWORD no .env)
app.use('/pedidos', adminAuth, adminRouter);

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

async function startBot() {
  await connectDB();

  const { state, saveCreds } = await useMongoAuthState();
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQR = qr;
      connectionStatus = 'aguardando_qr';
      console.log('📱 Novo QR code gerado. Acesse /qr no navegador para escanear.');
    }

    if (connection === 'close') {
      connectionStatus = 'desconectado';
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      // 440 = connectionReplaced: outra instância conectou com a MESMA sessão
      // (ex: deploy novo subindo antes do antigo desligar). Reconectar aqui só
      // alimenta um cabo de guerra infinito entre as duas instâncias.
      const isConflict = statusCode === DisconnectReason.connectionReplaced;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !isConflict;

      console.log('Conexão fechada.', statusCode, 'Reconectar?', shouldReconnect);

      if (isConflict) {
        console.log(
          '⚠️ Sessão substituída por outra conexão (provavelmente duas instâncias rodando ao mesmo tempo). ' +
          'Esta instância vai parar de tentar reconectar.'
        );
        return;
      }

      if (shouldReconnect) {
        // Pequeno atraso evita um loop de reconexão imediato e agressivo
        setTimeout(() => startBot(), 3000);
      } else {
        console.log('Sessão encerrada (logout). Apague o auth no MongoDB para gerar novo QR.');
      }
    } else if (connection === 'open') {
      connectionStatus = 'conectado';
      latestQR = null;
      console.log('✅ WhatsApp conectado com sucesso!');

      if (!reminderStarted) {
        startDailyReminder(sock);
        startWeeklyBackup(sock);
        reminderStarted = true;
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      // Ignora mensagens de grupos e do próprio status
      if (jid === 'status@broadcast' || jid.endsWith('@g.us')) continue;

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        '';

      if (!text) continue;

      try {
        await handleMessage(sock, jid, text, msg.pushName);
      } catch (err) {
        console.error('Erro ao processar mensagem:', err);
        await sock.sendMessage(jid, {
          text: 'Ops, tive um problema aqui. Pode tentar de novo? 🙏',
        });
      }
    }
  });
}

// Erros vindos de dentro do Baileys (ex: timeout ao renovar pré-chaves) às vezes
// escapam de qualquer try/catch nosso e, sem isso aqui, derrubam o processo inteiro
// (o que faz o Render reiniciar o serviço e recomeçar o ciclo de conflito de sessão).
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
