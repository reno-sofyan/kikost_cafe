/**
 * HTML shell konsol operator (lihat ops.ts). Statis & tanpa data; seluruh data
 * diambil lewat fetch ber-Bearer-token ke /ops/api/*. Di-embed sebagai string
 * agar tidak perlu menyajikan file statis dari disk pada container backend.
 *
 * Sumber yang bisa dibaca manusia: backend/src/routes/opsDashboard.html
 */
export const OPS_DASHBOARD_HTML = `<!doctype html>
<html lang="id" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0b0f14" />
<meta name="robots" content="noindex, nofollow" />
<title>Kione Ops</title>
<style>
  :root {
    --bg: #0b0f14; --surface: #131a22; --surface-2: #1b242e; --border: #26323f;
    --ink-50: #f3f6f9; --ink-200: #c3ccd6; --ink-400: #8795a3; --ink-500: #64727f;
    --brand: #3b82f6; --brand-600: #2563eb; --ok: #22c55e; --warn: #f59e0b; --bad: #ef4444;
    --radius: 14px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--ink-50);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  body { min-height: 100vh; }
  a { color: var(--brand); }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 24px 16px 64px; }
  header.top { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    margin-bottom: 20px; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand .dot { width: 10px; height: 10px; border-radius: 99px; background: var(--brand); box-shadow: 0 0 0 4px rgba(59,130,246,.15); }
  .brand h1 { font-size: 1.05rem; margin: 0; letter-spacing: .3px; }
  .muted { color: var(--ink-400); font-size: .8rem; }
  button { font: inherit; cursor: pointer; border-radius: 10px; border: 1px solid var(--border);
    background: var(--surface-2); color: var(--ink-200); padding: 8px 14px; transition: .12s; }
  button:hover { border-color: var(--ink-500); color: var(--ink-50); }
  button.primary { background: var(--brand-600); border-color: var(--brand-600); color: #fff; }
  button.primary:hover { background: var(--brand); }
  input { font: inherit; border-radius: 10px; border: 1px solid var(--border);
    background: var(--surface); color: var(--ink-50); padding: 11px 13px; width: 100%; }
  input:focus { outline: none; border-color: var(--brand); }

  /* Gate */
  .gate { max-width: 380px; margin: 14vh auto 0; background: var(--surface);
    border: 1px solid var(--border); border-radius: var(--radius); padding: 28px; }
  .gate h2 { margin: 0 0 4px; font-size: 1.1rem; }
  .gate p { margin: 0 0 18px; color: var(--ink-400); font-size: .85rem; }
  .gate .row { display: flex; gap: 8px; margin-top: 12px; }
  .err { color: var(--bad); font-size: .82rem; min-height: 1.1em; margin-top: 8px; }

  /* KPI strip */
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .kpi { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; }
  .kpi .label { color: var(--ink-400); font-size: .72rem; text-transform: uppercase; letter-spacing: .5px; }
  .kpi .val { font-size: 1.5rem; font-weight: 700; margin-top: 4px; }

  /* Tenant cards */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 16px; text-align: left; display: flex; flex-direction: column; gap: 12px; width: 100%; }
  .card:hover { border-color: var(--brand); }
  .card .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .card .name { font-weight: 700; font-size: 1rem; }
  .card .tenant-id { color: var(--ink-500); font-size: .72rem; font-family: ui-monospace, monospace; }
  .badge { font-size: .68rem; padding: 3px 8px; border-radius: 99px; border: 1px solid var(--border);
    color: var(--ink-200); white-space: nowrap; }
  .badge.cafe { color: #c4b5fd; border-color: #6d28d9; background: rgba(109,40,217,.15); }
  .badge.kantin { color: #fcd34d; border-color: #b45309; background: rgba(180,83,9,.15); }
  .badge.minimarket { color: #86efac; border-color: #15803d; background: rgba(21,128,61,.15); }
  .badge.lainnya { color: var(--ink-200); }
  .statline { display: flex; gap: 16px; flex-wrap: wrap; }
  .stat .k { color: var(--ink-400); font-size: .7rem; }
  .stat .v { font-size: 1.05rem; font-weight: 600; }
  .dev { display: flex; align-items: center; gap: 6px; font-size: .78rem; color: var(--ink-200); }
  .pill { width: 8px; height: 8px; border-radius: 99px; }
  .pill.ok { background: var(--ok); } .pill.off { background: var(--ink-500); } .pill.bad { background: var(--bad); }
  .spark { display: flex; align-items: flex-end; gap: 3px; height: 36px; }
  .spark .bar { flex: 1; background: var(--brand-600); border-radius: 3px 3px 0 0; min-height: 2px; opacity: .85; }
  .warnflag { color: var(--warn); font-size: .76rem; }

  /* Drawer */
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: none; }
  .overlay.open { display: block; }
  .drawer { position: fixed; top: 0; right: 0; height: 100%; width: min(640px, 94vw);
    background: var(--bg); border-left: 1px solid var(--border); transform: translateX(100%);
    transition: transform .2s ease; overflow-y: auto; z-index: 10; }
  .drawer.open { transform: translateX(0); }
  .drawer .dh { position: sticky; top: 0; background: var(--bg); border-bottom: 1px solid var(--border);
    padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; }
  .drawer .body { padding: 18px 20px 48px; }
  .tabs { display: flex; gap: 8px; margin: 4px 0 14px; }
  .tabs button.active { background: var(--brand-600); border-color: var(--brand-600); color: #fff; }
  table { width: 100%; border-collapse: collapse; font-size: .82rem; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--ink-400); font-weight: 600; font-size: .72rem; text-transform: uppercase; letter-spacing: .4px; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .tag { font-size: .68rem; padding: 2px 7px; border-radius: 6px; border: 1px solid var(--border); color: var(--ink-200); }
  .tag.paid { color: #86efac; border-color: #15803d; }
  .tag.void { color: #fca5a5; border-color: #b91c1c; }
  .tag.open { color: #fcd34d; border-color: #b45309; }
  .loading { color: var(--ink-400); padding: 24px; text-align: center; }
  .empty { color: var(--ink-500); padding: 20px; text-align: center; font-size: .85rem; }
  .hide { display: none !important; }

  /* Pembatalan */
  .cancel-flag { color: var(--bad); }
  .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  .seg { display: flex; gap: 6px; }
  .seg button { padding: 6px 12px; font-size: .8rem; }
  .seg button.active { background: var(--brand-600); border-color: var(--brand-600); color: #fff; }
  .groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .group { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; }
  .group h4 { margin: 0 0 8px; font-size: .72rem; color: var(--ink-400); text-transform: uppercase; letter-spacing: .4px; }
  .group .gr { display: flex; justify-content: space-between; gap: 8px; font-size: .8rem; padding: 3px 0; }
  .group .gr span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .group .gr span:last-child { white-space: nowrap; color: var(--ink-200); }
  .crow { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; margin-bottom: 8px; }
  .crow .top { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .crow .no { font-weight: 600; }
  .crow .amt { font-weight: 700; font-variant-numeric: tabular-nums; }
  .crow .reason { margin: 6px 0; font-size: .85rem; color: var(--ink-50); }
  .crow .who { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: .76rem; color: var(--ink-400); }
  .crow .who b { color: var(--ink-200); font-weight: 600; }
  .tag.stage-paid { color: #fca5a5; border-color: #b91c1c; background: rgba(185,28,28,.15); }
  .tag.stage-kitchen { color: #fcd34d; border-color: #b45309; }
  .tag.stage-unprocessed { color: var(--ink-200); }
  /* Export PDF */
  .exportbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 14px; padding: 10px 12px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
  .exportbar .t { font-size: .8rem; color: var(--ink-200); font-weight: 600; margin-right: auto; }
  .exportbar select, .exportbar input[type=date] { font: inherit; font-size: .85rem; width: auto; padding: 7px 10px; border-radius: 9px;
    border: 1px solid var(--border); background: var(--surface-2); color: var(--ink-50); color-scheme: dark; }
  .exportbar button.primary { padding: 7px 14px; }
  .exportbar .msg { flex-basis: 100%; font-size: .78rem; color: var(--ink-400); min-height: 0; }
  .exportbar .msg.err { color: var(--bad); }

  /* ---- HP (≤640px) ---- */
  @media (max-width: 640px) {
    .wrap { padding: calc(14px + env(safe-area-inset-top)) 14px calc(40px + env(safe-area-inset-bottom)); }
    header.top { margin-bottom: 14px; }
    header.top > div:last-child { width: 100%; flex-wrap: wrap; gap: 8px !important; }
    header.top > div:last-child #updated { flex-basis: 100%; }
    header.top > div:last-child button { flex: 1; white-space: nowrap; }
    .kpis { grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 14px; }
    .kpi { padding: 10px 12px; }
    .kpi .val { font-size: 1.2rem; }
    .grid { grid-template-columns: 1fr; gap: 10px; }
    .drawer { width: 100vw; border-left: 0; }
    .drawer .dh { padding: calc(12px + env(safe-area-inset-top)) 14px 12px; }
    .drawer .body { padding: 14px 14px calc(40px + env(safe-area-inset-bottom)); }
    #dKpis { grid-template-columns: repeat(3, 1fr) !important; }
    #dKpis .kpi .val { font-size: 1rem; }
    #dKpis .kpi .label { font-size: .64rem; }
    .tabs { overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
    .tabs { gap: 6px; }
    .tabs button { flex: 1 1 auto; white-space: nowrap; padding: 8px 10px; font-size: .85rem; }
    .toolbar .muted { flex-basis: 100%; }
    .groups { grid-template-columns: 1fr; }
    .exportbar .t { flex-basis: 100%; }
    .exportbar select { flex: 1 1 100%; }
    .exportbar input[type=date] { flex: 1 1 40%; min-width: 0; }
    .exportbar button.primary { flex: 1 1 100%; padding: 10px; }
    /* Tabel → kartu bertumpuk */
    table.stack thead { display: none; }
    table.stack, table.stack tbody { display: block; }
    table.stack tr { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 10px 2px; border-bottom: 1px solid var(--border); }
    table.stack td { display: block; padding: 0; border: 0; }
    table.stack td.full { flex-basis: 100%; color: var(--ink-200); }
    table.stack td.num { margin-left: auto; font-weight: 600; }
  }
  .tag.appr-owner { color: #93c5fd; border-color: #1d4ed8; }
  .tag.emptied { color: #fecaca; border-color: #dc2626; background: rgba(220,38,38,.25); font-weight: 600; }
  .corr { margin: 6px 0 2px; padding: 8px 10px; border-left: 2px solid var(--bad); background: rgba(239,68,68,.06); border-radius: 0 8px 8px 0; font-size: .78rem; }
  .corr .ci { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; }
  .corr .ci span:last-child { white-space: nowrap; color: var(--ink-200); }
  .corr .cm { color: var(--ink-400); font-size: .72rem; margin-bottom: 3px; }
</style>
</head>
<body>
  <!-- Gate -->
  <div id="gate" class="gate">
    <h2>Konsol Operator</h2>
    <p>Masukkan token operator untuk melanjutkan.</p>
    <input id="token" type="password" placeholder="OPS_TOKEN" autocomplete="off" />
    <div class="row">
      <button class="primary" style="flex:1" onclick="login()">Masuk</button>
    </div>
    <div id="gateErr" class="err"></div>
  </div>

  <!-- App -->
  <div id="app" class="wrap hide">
    <header class="top">
      <div class="brand"><span class="dot"></span><h1>Kione · Operator Console</h1></div>
      <div style="display:flex; gap:8px; align-items:center;">
        <span id="updated" class="muted"></span>
        <button onclick="load()">Muat ulang</button>
        <button onclick="logout()">Keluar</button>
      </div>
    </header>
    <div id="kpis" class="kpis"></div>
    <div id="grid" class="grid"></div>
    <div id="mainLoading" class="loading">Memuat…</div>
  </div>

  <!-- Drawer -->
  <div id="overlay" class="overlay" onclick="closeDrawer()"></div>
  <aside id="drawer" class="drawer" aria-hidden="true">
    <div class="dh">
      <div>
        <div id="dName" style="font-weight:700"></div>
        <div id="dMeta" class="muted"></div>
      </div>
      <button onclick="closeDrawer()">Tutup</button>
    </div>
    <div class="body">
      <div class="kpis" id="dKpis" style="grid-template-columns:repeat(3,1fr)"></div>
      <div class="tabs">
        <button id="tabActivity" class="active" onclick="showTab('activity')">Log Aktivitas</button>
        <button id="tabOrders" onclick="showTab('orders')">Transaksi</button>
        <button id="tabCancels" onclick="showTab('cancels')">Pembatalan</button>
      </div>
      <div id="exportBar" class="exportbar hide">
        <span class="t" id="expTitle">Export PDF</span>
        <select id="expPreset" onchange="onPresetChange()" aria-label="Periode">
          <option value="today">Hari ini</option>
          <option value="yesterday">Kemarin</option>
          <option value="7d">7 hari terakhir</option>
          <option value="30d">30 hari terakhir</option>
          <option value="month">Bulan ini</option>
          <option value="lastmonth">Bulan lalu</option>
          <option value="custom">Pilih tanggal…</option>
        </select>
        <input type="date" id="expFrom" class="hide" aria-label="Dari tanggal" />
        <input type="date" id="expTo" class="hide" aria-label="Sampai tanggal" />
        <button class="primary" id="expBtn" onclick="exportPdf()">Unduh PDF</button>
        <div class="msg" id="expMsg"></div>
      </div>
      <div id="paneActivity"></div>
      <div id="paneOrders" class="hide"></div>
      <div id="paneCancels" class="hide"></div>
    </div>
  </aside>

<script>
  const TK = 'kione_ops_token';
  let currentDetail = null;
  let currentTenantId = null;
  let cancelDays = 30;

  function token() { try { return sessionStorage.getItem(TK) || ''; } catch { return ''; } }
  function setToken(v) { try { v ? sessionStorage.setItem(TK, v) : sessionStorage.removeItem(TK); } catch {} }

  const rupiah = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
  const compact = (n) => {
    n = Number(n) || 0;
    if (n >= 1e9) return 'Rp ' + (n / 1e9).toFixed(1) + 'M';
    if (n >= 1e6) return 'Rp ' + (n / 1e6).toFixed(1) + 'jt';
    if (n >= 1e3) return 'Rp ' + Math.round(n / 1e3) + 'rb';
    return rupiah(n);
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const BT = { cafe_resto: ['Kafe & Resto', 'cafe'], kantin: ['Kantin', 'kantin'], minimarket: ['Minimarket', 'minimarket'], lainnya: ['Lainnya', 'lainnya'] };
  function fmtTime(ms) {
    if (!ms) return '—';
    const d = new Date(Number(ms));
    return d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function ago(ms) {
    if (!ms) return 'belum pernah';
    const s = (Date.now() - Number(ms)) / 1000;
    if (s < 90) return 'baru saja';
    if (s < 3600) return Math.round(s / 60) + ' mnt lalu';
    if (s < 86400) return Math.round(s / 3600) + ' jam lalu';
    return Math.round(s / 86400) + ' hr lalu';
  }

  async function api(path) {
    let res;
    try {
      res = await fetch('/ops/api' + path, { headers: { Authorization: 'Bearer ' + token() }, cache: 'no-store' });
    } catch {
      throw new Error('Tidak bisa menghubungi server. Periksa koneksi internet.');
    }
    if (res.status === 401) { setToken(''); showGate('Token ditolak — tidak sama dengan OPS_TOKEN di server.'); throw new Error('401'); }
    if (res.status === 429) throw new Error('Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.');
    if (!res.ok) throw new Error('Server error (HTTP ' + res.status + '). Coba lagi atau periksa log backend.');
    return res.json();
  }

  function showGate(msg) {
    document.getElementById('app').classList.add('hide');
    document.getElementById('gate').classList.remove('hide');
    document.getElementById('gateErr').textContent = msg || '';
    const el = document.getElementById('token'); el.value = ''; el.focus();
  }
  function showApp() {
    document.getElementById('gate').classList.add('hide');
    document.getElementById('app').classList.remove('hide');
  }

  async function login() {
    // Buang spasi & tanda kutip pembungkus yang sering ikut ter-salin.
    const v = document.getElementById('token').value.trim().replace(/^(['"])(.*)\\1$/, '$2').trim();
    if (!v) return;
    setToken(v);
    const btn = document.querySelector('#gate button.primary');
    btn.disabled = true; btn.textContent = 'Memeriksa…';
    document.getElementById('gateErr').textContent = '';
    try {
      await load(); showApp();
    } catch (e) {
      // 401 sudah ditangani \`api()\` (kembali ke gerbang + pesan). Error lain jangan diam saja.
      if (String(e.message) !== '401') { setToken(''); document.getElementById('gateErr').textContent = e.message; }
    } finally {
      btn.disabled = false; btn.textContent = 'Masuk';
    }
  }
  function logout() { setToken(''); showGate(''); }

  async function load() {
    document.getElementById('mainLoading').textContent = 'Memuat…';
    document.getElementById('mainLoading').classList.remove('hide');
    const data = await api('/summary');
    render(data);
  }

  function render(data) {
    document.getElementById('mainLoading').classList.add('hide');
    document.getElementById('updated').textContent = 'Diperbarui ' + fmtTime(data.generatedAt);

    let totalToday = 0, totalTxns = 0, devOnline = 0, devTotal = 0, issues = 0, cancelsToday = 0;
    for (const t of data.tenants) {
      totalToday += t.today.revenue; totalTxns += t.today.txns;
      cancelsToday += (t.cancellations && t.cancellations.todayCount) || 0;
      devOnline += t.devices.online; devTotal += t.devices.total;
      if (t.health.pushRejected24h > 0) issues++;
    }
    document.getElementById('kpis').innerHTML = [
      kpi('Tenant', data.tenantCount),
      kpi('Omzet hari ini', compact(totalToday)),
      kpi('Transaksi hari ini', totalTxns.toLocaleString('id-ID')),
      kpi('Pembatalan hari ini', cancelsToday, cancelsToday ? 'var(--bad)' : null),
      kpi('Perangkat online', devOnline + ' / ' + devTotal),
      kpi('Tenant bermasalah', issues, issues ? 'var(--warn)' : null),
    ].join('');

    const grid = document.getElementById('grid');
    if (!data.tenants.length) { grid.innerHTML = '<div class="empty">Belum ada tenant yang mengirim data.</div>'; return; }
    grid.innerHTML = data.tenants.map(cardHtml).join('');
  }

  const kpi = (label, val, color) =>
    '<div class="kpi"><div class="label">' + esc(label) + '</div><div class="val"' +
    (color ? ' style="color:' + color + '"' : '') + '>' + esc(val) + '</div></div>';

  function sparkHtml(days) {
    const vals = (days || []).map((d) => d.revenue);
    const max = Math.max(1, ...vals);
    // Selalu tampilkan 7 slot
    const slots = [];
    for (let i = 6; i >= 0; i--) {
      const key = new Date(Date.now() - i * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      const hit = (days || []).find((d) => d.date === key);
      slots.push(hit ? hit.revenue : 0);
    }
    return '<div class="spark" title="Omzet 7 hari terakhir">' +
      slots.map((v) => '<div class="bar" style="height:' + Math.max(2, Math.round((v / max) * 100)) + '%"></div>').join('') +
      '</div>';
  }

  function cardHtml(t) {
    const bt = BT[t.businessType] || BT.lainnya;
    const name = t.businessName || t.tenantId;
    let pill = 'off', devTxt = t.devices.total + ' perangkat';
    if (t.devices.online > 0) { pill = 'ok'; devTxt = t.devices.online + '/' + t.devices.total + ' online'; }
    const warn = t.health.pushRejected24h > 0
      ? '<div class="warnflag">⚠ ' + t.health.pushRejected24h + ' push ditolak (24j)</div>' : '';
    return '<button class="card" onclick="openTenant(\\'' + esc(t.tenantId) + '\\',\\'' + esc(name) + '\\',\\'' + esc(bt[0]) + '\\')">' +
      '<div class="head"><div><div class="name">' + esc(name) + '</div>' +
      '<div class="tenant-id">' + esc(t.tenantId) + '</div></div>' +
      '<span class="badge ' + bt[1] + '">' + bt[0] + '</span></div>' +
      '<div class="statline">' +
        '<div class="stat"><div class="k">Omzet hari ini</div><div class="v">' + compact(t.today.revenue) + '</div></div>' +
        '<div class="stat"><div class="k">Transaksi</div><div class="v">' + t.today.txns + '</div></div>' +
        cancelStatHtml(t.cancellations) +
      '</div>' +
      sparkHtml(t.last7Days) +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<span class="dev"><span class="pill ' + pill + '"></span>' + devTxt + '</span>' +
        '<span class="muted">' + ago(t.health.lastActivityAt) + '</span>' +
      '</div>' + warn +
    '</button>';
  }

  function cancelStatHtml(c) {
    c = c || { todayCount: 0, todayValue: 0, last7DaysCount: 0 };
    const cls = c.todayCount ? ' cancel-flag' : '';
    return '<div class="stat" title="' + c.last7DaysCount + ' pembatalan dalam 7 hari"><div class="k">Batal hari ini</div>' +
      '<div class="v' + cls + '">' + c.todayCount + (c.todayCount ? ' · ' + compact(c.todayValue) : '') + '</div></div>';
  }

  async function openTenant(id, name, btLabel) {
    currentTenantId = id;
    document.getElementById('dName').textContent = name;
    document.getElementById('dMeta').textContent = btLabel + ' · ' + id;
    document.getElementById('dKpis').innerHTML = '';
    document.getElementById('paneActivity').innerHTML = '<div class="loading">Memuat…</div>';
    document.getElementById('paneOrders').innerHTML = '';
    document.getElementById('paneCancels').innerHTML = '';
    document.getElementById('overlay').classList.add('open');
    document.getElementById('drawer').classList.add('open');
    showTab('activity');
    try {
      const d = await api('/tenant/' + encodeURIComponent(id));
      currentDetail = d;
      document.getElementById('dKpis').innerHTML = [
        kpi('Omzet total', compact(d.totals.revenue)),
        kpi('30 hari', compact(d.totals.revenue30Days)),
        kpi('Transaksi', d.totals.txns.toLocaleString('id-ID')),
      ].join('');
      renderActivity(d.auditLogs);
      renderOrders(d.orders);
      loadCancels();
    } catch (e) {
      if (String(e.message) !== '401')
        document.getElementById('paneActivity').innerHTML = '<div class="empty">Gagal memuat detail.</div>';
    }
  }
  function closeDrawer() {
    document.getElementById('overlay').classList.remove('open');
    document.getElementById('drawer').classList.remove('open');
  }
  let currentTab = 'activity';
  function showTab(which) {
    currentTab = which;
    for (const [tab, pane, key] of [['tabActivity', 'paneActivity', 'activity'], ['tabOrders', 'paneOrders', 'orders'], ['tabCancels', 'paneCancels', 'cancels']]) {
      document.getElementById(tab).classList.toggle('active', which === key);
      document.getElementById(pane).classList.toggle('hide', which !== key);
    }
    document.getElementById('exportBar').classList.toggle('hide', which === 'activity');
    document.getElementById('expTitle').textContent = which === 'cancels' ? 'Export PDF Pembatalan' : 'Export PDF Transaksi';
    setExpMsg('');
  }

  // ---- Export PDF (tanggal kalender WIB) ----
  const wibDay = (offsetDays) => new Date(Date.now() + 7 * 3600000 + (offsetDays || 0) * 86400000).toISOString().slice(0, 10);
  function presetRange(p) {
    const today = wibDay(0);
    const [y, m] = today.split('-').map(Number);
    const ymd = (yy, mm, dd) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
    switch (p) {
      case 'yesterday': return [wibDay(-1), wibDay(-1)];
      case '7d': return [wibDay(-6), today];
      case '30d': return [wibDay(-29), today];
      case 'month': return [ymd(y, m, 1), today];
      case 'lastmonth': return [ymd(y, m - 1, 1), ymd(y, m, 0)];
      case 'custom': return [document.getElementById('expFrom').value || today, document.getElementById('expTo').value || today];
      default: return [today, today];
    }
  }
  function onPresetChange() {
    const custom = document.getElementById('expPreset').value === 'custom';
    const f = document.getElementById('expFrom'), t = document.getElementById('expTo');
    f.classList.toggle('hide', !custom); t.classList.toggle('hide', !custom);
    if (custom && !f.value) { f.value = wibDay(-6); t.value = wibDay(0); }
    setExpMsg('');
  }
  function setExpMsg(text, isErr) {
    const el = document.getElementById('expMsg');
    el.textContent = text || ''; el.classList.toggle('err', !!isErr);
  }
  async function exportPdf() {
    const kind = currentTab === 'cancels' ? 'cancellations' : 'transactions';
    const [from, to] = presetRange(document.getElementById('expPreset').value);
    const btn = document.getElementById('expBtn');
    btn.disabled = true; btn.textContent = 'Membuat PDF…'; setExpMsg('');
    try {
      const res = await fetch('/ops/api/tenant/' + encodeURIComponent(currentTenantId) + '/export/' + kind + '.pdf?from=' + from + '&to=' + to, {
        headers: { Authorization: 'Bearer ' + token() }, cache: 'no-store',
      });
      if (res.status === 401) { setToken(''); showGate('Token ditolak — tidak sama dengan OPS_TOKEN di server.'); return; }
      if (!res.ok) {
        let msg = 'Gagal membuat PDF (HTTP ' + res.status + ').';
        try { const j = await res.json(); if (j && j.error) msg = j.error; } catch {}
        setExpMsg(msg, true); return;
      }
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const name = (/filename="([^"]+)"/.exec(cd) || [])[1] || (kind + '.pdf');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setExpMsg('Terunduh: ' + name);
    } catch {
      setExpMsg('Tidak bisa menghubungi server. Periksa koneksi internet.', true);
    } finally {
      btn.disabled = false; btn.textContent = 'Unduh PDF';
    }
  }

  const STAGE = {
    paid: ['Sudah lunas · uang dikembalikan', 'stage-paid'],
    kitchen: ['Sudah ke dapur', 'stage-kitchen'],
    unprocessed: ['Belum diproses', 'stage-unprocessed'],
  };
  const APPROVAL = { owner_code: 'Kode Pemilik', supervisor: 'PIN Supervisor', self: 'Tanpa persetujuan' };

  async function loadCancels(days) {
    if (days) cancelDays = days;
    const id = currentTenantId;
    const pane = document.getElementById('paneCancels');
    pane.innerHTML = '<div class="loading">Memuat…</div>';
    try {
      const d = await api('/tenant/' + encodeURIComponent(id) + '/cancellations?days=' + cancelDays);
      if (id === currentTenantId) renderCancels(d);
    } catch (e) {
      if (String(e.message) !== '401') pane.innerHTML = '<div class="empty">Gagal memuat pembatalan.</div>';
    }
  }

  function groupHtml(title, groups) {
    const top = (groups || []).slice(0, 5);
    return '<div class="group"><h4>' + esc(title) + '</h4>' +
      (top.length
        ? top.map((g) => '<div class="gr"><span>' + esc(g.name) + '</span><span>' + g.count + '× · ' + compact(g.value) + '</span></div>').join('')
        : '<div class="muted">—</div>') +
      '</div>';
  }

  const KIND = { removed: 'dihapus', voided: 'di-void', reduced: 'dikurangi' };
  function correctionsHtml(r) {
    const list = r.corrections || [];
    if (!list.length) return '';
    return '<div class="corr"><div class="cm">Koreksi item sebelum dibatalkan' +
      (r.emptiedFirst ? ' — nilai di atas = total item yang dihapus' : '') + '</div>' +
      list.map((c) =>
        '<div class="ci"><span>' + esc(c.name) + (c.qty ? ' ×' + c.qty : '') + ' · ' + KIND[c.kind] +
        ' · ' + esc(c.reason || (c.kind === 'reduced' ? 'lihat Log Aktivitas' : 'tanpa alasan (versi lama)')) +
        (c.by ? ' · ' + esc(c.by) : '') + (c.ownerApproved ? ' · kode Pemilik' : '') +
        '</span><span>−' + rupiah(c.value) + '</span></div>').join('') +
      '</div>';
  }

  function renderCancels(d) {
    const seg = '<div class="seg">' + [7, 30, 90].map((n) =>
      '<button class="' + (n === cancelDays ? 'active' : '') + '" onclick="loadCancels(' + n + ')">' + n + ' hari</button>').join('') + '</div>';
    const head = '<div class="toolbar"><span class="muted">Pembatalan ' + d.days + ' hari terakhir (semua, termasuk yang dikosongkan dulu)</span>' + seg + '</div>';
    const t = d.totals;
    const kpis = '<div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">' + [
      kpi('Jumlah batal', t.count, t.count ? 'var(--bad)' : null),
      kpi('Nilai batal', compact(t.value)),
      kpi('Setelah lunas · ' + compact(t.paidValue), t.paidCount, t.paidCount ? 'var(--bad)' : null),
      kpi('Dikosongkan dulu · ' + compact(t.emptiedFirstValue), t.emptiedFirstCount, t.emptiedFirstCount ? 'var(--bad)' : null),
      kpi('Pakai kode Pemilik', t.ownerCodeCount),
    ].join('') + '</div>';
    if (!d.rows.length) {
      document.getElementById('paneCancels').innerHTML = head + kpis + '<div class="empty">Tidak ada pembatalan pada periode ini.</div>';
      return;
    }
    const groups = '<div class="groups">' +
      groupHtml('Diminta oleh', d.byRequester) +
      groupHtml('Disetujui oleh', d.byApprover) +
      groupHtml('Alasan', d.byReason) +
      '</div>';
    const list = d.rows.map((r) => {
      const st = STAGE[r.stage] || STAGE.unprocessed;
      const label = (r.queueNumber ? '#' + r.queueNumber + ' · ' : '') + (r.orderNumber || '—') + (r.buyer ? ' · ' + r.buyer : '');
      return '<div class="crow">' +
        '<div class="top"><span class="no">' + esc(label) + '</span><span class="amt">' + rupiah(r.value) + '</span></div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">' +
          '<span class="tag ' + st[1] + '">' + st[0] + '</span>' +
          (r.approval ? '<span class="tag' + (r.approval === 'owner_code' ? ' appr-owner' : '') + '">' + esc(APPROVAL[r.approval] || r.approval) + '</span>' : '') +
          (r.payLater ? '<span class="tag open">Bill gantung</span>' : '') +
          (r.emptiedFirst ? '<span class="tag emptied">Dikosongkan dulu lalu dibatalkan</span>' : '') +
          (r.neverHadItems ? '<span class="tag">Pesanan kosong (tanpa item)</span>' : '') +
        '</div>' +
        '<div class="reason">' + esc(r.reason || '(tanpa alasan)') + '</div>' +
        correctionsHtml(r) +
        '<div class="who">' +
          '<span>Dibatalkan <b>' + esc(fmtTime(r.voidedAt)) + '</b></span>' +
          '<span>Diminta <b>' + esc(r.requestedBy || '—') + '</b></span>' +
          '<span>Disetujui <b>' + esc(r.approvedBy || '—') + '</b></span>' +
          '<span>Kasir pembuat <b>' + esc(r.cashierName || '—') + '</b></span>' +
          '<span>Dibuat ' + esc(fmtTime(r.createdAt)) + '</span>' +
        '</div></div>';
    }).join('');
    document.getElementById('paneCancels').innerHTML = head + kpis + groups + list;
  }

  function renderActivity(logs) {
    if (!logs || !logs.length) { document.getElementById('paneActivity').innerHTML = '<div class="empty">Belum ada log aktivitas.</div>'; return; }
    document.getElementById('paneActivity').innerHTML =
      '<table class="stack"><thead><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Detail</th></tr></thead><tbody>' +
      logs.map((l) =>
        '<tr><td class="muted">' + esc(fmtTime(l.createdAt)) + '</td>' +
        '<td>' + esc(l.userName || '—') + '</td>' +
        '<td><span class="tag">' + esc(l.action || '') + '</span></td>' +
        '<td class="full">' + esc(l.details || '') + '</td></tr>').join('') +
      '</tbody></table>';
  }
  function renderOrders(orders) {
    if (!orders || !orders.length) { document.getElementById('paneOrders').innerHTML = '<div class="empty">Belum ada transaksi.</div>'; return; }
    document.getElementById('paneOrders').innerHTML =
      '<table class="stack"><thead><tr><th>Waktu</th><th>No.</th><th>Status</th><th>Kasir</th><th class="num">Total</th></tr></thead><tbody>' +
      orders.map((o) => {
        const st = String(o.status || '');
        const cls = st === 'paid' || st === 'completed' ? 'paid' : st === 'void' ? 'void' : 'open';
        return '<tr><td class="muted">' + esc(fmtTime(o.paidAt || o.createdAt)) + '</td>' +
          '<td>' + esc(o.orderNumber || '—') + '</td>' +
          '<td><span class="tag ' + cls + '">' + esc(st || '—') + '</span></td>' +
          '<td>' + esc(o.cashierName || (o.source === 'qr_table' ? 'QR' : '—')) + '</td>' +
          '<td class="num" style="white-space:nowrap">' + rupiah(o.grandTotal) + '</td></tr>';
      }).join('') +
      '</tbody></table>';
  }

  document.getElementById('token').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  // Auto-masuk bila token sudah tersimpan di sesi ini.
  if (token()) { load().then(showApp).catch((e) => showGate(String(e.message) === '401' ? 'Token ditolak — tidak sama dengan OPS_TOKEN di server.' : e.message)); } else { showGate(''); }
</script>
</body>
</html>
`
