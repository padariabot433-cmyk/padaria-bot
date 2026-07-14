import { getMenu, findItemInMenu, buildMenuTextFromList, formatMoney } from './menu.js';
import { Order, Session, Customer } from './db.js';

function cartTotal(cart) {
  return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function cartSummaryText(cart) {
  const lines = cart.map(
    (item) =>
      `• ${item.quantity}x ${item.name} - ${formatMoney(item.price * item.quantity)}`
  );
  return lines.join('\n') + `\n\n*Total: ${formatMoney(cartTotal(cart))}*`;
}

function cartSummaryTextNumbered(cart) {
  const lines = cart.map(
    (item, i) =>
      `${i + 1}. ${item.quantity}x ${item.name} - ${formatMoney(item.price * item.quantity)}`
  );
  return lines.join('\n') + `\n\n*Total: ${formatMoney(cartTotal(cart))}*`;
}

// Sessão agora vive no MongoDB — sobrevive a reinícios do bot
async function getCustomer(jid) {
  return Customer.findOne({ jid });
}

async function getLastOrder(jid) {
  return Order.findOne({ customerJid: jid, status: { $ne: 'cancelado' } }).sort({ createdAt: -1 });
}

async function upsertCustomer({ jid, name }) {
  if (!jid) return null;
  return Customer.findOneAndUpdate(
    { jid },
    { name, updatedAt: new Date() },
    { upsert: true, new: true }
  );
}

async function getSession(jid) {
  let session = await Session.findOne({ jid });
  if (!session) {
    session = await Session.create({ jid, step: 'inicio', cart: [], customerName: '' });
  }

  if (!session.customerName) {
    const customer = await getCustomer(jid);
    if (customer?.name) {
      session.customerName = customer.name;
      await saveSession(session);
    }
  }

  return session;
}

async function resetSession(jid) {
  await Session.deleteOne({ jid });
}

async function saveSession(session) {
  session.updatedAt = new Date();
  await session.save();
}

const DEBUG_LOGS = process.env.DEBUG_LOGS === 'true';
function debugLog(...args) {
  if (DEBUG_LOGS) console.log(...args);
}

async function notifyAdminOfFailure(sock, failedJid, err) {
  const admin = process.env.ADMIN_NUMBER;
  if (!admin) return;

  const adminJid = admin.includes('@') ? admin : `${admin}@s.whatsapp.net`;
  if (adminJid === failedJid) return; // evita loop se a falha for ao tentar avisar o próprio admin

  try {
    await sock.sendMessage(adminJid, {
      text:
        `⚠️ *Falha ao enviar mensagem para um cliente*\n\n` +
        `JID: ${failedJid}\n` +
        `Erro: ${err?.message || 'desconhecido'}\n\n` +
        `Pode ser o bug conhecido do @lid — o cliente pode não ter recebido a resposta do bot.`,
    });
  } catch (notifyErr) {
    console.error('Também falhou ao avisar o admin sobre a falha de envio:', notifyErr);
  }
}

async function reply(sock, jid, text) {
  try {
    debugLog(`📤 Tentando enviar mensagem para ${jid}...`);
    const result = await sock.sendMessage(jid, { text });
    debugLog(`✅ sendMessage retornou OK para ${jid} (id da msg: ${result?.key?.id || 'sem id'})`);
  } catch (err) {
    console.error(`❌ sendMessage FALHOU para ${jid}:`, err);
    await notifyAdminOfFailure(sock, jid, err);
    throw err;
  }
}

// Trava simples por cliente: evita que duas mensagens quase simultâneas do
// mesmo número sejam processadas em paralelo (o que poderia gerar dois
// pedidos duplicados se o cliente apertar "1" duas vezes muito rápido).
const processingLocks = new Map();

async function withLock(jid, fn) {
  const previous = processingLocks.get(jid) || Promise.resolve();
  let release;
  const current = previous.then(() => new Promise((resolve) => { release = resolve; }));
  processingLocks.set(jid, current.catch(() => {}));

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (processingLocks.get(jid) === current.catch(() => {})) {
      processingLocks.delete(jid);
    }
  }
}

export async function handleMessage(sock, jid, rawText, pushName, realPhoneJid) {
  return withLock(jid, () => handleMessageInner(sock, jid, rawText, pushName, realPhoneJid));
}

