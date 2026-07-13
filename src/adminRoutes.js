import express from 'express';
import { Order } from './db.js';
import { formatMoney } from './menu.js';

export const adminRouter = express.Router();

const STATUS_LABELS = {
  pendente: 'Pendente',
  confirmado: 'Confirmado',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function orderCardHTML(order) {
  const itemsHTML = order.items
    .map((i) => `<li>${i.quantity}× ${i.name} <span class="item-price">${formatMoney(i.price * i.quantity)}</span></li>`)
    .join('');

  const isDone = order.status === 'entregue' || order.status === 'cancelado';

  const actionHTML = isDone
    ? `<span class="tag tag-${order.status}">${STATUS_LABELS[order.status]}</span>`
    : `
      <form method="POST" action="/pedidos/${order._id}/status" class="action-form">
        <input type="hidden" name="status" value="entregue" />
        <button type="submit" class="btn btn-done">✓ Marcar entregue</button>
      </form>
      <form method="POST" action="/pedidos/${order._id}/status" class="action-form">
        <input type="hidden" name="status" value="cancelado" />
        <button type="submit" class="btn btn-cancel">Cancelar</button>
      </form>
    `;

  return `
    <article class="order-card status-${order.status}">
      <header class="order-head">
        <span class="order-time">${formatTime(order.createdAt)}</span>
        <span class="tag tag-${order.status}">${STATUS_LABELS[order.status]}</span>
      </header>
      <ul class="order-items">${itemsHTML}</ul>
      <p class="order-total">Total <strong>${formatMoney(order.total)}</strong></p>
      <p class="order-address">📍 ${order.address || '—'}</p>
      <p class="order-phone">📱 ${order.customerJid.split('@')[0]}${order.customerName ? ' · ' + order.customerName : ''}</p>
      <div class="order-actions">${actionHTML}</div>
    </article>
  `;
}

function pageHTML({ orders, dateLabel, totalHoje, pendentes }) {
  const cards = orders.length
    ? orders.map(orderCardHTML).join('')
    : `<p class="empty">Nenhum pedido ainda hoje. Assim que chegar, aparece aqui. 🥐</p>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Pedidos de Hoje — Padaria</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --crust: #3E2723;
    --cream: #FAF3E3;
    --paper: #FFFDF8;
    --wheat: #C68A2E;
    --brick: #A8442E;
    --sage: #5F7A52;
    --ink-soft: #6B5C4E;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--cream);
    color: var(--crust);
    font-family: 'Work Sans', sans-serif;
    padding: 0 0 3rem;
  }
  .topbar {
    background: var(--crust);
    color: var(--cream);
    padding: 1.25rem 1.5rem;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .topbar h1 {
    font-family: 'Fraunces', serif;
    font-size: 1.5rem;
    margin: 0;
    font-weight: 700;
  }
  .topbar .date {
    font-size: 0.9rem;
    color: var(--wheat);
  }
  .receipt {
    max-width: 720px;
    margin: 1.5rem auto 0;
    background: var(--paper);
    padding: 1.25rem 1.5rem;
    border-radius: 4px;
    box-shadow: 0 2px 10px rgba(62,39,35,0.08);
    display: flex;
    justify-content: space-around;
    text-align: center;
    border-bottom: 2px dashed #E3D5BE;
  }
  .receipt div span {
    display: block;
    font-family: 'Fraunces', serif;
    font-size: 1.8rem;
    font-weight: 700;
    color: var(--crust);
  }
  .receipt div small {
    color: var(--ink-soft);
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .orders {
    max-width: 720px;
    margin: 1.5rem auto;
    display: grid;
    gap: 0.9rem;
    padding: 0 1rem;
  }
  .order-card {
    background: var(--paper);
    border-radius: 8px;
    padding: 1rem 1.1rem;
    box-shadow: 0 1px 4px rgba(62,39,35,0.08);
    border-left: 4px solid var(--wheat);
  }
  .order-card.status-entregue { border-left-color: var(--sage); opacity: 0.7; }
  .order-card.status-cancelado { border-left-color: #999; opacity: 0.55; }
  .order-card.status-pendente { border-left-color: var(--brick); }
  .order-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  .order-time { color: var(--ink-soft); font-size: 0.85rem; }
  .tag {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-weight: 600;
  }
  .tag-pendente { background: #F4E1D8; color: var(--brick); }
  .tag-confirmado { background: #F4E1D8; color: var(--brick); }
  .tag-entregue { background: #E4EADD; color: var(--sage); }
  .tag-cancelado { background: #eee; color: #888; }
  .order-items { margin: 0.4rem 0; padding-left: 1.1rem; }
  .order-items li { margin-bottom: 0.15rem; }
  .item-price { color: var(--ink-soft); font-size: 0.85rem; }
  .order-total { margin: 0.5rem 0 0.2rem; }
  .order-address, .order-phone { margin: 0.15rem 0; font-size: 0.9rem; color: var(--ink-soft); }
  .order-actions { display: flex; gap: 0.5rem; margin-top: 0.7rem; flex-wrap: wrap; }
  .action-form { display: inline; }
  .btn {
    border: none;
    border-radius: 6px;
    padding: 0.45rem 0.8rem;
    font-family: 'Work Sans', sans-serif;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .btn-done { background: var(--sage); color: white; }
  .btn-cancel { background: transparent; color: var(--brick); border: 1px solid var(--brick); }
  .empty { text-align: center; color: var(--ink-soft); padding: 2rem 0; }
  .refresh-note { text-align: center; color: var(--ink-soft); font-size: 0.8rem; margin-top: 1rem; }
</style>
</head>
<body>
  <div class="topbar">
    <h1>🥖 Pedidos de Hoje</h1>
    <span class="date">${dateLabel}</span>
  </div>

  <div class="receipt">
    <div><span>${orders.length}</span><small>Pedidos hoje</small></div>
    <div><span>${pendentes}</span><small>Pendentes</small></div>
    <div><span>${formatMoney(totalHoje)}</span><small>Total do dia</small></div>
  </div>

  <div class="orders">${cards}</div>

  <p class="refresh-note">Atualize a página para ver pedidos novos.</p>
</body>
</html>`;
}

adminRouter.get('/pedidos', async (req, res) => {
  const today = new Date();
  const orders = await Order.find({
    createdAt: { $gte: startOfDay(today), $lte: endOfDay(today) },
  }).sort({ createdAt: -1 });

  const totalHoje = orders
    .filter((o) => o.status !== 'cancelado')
    .reduce((sum, o) => sum + o.total, 0);
  const pendentes = orders.filter((o) => o.status === 'pendente').length;

  const dateLabel = today.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });

  res.send(pageHTML({ orders, dateLabel, totalHoje, pendentes }));
});

adminRouter.post('/pedidos/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['entregue', 'cancelado', 'pendente'].includes(status)) {
    return res.status(400).send('Status inválido');
  }
  await Order.updateOne({ _id: req.params.id }, { $set: { status } });
  res.redirect('/pedidos');
});
