// API endpoints: allow override from the page (`window.PADARIA_API_URL`) or
// fall back to the default host. When the panel is served from the same
// backend (via `/site`), `API_URL` may be a relative URL and will work.
const DEFAULT_API_HOST = 'https://padaria-bot-cbf7.onrender.com';
const API_URL = window.PADARIA_API_URL || DEFAULT_API_HOST + '/api/orders';
const API_MENU_URL = window.PADARIA_API_MENU_URL || DEFAULT_API_HOST + '/api/menu';
let currentOrders = [];
let currentMenu = [];
let newOrderItems = [];
let knownOrderIds = new Set();
let hasPolledOnce = false;
let pollInterval = null;
const STATUS_LABELS = {
  pendente: 'Pendente',
  devendo: 'Devendo',
  ok: 'Ok',
  confirmado: 'Confirmado',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

function getAuthHeader() {
  const pass = sessionStorage.getItem('painelSenha');
  return 'Basic ' + btoa('padaria:' + (pass || ''));
}

function getOrderById(orderId) {
  return currentOrders.find((order) => String(order._id) === String(orderId));
}

async function patchOrder(orderId, updates) {
  const response = await fetch(`${API_URL}/${orderId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: getAuthHeader(),
    },
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Falha ao atualizar pedido (${response.status})`);
  }
  return response.json();
}

