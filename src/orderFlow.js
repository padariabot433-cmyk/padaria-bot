import { MENU, findItem, buildMenuText, formatMoney } from './menu.js';
import { Order, Session } from './db.js';

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

// Sessão agora vive no MongoDB — sobrevive a reinícios do bot
async function getSession(jid) {
  let session = await Session.findOne({ jid });
  if (!session) {
    session = await Session.create({ jid, step: 'inicio', cart: [], address: null });
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

async function reply(sock, jid, text) {
  await sock.sendMessage(jid, { text });
}

export async function handleMessage(sock, jid, rawText, pushName) {
  const text = (rawText || '').trim();
  const lower = text.toLowerCase();
  const session = await getSession(jid);

  if (['cancelar', 'sair', 'reiniciar'].includes(lower)) {
    await resetSession(jid);
    await reply(sock, jid, 'Pedido cancelado. Digite qualquer mensagem para começar de novo. 🙂');
    return;
  }

  switch (session.step) {
    case 'inicio': {
      session.step = 'menu';
      await saveSession(session);
      await reply(
        sock,
        jid,
        `Olá${pushName ? ', ' + pushName : ''}! 👋 Bem-vindo(a) à Padaria.\n\n${buildMenuText()}`
      );
      break;
    }

    case 'menu': {
      const ids = lower
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));

      const validItems = ids.map(findItem).filter(Boolean);

      if (validItems.length === 0) {
        await reply(
          sock,
          jid,
          'Não entendi 🤔. Digite o número de um ou mais itens do cardápio, separados por vírgula.\n\n' +
            buildMenuText()
        );
        return;
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
            'Deseja adicionar mais itens? Digite o número do item, ou digite *"fechar"* para finalizar o pedido.'
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
        session.step = 'endereco';
        await saveSession(session);
        await reply(sock, jid, 'Perfeito! Agora me diga o *endereço de entrega* completo.');
        return;
      }

      const ids = lower
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));
      const validItems = ids.map(findItem).filter(Boolean);

      if (validItems.length === 0) {
        await reply(
          sock,
          jid,
          'Digite o número de um item do cardápio para adicionar, ou *"fechar"* para finalizar.'
        );
        return;
      }

      session.pendingItems = validItems;
      session.pendingIndex = 0;
      session.step = 'quantidade';
      await saveSession(session);
      await reply(sock, jid, `Quantos pacotes de *${validItems[0].name}* você quer?`);
      break;
    }

    case 'endereco': {
      session.address = text;
      session.step = 'confirmacao';
      await saveSession(session);
      await reply(
        sock,
        jid,
        `*Confirme seu pedido:*\n\n${cartSummaryText(session.cart)}\n\n` +
          `📍 Endereço: ${session.address}\n\n` +
          'Digite *1* para confirmar ou *2* para cancelar.'
      );
      break;
    }

    case 'confirmacao': {
      if (lower === '1' || lower === 'confirmar') {
        const order = await Order.create({
          customerJid: jid,
          customerName: pushName || '',
          items: session.cart,
          total: cartTotal(session.cart),
          address: session.address,
          status: 'pendente',
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
            `🆕 *Novo pedido!*\n\n${cartSummaryText(session.cart)}\n\n📍 ${session.address}\n📱 Cliente: ${jid.split('@')[0]}`
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