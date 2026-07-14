const DEFAULT_API_HOST = 'https://padaria-bot-cbf7.onrender.com';
const API_DASHBOARD_URL = window.PADARIA_API_DASHBOARD_URL || DEFAULT_API_HOST + '/api/dashboard';

let revenueChart = null;
let lastSelected = { dailyRevenue: [], topItems: [] };

function getAuthHeader() {
  const pass = sessionStorage.getItem('painelSenha');
  return 'Basic ' + btoa('padaria:' + (pass || ''));
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('appContent').classList.add('hidden');
}

function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appContent').classList.remove('hidden');
}

function buildDashboardUrl() {
  const period = document.getElementById('periodSelect').value;
  let url;
  try {
    url = new URL(API_DASHBOARD_URL);
  } catch (e) {
    url = new URL(API_DASHBOARD_URL, location.origin);
  }
  url.searchParams.set('period', period);
  if (period === 'custom') {
    const start = document.getElementById('startDate').value;
    const end = document.getElementById('endDate').value;
    if (start) url.searchParams.set('start', start);
    if (end) url.searchParams.set('end', end);
  }
  return url;
}

function renderSummaryCards(data) {
  document.getElementById('last24hTotal').textContent = formatCurrency(data.last24h?.total);
  document.getElementById('last24hCount').textContent = data.last24h?.count ?? 0;
  document.getElementById('weekTotal').textContent = formatCurrency(data.week?.total);
  document.getElementById('weekCount').textContent = data.week?.count ?? 0;
  document.getElementById('monthTotal').textContent = formatCurrency(data.month?.total);
  document.getElementById('monthCount').textContent = data.month?.count ?? 0;
  document.getElementById('yearTotal').textContent = formatCurrency(data.year?.total);
  document.getElementById('yearCount').textContent = data.year?.count ?? 0;
}

function renderRevenueChart(dailyRevenue) {
  const ctx = document.getElementById('revenueChart').getContext('2d');
  const labels = dailyRevenue.map((d) => new Date(d.date + 'T00:00:00').toLocaleDateString('pt-BR'));
  const values = dailyRevenue.map((d) => Math.round(d.total * 100) / 100);

  if (revenueChart) {
    revenueChart.destroy();
    revenueChart = null;
  }

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const tickColor = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)';
  const areaBg = isDark ? 'rgba(224,113,79,0.12)' : 'rgba(168,68,46,0.12)';
  const lineColor = isDark ? '#e0714f' : '#a8442e';

  const maxVal = Math.max(...values, 0);
  const suggestedMax = Math.max(Math.ceil(maxVal * 1.2), 1);

  revenueChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Receita (R$)',
        data: values,
        borderColor: lineColor,
        backgroundColor: areaBg,
        tension: 0.25,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          suggestedMax,
          ticks: { callback: (v) => formatCurrency(v), color: tickColor },
          grid: { color: gridColor },
        },
        x: {
          ticks: { color: tickColor },
          grid: { color: 'transparent' },
        },
      },
    },
  });
}

function renderTopItems(topItems) {
  const panel = document.getElementById('itemsChartPanel');
  if (!panel) return;

  if (!topItems.length) {
    panel.innerHTML = '<h3 class="chart-title">🥖 Itens mais vendidos</h3><div class="empty">Nenhum item vendido nesse período.</div>';
    return;
  }

  const max = Number(topItems[0].qty) || 1;
  panel.innerHTML = `
    <h3 class="chart-title">🥖 Itens mais vendidos</h3>
    <div class="chart-bars">
      ${topItems.map((item) => {
        const qty = Number(item.qty) || 0;
        const width = Math.max((qty / max) * 100, 4);
        return `
        <div class="chart-bar-row">
          <span class="chart-bar-label">${escapeHtml(item.name)}</span>
          <div class="chart-bar-track">
            <div class="chart-bar-fill" style="width: ${width}%"></div>
          </div>
          <span class="chart-bar-value">${qty}</span>
        </div>
      `}).join('')}
    </div>
  `;
}

