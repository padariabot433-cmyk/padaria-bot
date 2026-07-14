(() => {
  const qs = sel => document.querySelector(sel);
  const $app = qs('#appContent');
  const $login = qs('#loginScreen');
  const $loginForm = qs('#loginForm');
  const $senhaInput = qs('#senhaInput');
  const $loginError = qs('#loginError');

  const $last24hTotal = qs('#last24hTotal');
  const $last24hCount = qs('#last24hCount');
  const $weekTotal = qs('#weekTotal');
  const $weekCount = qs('#weekCount');
  const $monthTotal = qs('#monthTotal');
  const $monthCount = qs('#monthCount');
  const $yearTotal = qs('#yearTotal');
  const $yearCount = qs('#yearCount');

  const $periodSelect = qs('#periodSelect');
  const $startDate = qs('#startDate');
  const $endDate = qs('#endDate');
  const $refresh = qs('#refresh');
  const $exportCsv = qs('#exportCsv');
  const $darkToggle = qs('#darkToggle');
  const revenueCtx = document.getElementById('revenueChart').getContext('2d');
  let revenueChart = null;

  function formatCurrency(v){
    return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v);
  }

  function saveOrders(orders){ localStorage.setItem('padaria_orders', JSON.stringify(orders)); }
  function loadOrders(){
    const s = localStorage.getItem('padaria_orders');
    if(s) return JSON.parse(s);
    const generated = generateMockOrders();
    saveOrders(generated);
    return generated;
  }

  function randomBetween(min,max){ return Math.random()*(max-min)+min; }

  function generateMockOrders(){
    const items = [
      {name:'Pão Francês', price:1.2}, {name:'Café', price:3.5}, {name:'Croissant', price:4.0},
      {name:'Pão de Queijo', price:2.5}, {name:'Bolo Fatia', price:6.5}, {name:'Sanduíche', price:8.0},
      {name:'Suco Natural', price:5.0}
    ];
    const now = Date.now();
    const orders = [];
    for(let i=0;i<240;i++){
      const daysAgo = Math.floor(Math.random()*365);
      const date = new Date(now - daysAgo*24*60*60*1000 - Math.floor(Math.random()*24*60*60*1000));
      const itemCount = 1 + Math.floor(Math.random()*4);
      const chosen = [];
      let total = 0;
      for(let j=0;j<itemCount;j++){
        const it = items[Math.floor(Math.random()*items.length)];
        const qty = 1 + Math.floor(Math.random()*3);
        chosen.push({name:it.name, qty, price:it.price});
        total += it.price*qty;
      }
      const status = Math.random() < 0.06 ? 'cancelado' : (Math.random()<0.5?'entregue':'pendente');
      orders.push({id: 'mck_'+i, date: date.toISOString(), total: Math.round(total*100)/100, items: chosen, status});
    }
    return orders;
  }

  function filterOrdersByRange(orders, start, end){
    return orders.filter(o => {
      if(o.status === 'cancelado') return false;
      const d = new Date(o.date);
      return d >= start && d <= end;
    });
  }

  function startOfWeek(d){ const date = new Date(d); const day = date.getDay(); const diff = (day + 6) % 7; date.setDate(date.getDate()-diff); date.setHours(0,0,0,0); return date; }

  function renderSummary(orders){
    const now = new Date();
    const last24h = new Date(now.getTime() - 24*60*60*1000);
    const weekStart = startOfWeek(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(),0,1);

    const tot24 = filterOrdersByRange(orders, last24h, now);
    const totWeek = filterOrdersByRange(orders, weekStart, now);
    const totMonth = filterOrdersByRange(orders, monthStart, now);
    const totYear = filterOrdersByRange(orders, yearStart, now);

    const sum = arr => arr.reduce((s,x)=>s+(Number(x.total)||0),0);

    $last24hTotal.textContent = formatCurrency(sum(tot24));
    $last24hCount.textContent = tot24.length;
    $weekTotal.textContent = formatCurrency(sum(totWeek));
    $weekCount.textContent = totWeek.length;
    $monthTotal.textContent = formatCurrency(sum(totMonth));
    $monthCount.textContent = totMonth.length;
    $yearTotal.textContent = formatCurrency(sum(totYear));
    $yearCount.textContent = totYear.length;
  }

  function getRangeFromSelection(){
    const now = new Date();
    const sel = $periodSelect.value;
    if(sel === '24h') return [new Date(now.getTime()-24*60*60*1000), now];
    if(sel === 'week') return [startOfWeek(now), now];
    if(sel === 'month') return [new Date(now.getFullYear(), now.getMonth(),1), now];
    if(sel === 'year') return [new Date(now.getFullYear(),0,1), now];
    if(sel === 'custom'){
      const s = $startDate.value ? new Date($startDate.value) : new Date(0);
      const e = $endDate.value ? new Date($endDate.value+'T23:59:59') : new Date();
      return [s,e];
    }
    return [new Date(0), now];
  }

  function renderRevenueChart(orders){
    const days = 30;
    const labels = [];
    const sums = [];
    const today = new Date();
    for(let i=days-1;i>=0;i--){
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      labels.push(d.toLocaleDateString('pt-BR'));
      sums.push(0);
    }
    orders.forEach(o => {
      const d = new Date(o.date);
      const diff = Math.floor((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / (24*60*60*1000));
      const idx = days-1-diff;
      if(idx>=0 && idx<days) sums[idx] += Number(o.total)||0;
    });

    if (revenueChart) {
      revenueChart.destroy();
      revenueChart = null;
    }

    revenueChart = new Chart(revenueCtx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Receita (R$)',
            data: sums.map(function (v) { return Math.round(v * 100) / 100; }),
            borderColor: '#a8442e',
            backgroundColor: 'rgba(168,68,46,0.08)',
            tension: 0.2,
            fill: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            ticks: {
              callback: function (v) { return formatCurrency(v); }
            }
          }
        }
      }
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Render the same structure used by the main pedidos view (app.js)
  function renderTopItems(orders){
    const panel = document.getElementById('itemsChartPanel');
    if(!panel) return;

    const totals = {};
    (orders || []).forEach((order) => {
      if (order.status === 'cancelado') return;
      (order.items || []).forEach((item) => {
        const qty = Number(item.quantity || item.qty || 0) || 0;
        totals[item.name] = (totals[item.name] || 0) + qty;
      });
    });

    const entries = Object.entries(totals).sort((a,b)=>b[1]-a[1]).slice(0,8);
    if(!entries.length){ panel.innerHTML = ''; return; }
    const max = entries[0][1];

    panel.innerHTML = `
      <h3 class="chart-title">🥖 Itens mais vendidos</h3>
      <div class="chart-bars">
        ${entries.map(([name, qty]) => `
          <div class="chart-bar-row">
            <span class="chart-bar-label">${escapeHtml(name)}</span>
            <div class="chart-bar-track">
              <div class="chart-bar-fill" style="width: ${Math.max((qty / max) * 100, 4)}%"></div>
            </div>
            <span class="chart-bar-value">${qty}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function exportCSV(orders){
    const header = ['id','date','status','total','items'];
    const rows = orders.map(o => [o.id, o.date, o.status, o.total, o.items.map(i=>`${i.qty}x ${i.name}`).join('; ')]);
    const csv = [header.join(','), ...rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','))].join('\n');
    const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `padaria_export_${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function updateAll(){
    const orders = loadOrders();
    renderSummary(orders);
    const [start,end] = getRangeFromSelection();
    const filtered = filterOrdersByRange(orders, start, end);
    renderRevenueChart(filtered);
    renderTopItems(filtered);
  }

  // events
  $periodSelect.addEventListener('change',()=>{
    if($periodSelect.value==='custom'){ $startDate.classList.remove('hidden'); $endDate.classList.remove('hidden'); }
    else { $startDate.classList.add('hidden'); $endDate.classList.add('hidden'); }
    updateAll();
  });
  $startDate.addEventListener('change', updateAll);
  $endDate.addEventListener('change', updateAll);
  $refresh.addEventListener('click', updateAll);
  $exportCsv.addEventListener('click', ()=>{
    const [start,end] = getRangeFromSelection();
    const orders = loadOrders();
    const filtered = filterOrdersByRange(orders, start, end);
    exportCSV(filtered);
  });

  $darkToggle.addEventListener('change', ()=>{
    const on = $darkToggle.checked;
    document.documentElement.setAttribute('data-theme', on ? 'dark' : '');
    localStorage.setItem('padaria_theme', on ? 'dark' : '');
  });

  // login handling
  $loginForm.addEventListener('submit', e => {
    e.preventDefault();
    const saved = localStorage.getItem('padaria_dashboard_password') || 'padaria';
    const value = $senhaInput.value || '';
    if(value === saved){
      localStorage.setItem('padaria_unlocked', '1');
      $login.classList.add('hidden'); $app.classList.remove('hidden'); $loginError.textContent = '';
      initAfterAuth();
    } else {
      $loginError.textContent = 'Senha incorreta.';
    }
  });

  function initAfterAuth(){
    const theme = localStorage.getItem('padaria_theme');
    if(theme === 'dark'){ document.documentElement.setAttribute('data-theme','dark'); $darkToggle.checked = true; }
    updateAll();
  }

  // auto-unlock if previously logged in
  if(localStorage.getItem('padaria_unlocked')){
    $login.classList.add('hidden'); $app.classList.remove('hidden'); initAfterAuth();
  }

  // expose a quick helper on window for debugging in browser console
  window.__padaria = { regenerate: ()=>{ const g = generateMockOrders(); saveOrders(g); updateAll(); return g; }, updateAll };

})();
const DEFAULT_API_HOST = 'https://padaria-bot-cbf7.onrender.com';
const API_DASHBOARD_URL = window.PADARIA_API_DASHBOARD_URL || DEFAULT_API_HOST + '/api/dashboard';

function getAuthHeader() {
  const pass = sessionStorage.getItem('painelSenha');
  return 'Basic ' + btoa('padaria:' + (pass || ''));
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('appContent').classList.add('hidden');
}

function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appContent').classList.remove('hidden');
}

async function loadDashboard(isLoginAttempt = false) {
  const errorEl = document.getElementById('loginError');
  if (isLoginAttempt) errorEl.textContent = 'Verificando...';

  let response;
  try {
    response = await fetch(API_DASHBOARD_URL, {
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

  document.getElementById('last24hTotal').textContent = formatCurrency(data.last24h?.total);
  document.getElementById('last24hCount').textContent = data.last24h?.count ?? 0;
  document.getElementById('weekTotal').textContent = formatCurrency(data.week?.total);
  document.getElementById('weekCount').textContent = data.week?.count ?? 0;
  document.getElementById('monthTotal').textContent = formatCurrency(data.month?.total);
  document.getElementById('monthCount').textContent = data.month?.count ?? 0;
  document.getElementById('yearTotal').textContent = formatCurrency(data.year?.total);
  document.getElementById('yearCount').textContent = data.year?.count ?? 0;
}

function tryLogin(password) {
  sessionStorage.setItem('painelSenha', password);
  return loadDashboard(true);
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

  document.getElementById('refresh').addEventListener('click', () => loadDashboard());

  const storedPassword = sessionStorage.getItem('painelSenha');
  if (storedPassword) {
    loadDashboard();
  } else {
    showLogin();
  }
});