async function deleteOrder(orderId) {
  const response = await fetch(`${API_URL}/${orderId}`, {
    method: 'DELETE',
    headers: { Authorization: getAuthHeader() },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Falha ao excluir pedido (${response.status})`);
  }
  return response.json();
}

async function loadMenu() {
  const list = document.getElementById('menuList');
  list.innerHTML = '<p class="muted">Carregando cardápio...</p>';
  try {
    const response = await fetch(API_MENU_URL, {
      headers: { Authorization: getAuthHeader() },
    });
    if (!response.ok) {
      list.innerHTML = '<p class="muted">Não foi possível carregar o cardápio.</p>';
      return;
    }
    currentMenu = await response.json();
    renderMenu();
  } catch (err) {
    console.error('Erro ao carregar cardápio:', err);
    list.innerHTML = '<p class="muted">Erro de conexão ao carregar o cardápio.</p>';
  }
}

function renderMenu() {
  const list = document.getElementById('menuList');
  if (!currentMenu.length) {
    list.innerHTML = '<p class="muted">Nenhum item cadastrado ainda.</p>';
    return;
  }

  list.innerHTML = [...currentMenu]
    .sort((a, b) => a.id - b.id)
    .map((item) => `
      <div class="menu-item-row ${item.active ? '' : 'inactive'}" data-menu-id="${item.id}">
        <input type="text" class="menu-item-name" value="${(item.name || '').replaceAll('"', '&quot;')}" />
        <input type="number" step="0.01" min="0" class="menu-item-price" value="${Number(item.price || 0).toFixed(2)}" />
        <label class="active-toggle">
          <input type="checkbox" class="menu-item-active" ${item.active ? 'checked' : ''} />
          Disponível
        </label>
        <div class="menu-item-actions">
          <button type="button" class="save-menu-item-button" data-menu-id="${item.id}">Salvar</button>
          <button type="button" class="delete-menu-item-button" data-menu-id="${item.id}">Excluir</button>
        </div>
      </div>
    `)
    .join('');
}

function populateNewOrderItemSelect() {
  const select = document.getElementById('newOrderItemSelect');
  if (!select) return;

  const activeItems = currentMenu.filter((item) => item.active);
  select.innerHTML = activeItems
    .map((item) => `<option value="${item.id}">${escapeHtmlGlobal(item.name)} — ${formatCurrency(item.price)}</option>`)
    .join('');
}

async function openNewOrderModal() {
  newOrderItems = [];
  document.getElementById('newOrderForm').reset();
  document.getElementById('newOrderMessage').textContent = '';
  renderNewOrderItemsList();

  if (!currentMenu.length) {
    await loadMenu();
  }
  populateNewOrderItemSelect();

  document.getElementById('newOrderModal').classList.remove('hidden');
}

function closeNewOrderModal() {
  document.getElementById('newOrderModal').classList.add('hidden');
}

function addItemToNewOrder() {
  const select = document.getElementById('newOrderItemSelect');
  const qtyInput = document.getElementById('newOrderItemQty');
  const menuId = Number(select.value);
  const qty = Number(qtyInput.value) || 1;

  const menuItem = currentMenu.find((item) => item.id === menuId);
  if (!menuItem) {
    alert('Selecione um item válido do cardápio.');
    return;
  }

  const existing = newOrderItems.find((item) => item.productId === menuId);
  if (existing) {
    existing.quantity += qty;
  } else {
    newOrderItems.push({
      productId: menuItem.id,
      name: menuItem.name,
      price: menuItem.price,
      quantity: qty,
    });
  }

  qtyInput.value = 1;
  renderNewOrderItemsList();
}

function removeItemFromNewOrder(index) {
  newOrderItems.splice(index, 1);
  renderNewOrderItemsList();
}

function renderNewOrderItemsList() {
  const list = document.getElementById('newOrderItemsList');
  const totalDisplay = document.getElementById('newOrderTotalDisplay');

  if (!newOrderItems.length) {
    list.innerHTML = '<li class="muted">Nenhum item adicionado ainda.</li>';
  } else {
    list.innerHTML = newOrderItems.map((item, idx) => `
      <li>
        <span>${escapeHtmlGlobal(`${item.quantity}x ${item.name}`)}</span>
        <span>
          ${formatCurrency(item.price * item.quantity)}
          <button type="button" class="remove-new-order-item" data-remove-idx="${idx}" title="Remover">✕</button>
        </span>
      </li>
    `).join('');
  }

  const total = newOrderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  totalDisplay.textContent = formatCurrency(total);
}

async function submitNewOrder(event) {
  event.preventDefault();
  const messageEl = document.getElementById('newOrderMessage');

  if (!newOrderItems.length) {
    messageEl.textContent = 'Adicione ao menos um item ao pedido.';
    return;
  }

  const payload = {
    customerName: document.getElementById('newOrderName').value.trim(),
    customerJid: document.getElementById('newOrderPhone').value.trim(),
    status: document.getElementById('newOrderStatus').value,
    valorPago: Number(document.getElementById('newOrderValorPago').value || 0),
    items: newOrderItems,
  };

  messageEl.textContent = 'Criando pedido...';

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: getAuthHeader(),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errPayload = await response.json().catch(() => ({}));
      throw new Error(errPayload.error || `Falha ao criar pedido (${response.status})`);
    }

    closeNewOrderModal();
    await loadOrders();
  } catch (err) {
    console.error(err);
    messageEl.textContent = err.message;
  }
}

function exportOrdersToPdf() {
  const orders = currentOrders;
  if (!orders.length) {
    alert('Não há pedidos para exportar.');
    return;
  }

  const rowsHtml = orders.map((order) => {
    const items = (order.items || []).map((item) => `${item.quantity}x ${item.name}`).join(', ');
    const valorPago = Number(order.valorPago || 0);
    const falta = Math.max(Number(order.total || 0) - valorPago, 0);
    return `
      <tr>
        <td>${escapeHtmlGlobal(order.customerName || 'Cliente sem nome')}</td>
        <td>${escapeHtmlGlobal(formatPhone(order.customerJid))}</td>
        <td>${escapeHtmlGlobal(STATUS_LABELS[order.status] || order.status)}</td>
        <td>${escapeHtmlGlobal(items)}</td>
        <td>${formatCurrency(order.total)}</td>
        <td>${formatCurrency(valorPago)}</td>
        <td>${formatCurrency(falta)}</td>
        <td>${escapeHtmlGlobal(new Date(order.createdAt).toLocaleString('pt-BR'))}</td>
      </tr>
    `;
  }).join('');

  const totalGeral = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);

  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Pedidos - Padaria</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #3e2723; }
          h1 { font-size: 18px; margin-bottom: 4px; }
          p.muted { color: #8a7a6a; margin-top: 0; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          th, td { border: 1px solid #ccc; padding: 6px 8px; font-size: 12px; text-align: left; }
          th { background: #faf3e3; }
          tfoot td { font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>🥖 Pedidos — Padaria</h1>
        <p class="muted">Gerado em ${new Date().toLocaleString('pt-BR')} · ${orders.length} pedido(s)</p>
        <table>
          <thead>
            <tr>
              <th>Cliente</th><th>Telefone</th><th>Status</th><th>Itens</th>
              <th>Total</th><th>Pago</th><th>Falta</th><th>Data</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
          <tfoot>
            <tr><td colspan="4">Total geral</td><td>${formatCurrency(totalGeral)}</td><td colspan="3"></td></tr>
          </tfoot>
        </table>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

async function addMenuItem(name, price) {
  const response = await fetch(API_MENU_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: getAuthHeader(),
    },
    body: JSON.stringify({ name, price }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Falha ao adicionar item (${response.status})`);
  }
  return response.json();
}

async function saveMenuItem(id, updates) {
  const response = await fetch(`${API_MENU_URL}/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: getAuthHeader(),
    },
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Falha ao salvar item (${response.status})`);
  }
  return response.json();
}