// Atualiza a pílula/badge do floating dot. Disponível em escopo global
function updateFloatingBadge() {
  const badge = document.getElementById('floatingBadge');
  if (!badge) return;
  // Se houver contador de pendentes na página (como em pedidos), use-o.
  const pendentesEl = document.getElementById('pendentes');
  const count = pendentesEl ? Number(pendentesEl.textContent) || 0 : ((lastSelected && Array.isArray(lastSelected.topItems)) ? lastSelected.topItems.length : 0);
  if (count > 0) {
    badge.textContent = String(count);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function loadDashboard(isLoginAttempt = false) {
  const errorEl = document.getElementById('loginError');
  if (isLoginAttempt) errorEl.textContent = 'Verificando...';

  let response;
  try {
    response = await fetch(buildDashboardUrl(), {
      headers: { Authorization: getAuthHeader() },
    });
  } catch (err) {
    if (isLoginAttempt) errorEl.textContent = 'Não foi possível conectar ao servidor.';
    console.error('Erro de rede ao buscar dashboard:', err);
    return;
  }

  if (response.status === 401) {
    sessionStorage.removeItem('painelSenha');
    showLogin();
    if (isLoginAttempt) errorEl.textContent = 'Senha incorreta.';
    return;
  }

  if (!response.ok) {
    if (isLoginAttempt) errorEl.textContent = `Erro ao carregar (${response.status}).`;
    return;
  }

  const data = await response.json();
  showApp();

  renderSummaryCards(data);
  lastSelected = data.selected || { dailyRevenue: [], topItems: [] };
  renderRevenueChart(lastSelected.dailyRevenue);
  renderTopItems(lastSelected.topItems);
  if (typeof window.updateFloatingBadge === 'function') window.updateFloatingBadge();
}

function tryLogin(password) {
  sessionStorage.setItem('painelSenha', password);
  return loadDashboard(true);
}

function exportSelectedToCsv() {
  const rows = lastSelected.dailyRevenue.map((d) => [d.date, d.total]);
  const csv = [['data', 'receita'].join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `padaria_dashboard_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function applyStoredTheme() {
  const isDark = localStorage.getItem('padaria_theme') === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : '');
  document.getElementById('darkToggle').checked = isDark;
}

document.addEventListener('DOMContentLoaded', () => {
  applyStoredTheme();

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

  document.getElementById('refresh').addEventListener('click', () => loadDashboard());

  document.getElementById('periodSelect').addEventListener('change', () => {
    const isCustom = document.getElementById('periodSelect').value === 'custom';
    document.getElementById('startDate').classList.toggle('hidden', !isCustom);
    document.getElementById('endDate').classList.toggle('hidden', !isCustom);
    loadDashboard();
  });
  document.getElementById('startDate').addEventListener('change', () => loadDashboard());
  document.getElementById('endDate').addEventListener('change', () => loadDashboard());

  document.getElementById('exportCsv').addEventListener('click', exportSelectedToCsv);

  document.getElementById('darkToggle').addEventListener('change', (event) => {
    const isDark = event.target.checked;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : '');
    localStorage.setItem('padaria_theme', isDark ? 'dark' : '');
    if (lastSelected.dailyRevenue.length) renderRevenueChart(lastSelected.dailyRevenue);
  });

  const storedPassword = sessionStorage.getItem('painelSenha');
  if (storedPassword) {
    loadDashboard();
  } else {
    showLogin();
  }

  // Quick actions: move controls into floating menu when toggled
  const quickBtn = document.getElementById('quickActionsBtn');
  const quickMenu = document.getElementById('quickActionsMenu');
  const controlsPlaceholder = document.getElementById('controlsPlaceholder');
  const controlsEl = controlsPlaceholder ? controlsPlaceholder.querySelector('.controls') : null;

  const quickOverlay = document.getElementById('quickActionsOverlay');

  function closeQuickMenu() {
    if (!quickMenu || !controlsPlaceholder || !controlsEl) return;
    quickMenu.classList.remove('side-open');
    quickMenu.classList.add('side-closed');
    quickMenu.setAttribute('aria-hidden', 'true');
    quickBtn.setAttribute('aria-expanded', 'false');
    if (quickOverlay) quickOverlay.classList.remove('visible');
    // move controls back after animation completes
    setTimeout(() => {
      try { controlsPlaceholder.appendChild(controlsEl); } catch (e) {}
    }, 350);
  }

  function openQuickMenu() {
    if (!quickMenu || !controlsPlaceholder || !controlsEl) return;
    quickMenu.classList.remove('side-closed');
    quickMenu.classList.add('side-open');
    quickMenu.setAttribute('aria-hidden', 'false');
    quickBtn.setAttribute('aria-expanded', 'true');
    if (quickOverlay) quickOverlay.classList.add('visible');
    // move controls into menu
    quickMenu.appendChild(controlsEl);
  }

  if (quickBtn) {
    quickBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!quickMenu) return;
      if (quickMenu.classList.contains('hidden')) openQuickMenu(); else closeQuickMenu();
    });
    // close when clicking outside or on overlay
    document.addEventListener('click', (ev) => {
      if (!quickMenu) return;
      if (quickMenu.classList.contains('side-closed')) return;
      if (!quickMenu.contains(ev.target) && ev.target !== quickBtn) closeQuickMenu();
    });
    if (quickOverlay) quickOverlay.addEventListener('click', closeQuickMenu);
  }

  // Floating bottom bar (center) and minimize to dot
  const floatingBar = document.getElementById('floatingBar');
  const floatingBarContent = document.getElementById('floatingBarContent');
  const floatingBarClose = document.getElementById('floatingBarClose');
  const floatingDot = document.getElementById('floatingDot');

  function showFloatingBar() {
    if (!floatingBar || !controlsPlaceholder || !controlsEl) return;
    // ensure controls are available
    try { floatingBarContent.appendChild(controlsEl); } catch (e) {}
    floatingBar.classList.remove('hidden');
    if (floatingDot) floatingDot.classList.add('hidden');
    // animate children with stagger
    try {
      const children = Array.from(controlsEl.children || []);
      children.forEach((ch, i) => {
        ch.style.transition = 'opacity 320ms ease, transform 320ms ease';
        ch.style.opacity = '0';
        ch.style.transform = 'translateY(10px)';
      });
      // force reflow then play
      void controlsEl.offsetHeight;
      children.forEach((ch, i) => {
        ch.style.transitionDelay = (i * 60) + 'ms';
        ch.style.opacity = '1';
        ch.style.transform = 'translateY(0)';
      });
    } catch (e) {}
  }

  function minimizeFloatingBar() {
    if (!floatingBar || !controlsPlaceholder || !controlsEl) return;
    floatingBar.classList.add('hidden');
    // move controls back to placeholder after animation
    setTimeout(() => {
      try { controlsPlaceholder.appendChild(controlsEl); } catch (e) {}
    }, 300);
    if (floatingDot) floatingDot.classList.remove('hidden');
  }

  // window.updateFloatingBadge está definido em escopo global (fora do DOMContentLoaded)

  // Close button minimizes to dot
  if (floatingBarClose) floatingBarClose.addEventListener('click', minimizeFloatingBar);
  // Dot restores the bar
  if (floatingDot) floatingDot.addEventListener('click', (e) => { e.stopPropagation(); showFloatingBar(); });

  // Start with bar visible if controls exist
  if (controlsEl && floatingBar) showFloatingBar();
  window.updateFloatingBadge();

  // Barra de navegação rápida (pílula): Pedidos + Cardápio, minimizável em bolinha
  const quickNavBar = document.getElementById('quickNavBar');
  const quickNavClose = document.getElementById('quickNavClose');
  const quickNavDot = document.getElementById('quickNavDot');

  function hideQuickNav() {
    if (!quickNavBar || !quickNavDot) return;
    if (quickNavBar.contains(document.activeElement) && document.activeElement.blur) {
      document.activeElement.blur();
    }
    quickNavBar.classList.add('hidden');
    quickNavBar.setAttribute('aria-hidden', 'true');
    quickNavDot.classList.remove('hidden');
  }

  function showQuickNav() {
    if (!quickNavBar || !quickNavDot) return;
    quickNavBar.classList.remove('hidden');
    quickNavBar.setAttribute('aria-hidden', 'false');
    quickNavDot.classList.add('hidden');
  }

  if (quickNavClose) quickNavClose.addEventListener('click', hideQuickNav);
  if (quickNavDot) quickNavDot.addEventListener('click', (e) => { e.stopPropagation(); showQuickNav(); });
});