const API_URL = 'https://padaria-bot-cbf7.onrender.com/api/orders';
const API_MENU_URL = 'https://padaria-bot-cbf7.onrender.com/api/menu';
let currentOrders = [];
let currentMenu = [];
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
  pollInterval = setInterval(checkForNewOrders, 20000);
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
  const day = document.getElementById('day').value;
  const status = document.getElementById('status').value;
  const url = new URL(API_URL);
  if (day) url.searchParams.set('day', day);
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

function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

function renderOrders(orders) {
  currentOrders = orders;
  orders.forEach((o) => knownOrderIds.add(String(o._id)));
  renderFilteredOrders();
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

    return `
      <article class="order-card status-${escapeHtml(order.status)}">
        <div class="order-top">
          <div class="avatar">${escapeHtml(initials(order.customerName || 'Cliente sem nome'))}</div>
          <div class="order-who">
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
              <label for="total-${idx}">Total</label>
              <input id="total-${idx}" type="number" step="0.01" value="${Number(order.total || 0).toFixed(2)}" />
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

  loadPage();
});

document.addEventListener('click', async (event) => {
  if (event.target.id === 'refresh') {
    loadOrders();
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

    const updates = {
      customerName: document.getElementById(`name-${idx}`).value.trim(),
      customerJid: document.getElementById(`phone-${idx}`).value.trim(),
      status: document.getElementById(`status-${idx}`).value,
      total: Number(document.getElementById(`total-${idx}`).value || 0),
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
  if (event.target.id === 'day' || event.target.id === 'status') {
    loadOrders();
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'search') {
    renderFilteredOrders();
  }
});

window.addEventListener('focus', () => {
  document.title = 'Padaria — Pedidos';
});