async function handleMessageInner(sock, jid, rawText, pushName, realPhoneJid) {
  const text = (rawText || '').trim();
  const lower = text.toLowerCase();
  const session = await getSession(jid);
  const menu = await getMenu();

  // Responder pro telefone real (quando disponível) é mais confiável do que
  // responder pro @lid — o Baileys tem um bug conhecido onde mensagens
  // enviadas pra @lid às vezes não chegam, sem erro nenhum.
  const replyTo = realPhoneJid || jid;

  if (['cancelar', 'sair', 'reiniciar'].includes(lower)) {
    await resetSession(jid);
    await reply(sock, replyTo, 'Pedido cancelado. Digite qualquer mensagem para começar de novo. 🙂');
    return;
  }

  switch (session.step) {
    case 'inicio': {
      const lookupJid = realPhoneJid || jid;
      const customer = await getCustomer(lookupJid);
      const lastOrder = customer ? await getLastOrder(lookupJid) : null;

      if (customer?.name && lastOrder) {
        session.step = 'repetir_pedido';
        session.pendingItems = lastOrder.items.map((item) => ({
          id: item.productId,
          name: item.name,
          price: item.price,
        }));
        session.lastOrderCart = lastOrder.items;
        await saveSession(session);

        await reply(
          sock,
          jid,
          `Que bom te ver de novo, ${customer.name}! 👋\n\n` +
            `Seu último pedido foi:\n${cartSummaryText(lastOrder.items)}\n\n` +
            'Digite *1* para repetir esse pedido, ou *2* para ver o cardápio e montar um pedido novo.'
        );
      } else {
        session.step = 'menu';
        await saveSession(session);
        await reply(
          sock,
          jid,
          `Olá${pushName ? ', ' + pushName : ''}! 👋 Bem-vindo(a) à Padaria.\n\n${buildMenuTextFromList(menu)}`
        );
      }
      break;
    }

    case 'repetir_pedido': {
      if (lower === '1') {
        session.cart = session.lastOrderCart.map((item) => ({
          productId: item.productId,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
        }));
        session.lastOrderCart = undefined;
        session.pendingItems = [];
        session.step = 'confirmacao';
        await saveSession(session);
        await reply(
          sock,
          jid,
          `*Confirme seu pedido:*\n\n${cartSummaryText(session.cart)}\n\nDigite *1* para confirmar ou *2* para cancelar.`
        );
      } else if (lower === '2') {
        session.lastOrderCart = undefined;
        session.pendingItems = [];
        session.step = 'menu';
        await saveSession(session);
        await reply(sock, jid, buildMenuTextFromList(menu));
      } else {
        await reply(sock, jid, 'Digite *1* para repetir o último pedido, ou *2* para ver o cardápio.');
      }
      break;
    }

    case 'menu': {
      const ids = lower
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));

      if (ids.length === 0) {
        await reply(
          sock,
          jid,
          'Não entendi 🤔. Digite o número de um ou mais itens do cardápio, separados por vírgula.\n\n' +
            buildMenuTextFromList(menu)
        );
        return;
      }

      const validItems = ids.map((id) => findItemInMenu(menu, id)).filter(Boolean);
      const invalidIds = ids.filter((id) => !findItemInMenu(menu, id));

      if (validItems.length === 0) {
        await reply(
          sock,
          jid,
          `O número *${invalidIds.join(', ')}* não existe no cardápio 🤔. Digite um dos números abaixo:\n\n` +
            buildMenuTextFromList(menu)
        );
        return;
      }

      if (invalidIds.length > 0) {
        await reply(
          sock,
          jid,
          `⚠️ O(s) número(s) *${invalidIds.join(', ')}* não existe(m) no cardápio e foi(ram) ignorado(s). Vamos continuar com os itens válidos que você escolheu.`
        );
      }

      session.pendingItems = validItems;
      session.step = 'quantidade';
      session.pendingIndex = 0;
      await saveSession(session);
      await reply(sock, jid, `Quantos pacotes de *${validItems[0].name}* você quer?`);
      break;
    }

    case 'quantidade': {
      const qty = parseInt(lower, 10);
      if (!qty || qty <= 0) {
        await reply(sock, jid, 'Por favor, digite um número válido (ex: 2).');
        return;
      }

      const item = session.pendingItems[session.pendingIndex];
      session.cart.push({
        productId: item.id,
        name: item.name,
        price: item.price,
        quantity: qty,
      });

      session.pendingIndex += 1;

      if (session.pendingIndex < session.pendingItems.length) {
        const next = session.pendingItems[session.pendingIndex];
        await saveSession(session);
        await reply(sock, jid, `Quantos pacotes de *${next.name}* você quer?`);
      } else {
        session.step = 'mais_itens';
        await saveSession(session);
        await reply(
          sock,
          jid,
          `Adicionado! ✅\n\n${cartSummaryText(session.cart)}\n\n` +
            'Deseja adicionar mais itens? Digite o número do item, digite *"remover"* pra tirar algo do carrinho, ou digite *"fechar"* para finalizar o pedido.\n\n' +
            '_Ou digite *cancelar* para interromper._'
        );
      }
      break;
    }

    case 'mais_itens': {
      if (lower === 'fechar' || lower === 'finalizar') {
        if (session.cart.length === 0) {
          await reply(sock, jid, 'Seu carrinho está vazio. Digite um número do cardápio primeiro.');
          return;
        }
        session.step = 'confirmacao';
        await saveSession(session);
        await reply(
          sock,
          jid,
          `*Confirme seu pedido:*

${cartSummaryText(session.cart)}

Digite *1* para confirmar ou *2* para cancelar.`
        );
        return;
      }

      if (lower === 'remover') {
        await reply(
          sock,
          jid,
          `Seu carrinho:\n\n${cartSummaryTextNumbered(session.cart)}\n\n` +
            'Digite *"remover"* seguido do número do item pra tirá-lo (ex: "remover 2").'
        );
        return;
      }

      const removeMatch = lower.match(/^remover\s+(\d+)$/);
      if (removeMatch) {
        const index = parseInt(removeMatch[1], 10) - 1;

        if (index < 0 || index >= session.cart.length) {
          await reply(
            sock,
            jid,
            `Não achei o item *${removeMatch[1]}* no seu carrinho 🤔.\n\n${cartSummaryTextNumbered(session.cart)}`
          );
          return;
        }

        const removed = session.cart[index];
        session.cart.splice(index, 1);
        await saveSession(session);

        if (session.cart.length === 0) {
          await reply(
            sock,
            jid,
            `Removido: ${removed.quantity}x ${removed.name} ✅\n\nSeu carrinho ficou vazio. Digite o número de um item do cardápio para adicionar.`
          );
        } else {
          await reply(
            sock,
            jid,
            `Removido: ${removed.quantity}x ${removed.name} ✅\n\n${cartSummaryText(session.cart)}\n\n` +
              'Deseja adicionar mais itens, remover outro (*"remover"*), ou digitar *"fechar"* para finalizar.'
          );
        }
        return;
      }

      const ids = lower
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));
      const validItems = ids.map((id) => findItemInMenu(menu, id)).filter(Boolean);
      const invalidIds = ids.filter((id) => !findItemInMenu(menu, id));

      if (validItems.length === 0) {
        await reply(
          sock,
          jid,
          ids.length > 0
            ? `O número *${invalidIds.join(', ')}* não existe no cardápio 🤔. Digite um item válido, ou *"fechar"* para finalizar.`
            : 'Digite o número de um item do cardápio para adicionar, ou *"fechar"* para finalizar.'
        );
        return;
      }

      if (invalidIds.length > 0) {
        await reply(
          sock,
          jid,
          `⚠️ O(s) número(s) *${invalidIds.join(', ')}* não existe(m) no cardápio e foi(ram) ignorado(s).`
        );
      }

      session.pendingItems = validItems;
      session.pendingIndex = 0;
      session.step = 'quantidade';
      await saveSession(session);
      await reply(sock, jid, `Quantos pacotes de *${validItems[0].name}* você quer?`);
      break;
    }

    case 'confirmacao': {
      const isConfirm = lower === '1' || lower === 'confirmar';
      const isCancel = lower === '2' || lower === 'cancelar';

      if (isConfirm) {
        const customerJid = realPhoneJid || jid;

        const order = await Order.create({
          customerJid,
          customerName: session.customerName || pushName || '',
          items: session.cart,
          total: cartTotal(session.cart),
          status: 'pendente',
        });

        const customer = await upsertCustomer({
          jid: customerJid,
          name: session.customerName || pushName || '',
        });

        await reply(
          sock,
          jid,
          `🎉 Pedido confirmado! Nº ${order._id.toString().slice(-6)}\n` +
            'Obrigado pela preferência, já vamos preparar seu pedido!'
        );

        const admin = process.env.ADMIN_NUMBER;
        if (admin) {
          const adminJid = admin.includes('@') ? admin : `${admin}@s.whatsapp.net`;
          await reply(
            sock,
            adminJid,
            `🆕 *Novo pedido!*\n\n${cartSummaryText(session.cart)}\n\n Cliente: ${customerJid.split('@')[0]}`
          );
        }

        await resetSession(jid);
      } else if (lower === '2' || lower === 'cancelar') {
        await resetSession(jid);
        await reply(sock, jid, 'Pedido cancelado. Digite qualquer mensagem para começar de novo.');
      } else {
        await reply(sock, jid, 'Digite *1* para confirmar ou *2* para cancelar.');
      }
      break;
    }

    default: {
      await resetSession(jid);
      await reply(sock, jid, 'Vamos começar de novo! Digite qualquer mensagem para ver o cardápio.');
    }
  }
}