async function deleteMenuItem(id) {
  const response = await fetch(`${API_MENU_URL}/${id}`, {
    method: 'DELETE',
    headers: { Authorization: getAuthHeader() },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Falha ao excluir item (${response.status})`);
  }
  return response.json();
}

// Toca um "ping" curto sem precisar de nenhum arquivo de áudio externo
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [0, 0.16].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === 0 ? 880 : 1046.5;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.3, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.3);
    });
  } catch (err) {
    console.error('Não foi possível tocar o som de notificação:', err);
  }
}

// Checa periodicamente se chegou pedido novo (pendente), independente
// do filtro de data/status que o admin estiver usando na tela.
async function checkForNewOrders() {
  if (!sessionStorage.getItem('painelSenha')) return;
  try {
    const url = new URL(API_URL);
    url.searchParams.set('status', 'pendente');
    url.searchParams.set('limit', '30');
    const response = await fetch(url, { headers: { Authorization: getAuthHeader() } });
    if (!response.ok) return;

    const orders = await response.json();
    const newOnes = orders.filter((o) => !knownOrderIds.has(String(o._id)));
    orders.forEach((o) => knownOrderIds.add(String(o._id)));

    if (hasPolledOnce && newOnes.length > 0) {
      const soundToggle = document.getElementById('soundToggle');
      if (!soundToggle || soundToggle.checked) playNotificationSound();
      document.title = `🔔 (${newOnes.length}) Padaria — Pedidos`;
      await loadOrders();
    }
    hasPolledOnce = true;
  } catch (err) {
    console.error('Erro ao checar novos pedidos:', err);
  }
}

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  // wrap the async call so promise rejections are logged (setInterval does
  // not handle returned promises). This avoids uncaught rejections in the
  // console when network errors happen.
  pollInterval = setInterval(() => {
    checkForNewOrders().catch((err) => console.error('Erro em checkForNewOrders (interval):', err));
  }, 20000);
}

function stopPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = null;
}

function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('appContent').classList.add('hidden');
  stopPolling();
}

function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appContent').classList.remove('hidden');
  document.title = 'Padaria — Pedidos';
  startPolling();
}

function tryLogin(password) {
  sessionStorage.setItem('painelSenha', password);
  return loadOrders(true);
}

async function loadPage() {
  const storedPassword = sessionStorage.getItem('painelSenha');
  if (storedPassword) {
    showApp();
    return loadOrders();
  }
  showLogin();
}

async function loadOrders(isLoginAttempt = false) {
  const fromDay = document.getElementById('fromDay').value;
  const toDay = document.getElementById('toDay').value;
  const status = document.getElementById('status').value;
  const url = new URL(API_URL, window.location.origin);
  if (fromDay) url.searchParams.set('fromDay', fromDay);
  if (toDay) url.searchParams.set('toDay', toDay);
  if (status) url.searchParams.set('status', status);

  const errorEl = document.getElementById('loginError');
  if (isLoginAttempt) errorEl.textContent = 'Verificando...';

  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: getAuthHeader() },
    });
  } catch (err) {
    errorEl.textContent = 'Não foi possível conectar ao servidor. Verifique sua internet e tente de novo.';
    console.error('Erro de rede ao buscar pedidos:', err);
    return;
  }

  if (response.status === 401) {
    sessionStorage.removeItem('painelSenha');
    if (isLoginAttempt) {
      errorEl.textContent = 'Senha incorreta. Tente novamente.';
    } else {
      showLogin();
    }
    return;
  }

  if (response.status === 429) {
    errorEl.textContent = 'Muitas tentativas erradas. Aguarde alguns minutos antes de tentar de novo.';
    return;
  }

  if (!response.ok) {
    errorEl.textContent = `Erro inesperado do servidor (código ${response.status}). Tente novamente em instantes.`;
    return;
  }

  if (isLoginAttempt) errorEl.textContent = '';

  const orders = await response.json();
  renderOrders(orders);
  showApp();
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Deixa o número tipo "556599999999" mais legível: (65) 99999-9999
function formatPhone(jid) {
  const digits = (jid || '').split('@')[0].replace(/\D/g, '');
  if (digits.length < 10) return digits || '—';
  const ddd = digits.slice(2, 4);
  const rest = digits.slice(4);
  const half = rest.length > 8 ? rest.length - 4 : Math.ceil(rest.length / 2);
  return `(${ddd}) ${rest.slice(0, half)}-${rest.slice(half)}`;
}

function exportOrdersToCsv() {
  const orders = currentOrders;
  if (!orders.length) {
    alert('Não há pedidos para exportar.');
    return;
  }

  const asExcelText = (value) => `="${String(value).replace(/"/g, '""')}"`;

  const headers = ['ID', 'Cliente', 'Telefone', 'Status', 'Total', 'Pago', 'Falta', 'Data', 'Itens'];
  const rows = orders.map((order) => {
    const items = (order.items || []).map((item) => `${item.quantity}x ${item.name}`).join(' | ');
    const total = Number(order.total || 0).toFixed(2);
    const valorPago = Number(order.valorPago || 0).toFixed(2);
    const falta = Math.max(Number(order.total || 0) - Number(order.valorPago || 0), 0).toFixed(2);
    return [
      asExcelText(order._id),
      order.customerName || '',
      asExcelText(order.customerJid || ''),
      STATUS_LABELS[order.status] || order.status,
      total,
      valorPago,
      falta,
      new Date(order.createdAt).toLocaleString('pt-BR'),
      items,
    ];
  });

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => {
      if (String(cell).startsWith('="')) return cell;
      return `"${String(cell).replace(/"/g, '""')}"`;
    }).join(','))
    .join('\n');

  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `pedidos-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

function escapeHtmlGlobal(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function openCustomerHistory(jid, name) {
  const modal = document.getElementById('historyModal');
  const modalName = document.getElementById('historyModalName');
  const modalBody = document.getElementById('historyModalBody');

  modalName.textContent = `Histórico de ${name || 'cliente sem nome'}`;
  modalBody.innerHTML = '<p class="muted">Carregando histórico...</p>';
  modal.classList.remove('hidden');

  if (!jid) {
    modalBody.innerHTML = '<p class="muted">Este pedido não tem um telefone/JID associado.</p>';
    return;
  }

  try {
    const url = new URL(API_URL, window.location.origin);
    url.searchParams.set('customerJid', jid);
    url.searchParams.set('limit', '200');
    const response = await fetch(url, { headers: { Authorization: getAuthHeader() } });
    if (!response.ok) {
      modalBody.innerHTML = '<p class="muted">Não foi possível carregar o histórico.</p>';
      return;
    }
    const orders = await response.json();
    renderCustomerHistory(orders);
  } catch (err) {
    console.error('Erro ao carregar histórico do cliente:', err);
    modalBody.innerHTML = '<p class="muted">Erro de conexão ao carregar o histórico.</p>';
  }
}

function renderCustomerHistory(orders) {
  const modalBody = document.getElementById('historyModalBody');

  if (!orders.length) {
    modalBody.innerHTML = '<p class="muted">Nenhum pedido encontrado para este cliente.</p>';
    return;
  }

  const totalGasto = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const totalPago = orders.reduce((sum, o) => sum + Number(o.valorPago || 0), 0);

  modalBody.innerHTML = `
    <div class="history-summary">
      <span><b>${orders.length}</b> pedido(s)</span>
      <span>Total gasto: <b>${formatCurrency(totalGasto)}</b></span>
      <span>Total pago: <b>${formatCurrency(totalPago)}</b></span>
    </div>
    <div class="history-list">
      ${orders.map((order) => {
        const items = order.items?.map((item) => {
          const qty = item.quantity === 1 ? '1 pacote' : `${item.quantity} pacotes`;
          return `<li><span>${escapeHtmlGlobal(`${qty} de ${item.name}`)}</span><span>${formatCurrency(item.price * item.quantity)}</span></li>`;
        }).join('') || '';
        const statusLabel = STATUS_LABELS[order.status] || escapeHtmlGlobal(order.status);
        const valorPago = Number(order.valorPago || 0);
        const falta = Math.max(Number(order.total || 0) - valorPago, 0);
        const paymentInfo = valorPago > 0
          ? `<div class="history-payment">Pago: ${formatCurrency(valorPago)} · Falta: ${formatCurrency(falta)}</div>`
          : '';

        return `
          <div class="history-item status-${escapeHtmlGlobal(order.status)}">
            <div class="history-item-top">
              <span class="history-date">${escapeHtmlGlobal(new Date(order.createdAt).toLocaleString('pt-BR'))}</span>
              <span class="status">${escapeHtmlGlobal(statusLabel)}</span>
            </div>
            <ul class="order-items">${items}</ul>
            <div class="order-total-row">
              <span class="label">Total do pedido</span>
              <span class="value">${formatCurrency(order.total)}</span>
            </div>
            ${paymentInfo}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function closeHistoryModal() {
  document.getElementById('historyModal').classList.add('hidden');
}

function getOrderItemsFromEditor(orderIdx) {
  const rows = Array.from(document.querySelectorAll(`.order-edit-item-row[data-idx="${orderIdx}"]`));
  return rows.map((row) => ({
    productId: row.dataset.productId ? Number(row.dataset.productId) : undefined,
    name: row.dataset.name || '',
    price: Number(row.dataset.price || 0),
    quantity: Number(row.querySelector('.order-edit-item-qty').value || 1),
  }));
}

function updateOrderEditSummary(orderIdx) {
  const container = document.querySelector(`.order-edit-items[data-idx="${orderIdx}"]`);
  if (!container) return;

  const rows = Array.from(container.querySelectorAll('.order-edit-item-row'));
  let total = 0;

  rows.forEach((row) => {
    const quantity = Number(row.querySelector('.order-edit-item-qty').value || 1);
    const price = Number(row.dataset.price || 0);
    const itemTotal = quantity * price;
    total += itemTotal;
    const priceEl = row.querySelector('.order-edit-item-price');
    if (priceEl) priceEl.textContent = formatCurrency(itemTotal);
  });

  const totalEl = container.querySelector('.order-edit-total-value');
  if (totalEl) totalEl.textContent = formatCurrency(total);
}

function buildOrderEditItemsMarkup(order, orderIdx) {
  const menuOptions = (currentMenu || [])
    .filter((item) => item.active)
    .map((item) => `
      <option value="${item.id}" data-name="${escapeHtmlGlobal(item.name)}" data-price="${Number(item.price || 0)}">
        ${escapeHtmlGlobal(item.name)} — ${formatCurrency(item.price)}
      </option>
    `)
    .join('');

  const itemsMarkup = (order.items || []).map((item, itemIdx) => `
    <div class="order-edit-item-row" data-idx="${orderIdx}" data-product-id="${item.productId || ''}" data-name="${escapeHtmlGlobal(item.name)}" data-price="${Number(item.price || 0)}">
      <div class="order-edit-item-main">
        <span class="order-edit-item-name">${escapeHtmlGlobal(item.name)}</span>
        <div class="order-edit-item-controls">
          <input type="number" min="1" class="order-edit-item-qty" data-idx="${orderIdx}" value="${Number(item.quantity || 1)}" />
          <span class="order-edit-item-price">${formatCurrency(Number(item.price || 0) * Number(item.quantity || 1))}</span>
          <button type="button" class="remove-order-item-button" data-idx="${orderIdx}">Remover</button>
        </div>
      </div>
    </div>
  `).join('');

  const total = (order.items || []).reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);

  return `
    <div class="order-edit-items" data-idx="${orderIdx}">
      <div class="order-edit-items-list">
        ${itemsMarkup || '<div class="muted">Nenhum item neste pedido.</div>'}
      </div>
      <div class="order-edit-item-adder">
        <select class="order-edit-item-select" data-idx="${orderIdx}">
          ${menuOptions || '<option value="">Nenhum item ativo</option>'}
        </select>
        <input type="number" min="1" class="order-edit-item-add-qty" data-idx="${orderIdx}" value="1" />
        <button type="button" class="add-order-item-button" data-idx="${orderIdx}">Adicionar</button>
      </div>
      <div class="order-edit-total">
        <span>Total estimado</span>
        <strong class="order-edit-total-value">${formatCurrency(total)}</strong>
      </div>
    </div>
  `;
}

function renderOrders(orders) {
  currentOrders = orders;
  orders.forEach((o) => knownOrderIds.add(String(o._id)));
  renderFilteredOrders();
  renderSalesSummary(orders);
  renderItemsChart(orders);
}

const DIAS_ALERTA_DEVENDO = 3;
function diasEmAberto(createdAt) {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function renderItemsChart(orders) {
  const panel = document.getElementById('itemsChartPanel');
  if (!panel) return;

  const totals = {};
  orders.forEach((order) => {
    if (order.status === 'cancelado') return;
    (order.items || []).forEach((item) => {
      totals[item.name] = (totals[item.name] || 0) + Number(item.quantity || 0);
    });
  });

  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 8);

  if (!entries.length) {
    panel.innerHTML = '';
    return;
  }

  const max = entries[0][1];

  panel.innerHTML = `
    <h3 class="chart-title">🥖 Itens mais vendidos</h3>
    <div class="chart-bars">
      ${entries.map(([name, qty]) => `
        <div class="chart-bar-row">
          <span class="chart-bar-label">${escapeHtmlGlobal(name)}</span>
          <div class="chart-bar-track">
            <div class="chart-bar-fill" style="width: ${Math.max((qty / max) * 100, 4)}%"></div>
          </div>
          <span class="chart-bar-value">${qty}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderSalesSummary(orders) {
  const totalRevenue = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const totalPaid = orders.reduce((sum, o) => sum + Number(o.valorPago || 0), 0);
  const totalDue = orders.reduce((sum, o) => sum + Math.max(Number(o.total || 0) - Number(o.valorPago || 0), 0), 0);

  const summaryHtml = `
    <div class="sales-summary">
      <div><strong>${formatCurrency(totalRevenue)}</strong><span>Total vendido</span></div>
      <div><strong>${formatCurrency(totalPaid)}</strong><span>Total pago</span></div>
      <div><strong>${formatCurrency(totalDue)}</strong><span>Total em aberto</span></div>
    </div>
  `;

  const summaryContainer = document.getElementById('salesSummary');
  if (summaryContainer) summaryContainer.innerHTML = summaryHtml;
}

function renderFilteredOrders() {
  const term = (document.getElementById('search').value || '').trim().toLowerCase();
  const filtered = term
    ? currentOrders.filter((o) => {
        const name = (o.customerName || '').toLowerCase();
        const phone = (o.customerJid || '').toLowerCase();
        return name.includes(term) || phone.includes(term);
      })
    : currentOrders;

  // Ordena os cards em ordem alfabética pelo nome do cliente
  const orders = [...filtered].sort((a, b) =>
    (a.customerName || '').localeCompare(b.customerName || '', 'pt-BR', { sensitivity: 'base' })
  );

  const container = document.getElementById('orders');
  document.getElementById('count').textContent = orders.length;
  document.getElementById('pendentes').textContent = orders.filter((o) => o.status === 'pendente').length;
  document.getElementById('total').textContent = formatCurrency(orders.reduce((sum, o) => sum + Number(o.total || 0), 0));

  if (!orders.length) {
    container.innerHTML = '<div class="empty">Nenhum pedido encontrado.</div>';
    return;
  }

  container.innerHTML = orders.map((order, idx) => {
    const escapeHtml = (value) => String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');

    const name = escapeHtml(order.customerName || 'Cliente sem nome');
    const items = order.items?.map((item) => {
      const qty = item.quantity === 1 ? '1 pacote' : `${item.quantity} pacotes`;
      return `<li><span>${escapeHtml(`${qty} de ${item.name}`)}</span><span>${formatCurrency(item.price * item.quantity)}</span></li>`;
    }).join('') || '';
    const statusLabel = STATUS_LABELS[order.status] || escapeHtml(order.status);

    const valorPago = Number(order.valorPago || 0);
    const falta = Math.max(Number(order.total || 0) - valorPago, 0);
    const paymentInfoHtml = valorPago > 0 ? `
          <div class="order-total-row payment-row">
            <span class="label">Pago / Falta</span>
            <span class="value">${formatCurrency(valorPago)} / ${formatCurrency(falta)}</span>
          </div>` : '';

    const dias = diasEmAberto(order.createdAt);
    const isOverdueDebt = order.status === 'devendo' && dias >= DIAS_ALERTA_DEVENDO;
    const overdueClass = isOverdueDebt ? 'overdue-debt' : '';
    const overdueBadgeHtml = isOverdueDebt
      ? `<div class="overdue-badge">⚠️ Devendo há ${dias} dia${dias === 1 ? '' : 's'}</div>`
      : '';

    return `
      <article class="order-card status-${escapeHtml(order.status)} ${overdueClass}">
        ${overdueBadgeHtml}
        <div class="order-top">
          <div class="avatar">${escapeHtml(initials(order.customerName || 'Cliente sem nome'))}</div>
          <div class="order-who customer-link" data-jid="${escapeHtml(order.customerJid || '')}" data-name="${escapeHtml(order.customerName || '')}" title="Ver histórico deste cliente">
            <div class="order-name">${name}</div>
            <div class="order-phone">📱 ${escapeHtml(formatPhone(order.customerJid))}</div>
          </div>
          <span class="status">${escapeHtml(statusLabel)}</span>
        </div>
        <div class="order-body">
          <ul class="order-items">${items}</ul>
          <div class="order-total-row">
            <span class="label">Total do pedido</span>
            <span class="value">${formatCurrency(order.total)}</span>
          </div>
          ${paymentInfoHtml}
        </div>
        <div class="status-actions">
          <button class="status-button ${order.status === 'pendente' ? 'active' : ''}" type="button" data-id="${escapeHtml(order._id)}" data-idx="${idx}" data-status="pendente">Pendente</button>
          <button class="status-button ${order.status === 'devendo' ? 'active' : ''}" type="button" data-id="${escapeHtml(order._id)}" data-idx="${idx}" data-status="devendo">Devendo</button>
          <button class="status-button ${order.status === 'ok' ? 'active' : ''}" type="button" data-id="${escapeHtml(order._id)}" data-idx="${idx}" data-status="ok">Ok</button>
        </div>
        <div class="card-actions">
          <button class="edit-order-button" data-id="${escapeHtml(order._id)}" data-idx="${idx}">Editar</button>
          <button class="delete-order-button" data-id="${escapeHtml(order._id)}" data-idx="${idx}">Excluir</button>
        </div>
        <button class="details-toggle" data-idx="${idx}">▾ Mais detalhes</button>
        <div class="order-details hidden" data-idx="${idx}">
          <div><b>Pedido:</b> #${escapeHtml(String(order._id).slice(-6))}</div>
          <div><b>Criado em:</b> ${escapeHtml(new Date(order.createdAt).toLocaleString('pt-BR'))}</div>
          <div class="edit-panel hidden" data-idx="${idx}">
            <div class="edit-field">
              <label for="name-${idx}">Nome do cliente</label>
              <input id="name-${idx}" type="text" value="${escapeHtml(order.customerName || '')}" />
            </div>
            <div class="edit-field">
              <label for="phone-${idx}">Telefone / JID</label>
              <input id="phone-${idx}" type="text" value="${escapeHtml(order.customerJid || '')}" />
            </div>
            <div class="edit-field">
              <label for="status-${idx}">Status</label>
              <select id="status-${idx}">
                <option value="pendente" ${order.status === 'pendente' ? 'selected' : ''}>Pendente</option>
                <option value="devendo" ${order.status === 'devendo' ? 'selected' : ''}>Devendo</option>
                <option value="ok" ${order.status === 'ok' ? 'selected' : ''}>Ok</option>
                <option value="confirmado" ${order.status === 'confirmado' ? 'selected' : ''}>Confirmado</option>
                <option value="entregue" ${order.status === 'entregue' ? 'selected' : ''}>Entregue</option>
                <option value="cancelado" ${order.status === 'cancelado' ? 'selected' : ''}>Cancelado</option>
              </select>
            </div>
            <div class="edit-field">
              <label>Itens do pedido</label>
              ${buildOrderEditItemsMarkup(order, idx)}
            </div>
            <div class="edit-field">
              <label for="valorPago-${idx}">Valor pago</label>
              <input id="valorPago-${idx}" type="number" step="0.01" min="0" value="${Number(order.valorPago || 0).toFixed(2)}" />
            </div>
            <div class="edit-actions">
              <button class="save-order-button" data-id="${escapeHtml(order._id)}" data-idx="${idx}">Salvar alterações</button>
              <button class="cancel-edit-button" type="button" data-idx="${idx}">Cancelar</button>
              <button class="delete-order-panel-button" type="button" data-id="${escapeHtml(order._id)}" data-idx="${idx}">Excluir pedido</button>
            </div>
            <div class="order-action-message" data-idx="${idx}"></div>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = document.getElementById('senhaInput').value;
    document.getElementById('loginError').textContent = '';
    if (!password) {
      document.getElementById('loginError').textContent = 'Digite a senha.';
      return;
    }
    await tryLogin(password);
  });

  document.getElementById('addMenuForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const nameInput = document.getElementById('newItemName');
    const priceInput = document.getElementById('newItemPrice');
    const name = nameInput.value.trim();
    const price = Number(priceInput.value);

    if (!name || Number.isNaN(price) || price < 0) {
      alert('Preencha nome e preço válidos.');
      return;
    }

    try {
      await addMenuItem(name, price);
      nameInput.value = '';
      priceInput.value = '';
      await loadMenu();
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  });

  document.getElementById('exportCsv').addEventListener('click', () => {
    exportOrdersToCsv();
  });

  document.getElementById('exportPdf').addEventListener('click', () => {
    exportOrdersToPdf();
  });

  document.getElementById('openNewOrder').addEventListener('click', () => {
    openNewOrderModal();
  });

  document.getElementById('addNewOrderItem').addEventListener('click', () => {
    addItemToNewOrder();
  });

  document.getElementById('newOrderForm').addEventListener('submit', submitNewOrder);

  loadPage();
});

document.addEventListener('click', async (event) => {
  if (event.target.id === 'refresh') {
    loadOrders();
    return;
  }

  const customerTrigger = event.target.closest('.customer-link');
  if (customerTrigger) {
    openCustomerHistory(customerTrigger.dataset.jid, customerTrigger.dataset.name);
    return;
  }

  if (event.target.id === 'closeHistoryModal' || event.target.id === 'historyModal') {
    closeHistoryModal();
    return;
  }

  if (event.target.id === 'closeNewOrderModal' || event.target.id === 'newOrderModal') {
    closeNewOrderModal();
    return;
  }

  if (event.target.classList.contains('remove-new-order-item')) {
    const idx = Number(event.target.dataset.removeIdx);
    removeItemFromNewOrder(idx);
    return;
  }

  if (event.target.id === 'toggleMenu') {
    const section = document.getElementById('menuSection');
    const isHidden = section.classList.contains('hidden');
    section.classList.toggle('hidden');
    if (isHidden) await loadMenu();
    return;
  }

  if (event.target.classList.contains('save-menu-item-button')) {
    const id = event.target.dataset.menuId;
    const row = document.querySelector(`.menu-item-row[data-menu-id="${id}"]`);
    const name = row.querySelector('.menu-item-name').value.trim();
    const price = Number(row.querySelector('.menu-item-price').value);
    const active = row.querySelector('.menu-item-active').checked;

    if (!name || Number.isNaN(price)) {
      alert('Preencha nome e preço válidos.');
      return;
    }

    try {
      await saveMenuItem(id, { name, price, active });
      await loadMenu();
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
    return;
  }

  if (event.target.classList.contains('delete-menu-item-button')) {
    const id = event.target.dataset.menuId;
    const confirmDelete = window.confirm('Excluir este item do cardápio? Essa ação não pode ser desfeita.');
    if (!confirmDelete) return;

    try {
      await deleteMenuItem(id);
      await loadMenu();
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
    return;
  }

  if (event.target.classList.contains('details-toggle')) {
    const idx = event.target.dataset.idx;
    const panel = document.querySelector(`.order-details[data-idx="${idx}"]`);
    panel.classList.toggle('hidden');
    event.target.textContent = panel.classList.contains('hidden') ? '▾ Mais detalhes' : '▴ Menos detalhes';
    return;
  }

  if (event.target.classList.contains('edit-order-button')) {
    const idx = event.target.dataset.idx;
    const orderDetail = document.querySelector(`.order-details[data-idx="${idx}"]`);
    const editPanel = document.querySelector(`.edit-panel[data-idx="${idx}"]`);
    orderDetail.classList.remove('hidden');
    editPanel.classList.toggle('hidden');
    return;
  }

  if (event.target.classList.contains('cancel-edit-button')) {
    const idx = event.target.dataset.idx;
    const editPanel = document.querySelector(`.edit-panel[data-idx="${idx}"]`);
    if (editPanel) editPanel.classList.add('hidden');
    return;
  }

  if (event.target.classList.contains('add-order-item-button')) {
    const idx = event.target.dataset.idx;
    const select = document.querySelector(`.order-edit-item-select[data-idx="${idx}"]`);
    const qtyInput = document.querySelector(`.order-edit-item-add-qty[data-idx="${idx}"]`);
    const container = document.querySelector(`.order-edit-items[data-idx="${idx}"]`);

    if (!select || !container) return;

    const selectedOption = select.selectedOptions[0];
    if (!selectedOption || !selectedOption.value) {
      alert('Selecione um item do cardápio antes de adicionar.');
      return;
    }

    const name = selectedOption.dataset.name || selectedOption.textContent;
    const price = Number(selectedOption.dataset.price || 0);
    const quantity = Number(qtyInput.value || 1);
    const list = container.querySelector('.order-edit-items-list');

    const row = document.createElement('div');
    row.className = 'order-edit-item-row';
    row.dataset.idx = idx;
    row.dataset.productId = selectedOption.value;
    row.dataset.name = name;
    row.dataset.price = price;
    row.innerHTML = `
      <div class="order-edit-item-main">
        <span class="order-edit-item-name">${escapeHtmlGlobal(name)}</span>
        <div class="order-edit-item-controls">
          <input type="number" min="1" class="order-edit-item-qty" data-idx="${idx}" value="${quantity}" />
          <span class="order-edit-item-price">${formatCurrency(price * quantity)}</span>
          <button type="button" class="remove-order-item-button" data-idx="${idx}">Remover</button>
        </div>
      </div>
    `;

    list.appendChild(row);
    updateOrderEditSummary(idx);
    return;
  }

  if (event.target.classList.contains('remove-order-item-button')) {
    const idx = event.target.dataset.idx;
    const row = event.target.closest('.order-edit-item-row');
    if (row) row.remove();
    updateOrderEditSummary(idx);
    return;
  }

  if (event.target.classList.contains('status-button')) {
    const orderId = event.target.dataset.id;
    const idx = event.target.dataset.idx;
    const status = event.target.dataset.status;
    const messageEl = document.querySelector(`.order-action-message[data-idx="${idx}"]`);
    if (messageEl) messageEl.textContent = 'Atualizando status...';

    try {
      await patchOrder(orderId, { status });
      await loadOrders();
      if (messageEl) messageEl.textContent = 'Status atualizado.';
    } catch (err) {
      console.error(err);
      if (messageEl) messageEl.textContent = err.message;
    }
    return;
  }

  if (event.target.classList.contains('save-order-button')) {
    const orderId = event.target.dataset.id;
    const idx = event.target.dataset.idx;
    const messageEl = document.querySelector(`.order-action-message[data-idx="${idx}"]`);
    messageEl.textContent = 'Salvando...';

    const items = getOrderItemsFromEditor(idx);
    if (!items.length) {
      messageEl.textContent = 'Adicione pelo menos um item ao pedido.';
      return;
    }

    const total = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
    const updates = {
      customerName: document.getElementById(`name-${idx}`).value.trim(),
      customerJid: document.getElementById(`phone-${idx}`).value.trim(),
      status: document.getElementById(`status-${idx}`).value,
      items,
      total,
      valorPago: Number(document.getElementById(`valorPago-${idx}`).value || 0),
    };

    try {
      await patchOrder(orderId, updates);
      await loadOrders();
      messageEl.textContent = 'Pedido atualizado com sucesso.';
    } catch (err) {
      console.error(err);
      messageEl.textContent = err.message;
    }
    return;
  }

  if (event.target.classList.contains('delete-order-button') || event.target.classList.contains('delete-order-panel-button')) {
    const orderId = event.target.dataset.id;
    const idx = event.target.dataset.idx;
    const messageEl = document.querySelector(`.order-action-message[data-idx="${idx}"]`);
    const confirmDelete = window.confirm('Deseja realmente excluir este pedido? Esta ação não pode ser desfeita.');
    if (!confirmDelete) return;

    if (messageEl) messageEl.textContent = 'Excluindo...';
    try {
      await deleteOrder(orderId);
      await loadOrders();
    } catch (err) {
      console.error(err);
      if (messageEl) messageEl.textContent = err.message;
    }
    return;
  }
});

document.addEventListener('change', (event) => {
  if (['fromDay', 'toDay', 'status'].includes(event.target.id)) {
    loadOrders();
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'search') {
    renderFilteredOrders();
  }

  if (event.target.classList.contains('order-edit-item-qty')) {
    updateOrderEditSummary(event.target.dataset.idx);
  }
});

window.addEventListener('focus', () => {
  document.title = 'Padaria — Pedidos';
});