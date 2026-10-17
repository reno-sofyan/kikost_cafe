/**
 * HTML shell konsol Pemilik (lihat owner.ts). Statis & tanpa data; seluruh data
 * diambil lewat fetch ber-Bearer-token ke /owner/api/*.
 *
 * JANGAN diedit langsung — sumbernya backend/src/routes/ownerDashboard.html,
 * bangkitkan ulang dengan: node scripts/embed-dashboards.mjs
 */
export const OWNER_DASHBOARD_HTML = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#4338ca" />
<meta name="robots" content="noindex, nofollow" />
<meta name="referrer" content="no-referrer" />
<title>__OWNER_TITLE__ · Kione</title>
<style>
  :root {
    --bg: #f4f6fb; --surface: #ffffff; --surface-2: #eef1f7; --border: #e1e6ef;
    --ink: #111827; --ink-2: #374151; --ink-3: #6b7280; --ink-4: #9ca3af;
    --brand: #4338ca; --brand-2: #4f46e5; --brand-soft: #eef2ff;
    --ok: #15803d; --ok-soft: #dcfce7; --warn: #b45309; --warn-soft: #fef3c7; --bad: #b91c1c; --bad-soft: #fee2e2;
    --radius: 16px; --shadow: 0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06);
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117; --surface: #161b24; --surface-2: #1f2633; --border: #2a3342;
      --ink: #f3f4f6; --ink-2: #d1d5db; --ink-3: #9ca3af; --ink-4: #6b7280;
      --brand: #818cf8; --brand-2: #6366f1; --brand-soft: rgba(99,102,241,.16);
      --ok: #4ade80; --ok-soft: rgba(34,197,94,.14); --warn: #fbbf24; --warn-soft: rgba(245,158,11,.14);
      --bad: #f87171; --bad-soft: rgba(239,68,68,.14); --shadow: none;
      color-scheme: dark;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--ink);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  body { min-height: 100vh; -webkit-text-size-adjust: 100%; }
  .wrap { max-width: 960px; margin: 0 auto; padding: calc(16px + env(safe-area-inset-top)) 16px calc(48px + env(safe-area-inset-bottom)); }
  .muted { color: var(--ink-3); font-size: .8rem; }
  .hide { display: none !important; }
  button { font: inherit; cursor: pointer; border-radius: 12px; border: 1px solid var(--border);
    background: var(--surface); color: var(--ink-2); padding: 9px 14px; transition: background .12s, border-color .12s; }
  button:hover { border-color: var(--ink-4); color: var(--ink); }
  button:disabled { opacity: .6; cursor: default; }
  button.primary { background: var(--brand-2); border-color: var(--brand-2); color: #fff; font-weight: 600; }
  button.primary:hover { background: var(--brand); border-color: var(--brand); }
  input, select { font: inherit; border-radius: 12px; border: 1px solid var(--border);
    background: var(--surface); color: var(--ink); padding: 11px 13px; }
  input:focus, select:focus { outline: 2px solid var(--brand-soft); border-color: var(--brand); }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); }

  /* Gerbang */
  .gate { max-width: 400px; margin: 12vh auto 0; padding: 28px 24px; }
  .gate .logo { width: 44px; height: 44px; border-radius: 12px; background: var(--brand-2); color: #fff;
    display: grid; place-items: center; font-weight: 800; margin-bottom: 16px; }
  .gate h2 { margin: 0 0 6px; font-size: 1.2rem; }
  .gate p { margin: 0 0 18px; color: var(--ink-3); font-size: .88rem; line-height: 1.45; }
  .gate input { width: 100%; }
  .gate button { width: 100%; margin-top: 10px; padding: 12px; }
  .err { color: var(--bad); font-size: .82rem; min-height: 1.1em; margin-top: 8px; }

  /* Kepala */
  header.top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
  .biz { min-width: 0; }
  .biz h1 { margin: 0; font-size: 1.25rem; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .biz .sub { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
  .badge { font-size: .7rem; font-weight: 600; padding: 3px 9px; border-radius: 99px; background: var(--brand-soft); color: var(--brand); }
  .actions { display: flex; gap: 8px; flex-shrink: 0; }
  .icon-btn { padding: 9px 12px; }

  /* KPI */
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 14px; }
  .kpi { padding: 14px 16px; }
  .kpi .label { color: var(--ink-3); font-size: .74rem; font-weight: 500; }
  .kpi .val { font-size: 1.45rem; font-weight: 700; margin-top: 4px; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
  .kpi .note { color: var(--ink-3); font-size: .74rem; margin-top: 2px; }
  .kpi.alert .val { color: var(--bad); }

  .row2 { display: grid; grid-template-columns: 1.4fr 1fr; gap: 12px; margin-bottom: 14px; }
  .panel { padding: 16px; }
  .panel h3 { margin: 0 0 2px; font-size: .95rem; }

  /* Grafik 7 hari */
  .panel.week { display: flex; flex-direction: column; }
  .chart { display: flex; align-items: flex-end; gap: 8px; height: 132px; flex: 1 0 132px; margin-top: 14px; }
  .chart .col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; height: 100%; min-width: 0; }
  .chart .barwrap { flex: 1; width: 100%; display: flex; align-items: flex-end; }
  .chart .bar { width: 100%; border-radius: 6px 6px 2px 2px; background: var(--brand-2); opacity: .35; min-height: 3px; }
  .chart .col.today .bar { opacity: 1; }
  .chart .d { font-size: .68rem; color: var(--ink-3); }
  .chart .v { font-size: .66rem; color: var(--ink-2); font-variant-numeric: tabular-nums; white-space: nowrap; }

  /* Kode pembatalan */
  .ocode .st { font-size: .82rem; color: var(--ink-3); margin: 6px 0 12px; line-height: 1.4; }
  .ocode .btns { display: flex; gap: 8px; }
  .ocode .btns button { flex: 1; }
  .ocode .big { margin-top: 12px; padding: 14px; text-align: center; border-radius: 12px; background: var(--brand-soft); }
  .ocode .big b { display: block; font-size: 2.3rem; letter-spacing: .32em; padding-left: .32em; font-variant-numeric: tabular-nums; color: var(--brand); }
  .ocode .big span { display: block; margin-top: 6px; font-size: .76rem; color: var(--ink-2); line-height: 1.4; }

  /* Tab */
  .tabs { display: flex; gap: 4px; padding: 4px; background: var(--surface-2); border-radius: 14px; margin: 4px 0 12px; overflow-x: auto; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tabs button { flex: 1 0 auto; border: 0; background: transparent; padding: 9px 8px; border-radius: 10px; font-weight: 600; color: var(--ink-3); white-space: nowrap; }
  .tabs button.active { background: var(--surface); color: var(--ink); box-shadow: var(--shadow); }

  .exportbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px; margin-bottom: 12px; }
  .exportbar .t { font-size: .85rem; font-weight: 600; margin-right: auto; }
  .exportbar select, .exportbar input[type=date] { padding: 8px 10px; font-size: .85rem; }
  .exportbar .msg { flex-basis: 100%; font-size: .78rem; color: var(--ink-3); }
  .exportbar .msg.err { color: var(--bad); }

  /* Daftar */
  .list { padding: 4px 16px; }
  .item { display: flex; gap: 12px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--border); }
  .item:last-child { border-bottom: 0; }
  .item .main { flex: 1; min-width: 0; }
  .item .t1 { font-weight: 600; font-size: .9rem; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .item .t2 { font-size: .78rem; color: var(--ink-3); margin-top: 2px; overflow-wrap: anywhere; }
  .item .amt { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; }
  .item .amt small { display: block; font-weight: 500; font-size: .72rem; color: var(--warn); }
  .tag { font-size: .68rem; font-weight: 600; padding: 2px 8px; border-radius: 99px; background: var(--surface-2); color: var(--ink-2); white-space: nowrap; }
  .tag.paid { background: var(--ok-soft); color: var(--ok); }
  .tag.void { background: var(--bad-soft); color: var(--bad); }
  .tag.open { background: var(--warn-soft); color: var(--warn); }
  .tag.owner { background: var(--brand-soft); color: var(--brand); }
  .loading, .empty { color: var(--ink-3); padding: 28px 12px; text-align: center; font-size: .88rem; }

  /* Pembatalan */
  .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  .seg { display: flex; gap: 4px; padding: 3px; background: var(--surface-2); border-radius: 12px; }
  .seg button { border: 0; background: transparent; padding: 6px 12px; font-size: .8rem; border-radius: 9px; color: var(--ink-3); font-weight: 600; }
  .seg button.active { background: var(--surface); color: var(--ink); box-shadow: var(--shadow); }
  .ckpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
  .ckpis .kpi .val { font-size: 1.15rem; }
  .groups { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
  .group { padding: 12px 14px; }
  .group h4 { margin: 0 0 8px; font-size: .74rem; color: var(--ink-3); font-weight: 600; }
  .group .gr { display: flex; justify-content: space-between; gap: 8px; font-size: .8rem; padding: 3px 0; }
  .group .gr span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .group .gr span:last-child { white-space: nowrap; color: var(--ink-2); }
  .crow { padding: 12px 14px; margin-bottom: 8px; }
  .crow .top { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .crow .no { font-weight: 600; font-size: .9rem; }
  .crow .amt { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .crow .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .crow .reason { margin: 8px 0 6px; font-size: .88rem; }
  .crow .who { display: flex; flex-wrap: wrap; gap: 2px 14px; font-size: .76rem; color: var(--ink-3); }
  .crow .who b { color: var(--ink-2); font-weight: 600; }
  .corr { margin: 6px 0; padding: 8px 10px; border-left: 3px solid var(--bad); background: var(--bad-soft); border-radius: 0 8px 8px 0; font-size: .78rem; }
  .corr .ci { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; }
  .corr .ci span:last-child { white-space: nowrap; }
  .corr .cm { color: var(--ink-3); font-size: .72rem; margin-bottom: 3px; }
  /* Penjualan */
  .blist .br { position: relative; display: flex; justify-content: space-between; gap: 8px; font-size: .8rem; padding: 5px 8px; margin: 2px -8px; border-radius: 8px; overflow: hidden; }
  .blist .br i { position: absolute; inset: 0 auto 0 0; background: var(--brand-soft); z-index: 0; }
  .blist .br span { position: relative; z-index: 1; }
  .blist .br span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .blist .br span:last-child { white-space: nowrap; color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .hours { padding: 14px 16px; margin-bottom: 12px; }
  .hours h4 { margin: 0; font-size: .74rem; color: var(--ink-3); font-weight: 600; }
  .hours .chart { height: 110px; flex-basis: 110px; gap: 4px; }
  .sales-tbl { width: 100%; border-collapse: collapse; font-size: .82rem; }
  .sales-tbl th { text-align: left; font-size: .72rem; color: var(--ink-3); font-weight: 600; padding: 4px 0 8px; }
  .sales-tbl td { padding: 7px 0; border-top: 1px solid var(--border); font-variant-numeric: tabular-nums; }
  .sales-tbl th:not(:first-child), .sales-tbl td:not(:first-child) { text-align: right; padding-left: 10px; white-space: nowrap; }
  /* Meja (kafe) */
  .tables { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .tbl { padding: 12px 14px; border-left: 4px solid var(--border); }
  .tbl.busy { border-left-color: var(--warn); }
  .tbl.bill { border-left-color: var(--bad); }
  .tbl.clean { border-left-color: var(--ink-4); }
  .tbl .nm { font-weight: 700; display: flex; justify-content: space-between; gap: 6px; align-items: baseline; }
  .tbl .nm small { font-weight: 500; font-size: .7rem; color: var(--ink-3); }
  .tbl .st { font-size: .74rem; color: var(--ink-3); margin-top: 4px; }
  .tbl .ord { font-size: .78rem; margin-top: 6px; font-variant-numeric: tabular-nums; }
  /* Bukti bayar (kantin) */
  .proof img { display: block; max-width: 100%; max-height: 420px; margin: 8px 0 4px; border-radius: 10px; border: 1px solid var(--border); }
  .linkbtn { border: 0; background: none; padding: 0; color: var(--brand); font-weight: 600; font-size: .78rem; cursor: pointer; }
  .sect { margin: 18px 0 8px; font-size: .78rem; font-weight: 600; color: var(--ink-3); }

  @media (max-width: 760px) {
    .kpis { grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .kpi { padding: 12px 14px; }
    .kpi .val { font-size: 1.2rem; }
    .row2 { grid-template-columns: 1fr; }
    .groups { grid-template-columns: 1fr; }
    .ckpis { grid-template-columns: repeat(2, 1fr); }
    .exportbar .t { flex-basis: 100%; }
    .exportbar select { flex: 1 1 100%; }
    .exportbar input[type=date] { flex: 1 1 40%; min-width: 0; }
    .exportbar button.primary { flex: 1 1 100%; padding: 11px; }
    .toolbar .muted { flex-basis: 100%; }
    .actions .lbl { display: none; }
    .tabs button { padding: 9px 4px; font-size: .82rem; }
  }
</style>
</head>
<body>
  <!-- Gerbang -->
  <div id="gate" class="gate card hide">
    <div class="logo">K</div>
    <h2>__OWNER_TITLE__</h2>
    <p>Buka tautan akses yang diberikan admin Kione, atau tempel tautan / kode akses di bawah ini.</p>
    <input id="token" type="password" placeholder="Tautan atau kode akses" autocomplete="off" />
    <button class="primary" id="gateBtn" onclick="login()">Masuk</button>
    <div id="gateErr" class="err"></div>
  </div>

  <!-- Aplikasi -->
  <div id="app" class="wrap hide">
    <header class="top">
      <div class="biz">
        <h1 id="bizName">…</h1>
        <div class="sub"><span id="bizType" class="badge hide"></span><span id="updated" class="muted"></span></div>
      </div>
      <div class="actions">
        <button class="icon-btn" onclick="refresh()" title="Muat ulang">↻<span class="lbl"> Muat ulang</span></button>
        <button class="icon-btn" onclick="logout()" title="Keluar">Keluar</button>
      </div>
    </header>

    <div id="kpis" class="kpis"></div>

    <div class="row2">
      <div class="card panel week">
        <h3>Omzet 7 hari</h3>
        <div class="muted" id="weekTotal"></div>
        <div id="chart" class="chart"></div>
      </div>
      <div class="card panel ocode">
        <h3>Kode Pembatalan</h3>
        <div class="st" id="ocStatus">Memuat…</div>
        <div class="btns">
          <button class="primary" id="ocGen" onclick="genOwnerCode()">Buat Kode</button>
          <button id="ocDel" class="hide" onclick="delOwnerCode()">Hapus</button>
        </div>
        <div class="big hide" id="ocShow"><b id="ocCode"></b><span>Sebutkan ke kasir. Berlaku untuk satu pembatalan/retur, tampil sekali, tablet perlu internet.</span></div>
        <div class="err" id="ocErr"></div>
      </div>
    </div>

    <div class="tabs" id="tabs"></div>
    <div id="exportBar" class="exportbar card">
      <span class="t" id="expTitle">Unduh laporan PDF</span>
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
    <div id="paneOrders"></div>
    <div id="paneSales" class="hide"></div>
    <div id="paneTables" class="hide"></div>
    <div id="panePayLater" class="hide"></div>
    <div id="paneProofs" class="hide"></div>
    <div id="paneCancels" class="hide"></div>
    <div id="paneActivity" class="hide"></div>
  </div>

<script>
  // Area konsol ditanam server: 'kafe' (/owner/kafe), 'kantin' (/owner/kantin), 'umum' (/owner).
  // Token hanya diterima di area jenis usahanya, jadi disimpan terpisah per area.
  const AREA = '__OWNER_AREA__';
  const BASE = AREA === 'umum' ? '/owner' : '/owner/' + AREA;
  const tokenKey = (area) => area === 'umum' ? 'kione_owner_token' : 'kione_owner_token_' + area;
  const TK = tokenKey(AREA);
  let cancelDays = 30;
  let salesPreset = 'today';
  let proofPreset = 'today';
  let currentTab = 'orders';
  const loaded = {};

  const TABS = [['orders', 'Transaksi', 'paneOrders'], ['sales', 'Penjualan', 'paneSales']]
    .concat(AREA === 'kafe' ? [['tables', 'Meja', 'paneTables']] : [])
    .concat(AREA === 'kantin' ? [['payLater', 'Tagihan Tertunda', 'panePayLater'], ['proofs', 'Bukti Bayar', 'paneProofs']] : [])
    .concat([['cancels', 'Pembatalan', 'paneCancels'], ['activity', 'Aktivitas', 'paneActivity']]);
  const LOADERS = { cancels: () => loadCancels(), sales: () => loadSales(), tables: () => loadTables(), payLater: () => loadPayLater(), proofs: () => loadProofs() };
  document.getElementById('tabs').innerHTML = TABS.map(([key, label]) =>
    '<button data-tab="' + key + '" onclick="showTab(\\'' + key + '\\')">' + label + '</button>').join('');

  // Tersimpan di localStorage agar Pemilik tetap masuk di HP-nya; fallback memori bila diblokir.
  let memToken = '';
  function token() { try { return localStorage.getItem(TK) || memToken; } catch { return memToken; } }
  function setToken(v) {
    memToken = v || '';
    try { v ? localStorage.setItem(TK, v) : localStorage.removeItem(TK); } catch {}
  }
  /** Ambil token dari tautan \`…/owner#k=<token>\` atau dari teks yang ditempel. */
  function parseToken(raw) {
    const s = String(raw || '').trim().replace(/^(['"])(.*)\\1$/, '$2').trim();
    const m = /[#&?]k=([A-Za-z0-9_-]+)/.exec(s);
    return m ? m[1] : s;
  }

  const rupiah = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
  const compact = (n) => {
    n = Number(n) || 0;
    if (n >= 1e9) return 'Rp ' + (n / 1e9).toFixed(1).replace('.', ',') + 'M';
    if (n >= 1e6) return 'Rp ' + (n / 1e6).toFixed(1).replace('.', ',') + 'jt';
    if (n >= 1e3) return 'Rp ' + Math.round(n / 1e3) + 'rb';
    return rupiah(n);
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BT = { cafe_resto: 'Kafe & Resto', kantin: 'Kantin', minimarket: 'Minimarket', lainnya: 'Lainnya' };
  function fmtTime(ms) {
    if (!ms) return '—';
    return new Date(Number(ms)).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function ago(ms) {
    if (!ms) return 'belum pernah';
    const s = (Date.now() - Number(ms)) / 1000;
    if (s < 90) return 'baru saja';
    if (s < 3600) return Math.round(s / 60) + ' mnt lalu';
    if (s < 86400) return Math.round(s / 3600) + ' jam lalu';
    return Math.round(s / 86400) + ' hr lalu';
  }

  const REJECTED = 'Tautan akses tidak berlaku lagi. Minta tautan baru ke admin Kione.';
  /** Token milik jenis usaha lain (403 + consolePath). Di /owner (tautan lama) pindah otomatis;
   *  di /owner/kafe atau /owner/kantin ditolak dan Pemilik diarahkan ke konsolnya sendiri. */
  async function wrongArea(res) {
    let j = {};
    try { j = await res.json(); } catch {}
    const target = j.consolePath;
    if (!target) return false;
    const tk = token();
    setToken('');
    if (AREA === 'umum') {
      try { localStorage.setItem(tokenKey(target.split('/')[2] || 'umum'), tk); } catch {}
      location.replace(target + '#k=' + tk);
      return true;
    }
    showGate(j.error || 'Tautan ini bukan untuk konsol ini.');
    const err = document.getElementById('gateErr');
    const a = document.createElement('a');
    a.href = target; a.textContent = 'Buka konsol yang sesuai →';
    err.appendChild(document.createElement('br'));
    a.onclick = (e) => { e.preventDefault(); location.href = target + '#k=' + tk; };
    err.appendChild(a);
    return true;
  }
  async function apiRes(path, method) {
    let res;
    try {
      res = await fetch(BASE + '/api' + path, { method: method || 'GET', headers: { Authorization: 'Bearer ' + token() }, cache: 'no-store' });
    } catch {
      throw new Error('Tidak bisa menghubungi server. Periksa koneksi internet.');
    }
    if (res.status === 401) { setToken(''); showGate(REJECTED); throw new Error('401'); }
    if (res.status === 403 && await wrongArea(res)) throw new Error('401');
    return res;
  }
  async function api(path, method) {
    const res = await apiRes(path, method);
    if (res.status === 429) throw new Error('Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.');
    if (!res.ok) throw new Error('Server bermasalah (HTTP ' + res.status + '). Coba lagi nanti.');
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
    const v = parseToken(document.getElementById('token').value);
    if (!v) return;
    setToken(v);
    const btn = document.getElementById('gateBtn');
    btn.disabled = true; btn.textContent = 'Memeriksa…';
    document.getElementById('gateErr').textContent = '';
    try { await start(); }
    catch (e) { if (String(e.message) !== '401') { setToken(''); document.getElementById('gateErr').textContent = e.message; } }
    finally { btn.disabled = false; btn.textContent = 'Masuk'; }
  }
  function logout() {
    if (!confirm('Keluar dari konsol di perangkat ini? Anda perlu tautan akses lagi untuk masuk.')) return;
    setToken(''); showGate('');
  }

  async function start() {
    await loadOverview();
    showApp();
    loadOwnerCode();
    loadDetail();
    for (const k of Object.keys(loaded)) delete loaded[k];
    showTab(currentTab);
  }
  function refresh() {
    start().catch((e) => { if (String(e.message) !== '401') alertMsg(e.message); });
  }
  function alertMsg(m) { document.getElementById('updated').textContent = m; }

  // ---- Ringkasan ----
  async function loadOverview() {
    const d = await api('/overview');
    const name = d.businessName || d.tenantId;
    document.getElementById('bizName').textContent = name;
    document.title = name + ' · __OWNER_TITLE__';
    const bt = document.getElementById('bizType');
    bt.textContent = BT[d.businessType] || '';
    bt.classList.toggle('hide', !BT[d.businessType]);
    const c = d.cancellations;
    const dev = d.devices;
    const h = d.highlights || {};
    const devText = dev.online + '/' + dev.total + ' kasir online';
    document.getElementById('updated').textContent = 'Diperbarui ' + fmtTime(Date.now()) + (AREA === 'kafe' ? ' · ' + devText : '');

    const k = [
      kpi('Omzet hari ini', compact(d.today.revenue), rupiah(d.today.revenue)),
      kpi('Transaksi hari ini', d.today.txns.toLocaleString('id-ID'), d.today.txns ? 'rata-rata ' + compact(d.today.revenue / d.today.txns) : ''),
    ];
    if (AREA === 'kafe') {
      k.push(
        kpi('Meja terisi', h.tables.occupied + ' / ' + h.tables.total, h.tables.total ? 'saat ini' : 'belum ada meja'),
        kpi('Tamu hari ini', h.guestsToday.toLocaleString('id-ID'), d.today.txns && h.guestsToday ? compact(d.today.revenue / h.guestsToday) + ' per tamu' : ''),
        kpi('Tip hari ini', compact(h.tipsToday), 'di luar omzet'),
      );
    }
    if (AREA === 'kantin') {
      k.push(
        kpi('Tagihan tertunda', h.payLater.count, h.payLater.count ? compact(h.payLater.value) + ' belum dibayar' : 'semua lunas', h.payLater.count > 0),
        kpi('Bukti bayar hari ini', h.proofsToday.count, h.proofsToday.withoutPhoto ? h.proofsToday.withoutPhoto + ' tanpa foto' : 'QRIS & transfer', h.proofsToday.withoutPhoto > 0),
      );
    }
    k.push(kpi('Batal hari ini', c.todayCount, c.todayCount ? compact(c.todayValue) : c.last7DaysCount + ' dalam 7 hari', c.todayCount > 0));
    if (AREA !== 'kafe') k.push(kpi('Kasir online', dev.online + ' / ' + dev.total, dev.online ? 'aktif' : 'terakhir ' + ago(dev.lastSeenAt)));
    document.getElementById('kpis').innerHTML = k.join('');
    renderChart(d.last7Days);
  }
  const kpi = (label, val, note, alert) =>
    '<div class="card kpi' + (alert ? ' alert' : '') + '"><div class="label">' + esc(label) + '</div><div class="val">' + esc(val) + '</div>' +
    (note ? '<div class="note">' + esc(note) + '</div>' : '') + '</div>';

  function renderChart(days) {
    const slots = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400000);
      const key = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      const hit = (days || []).find((x) => x.date === key);
      slots.push({ v: hit ? hit.revenue : 0, label: i === 0 ? 'Hari ini' : date.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'short' }), today: i === 0 });
    }
    const max = Math.max(1, ...slots.map((s) => s.v));
    const total = slots.reduce((a, s) => a + s.v, 0);
    document.getElementById('weekTotal').textContent = 'Total ' + rupiah(total);
    document.getElementById('chart').innerHTML = slots.map((s) =>
      '<div class="col' + (s.today ? ' today' : '') + '" title="' + esc(s.label + ': ' + rupiah(s.v)) + '">' +
      '<span class="v">' + (s.v ? esc(compact(s.v).replace('Rp ', '')) : '') + '</span>' +
      '<div class="barwrap"><div class="bar" style="height:' + Math.max(2, Math.round((s.v / max) * 100)) + '%"></div></div>' +
      '<span class="d">' + esc(s.label) + '</span></div>').join('');
  }

  // ---- Transaksi & aktivitas ----
  async function loadDetail() {
    document.getElementById('paneOrders').innerHTML = '<div class="card loading">Memuat…</div>';
    document.getElementById('paneActivity').innerHTML = '<div class="card loading">Memuat…</div>';
    try {
      const d = await api('/detail');
      renderOrders(d.orders);
      renderActivity(d.auditLogs);
    } catch (e) {
      if (String(e.message) === '401') return;
      const msg = '<div class="card empty">' + esc(e.message) + '</div>';
      document.getElementById('paneOrders').innerHTML = msg;
      document.getElementById('paneActivity').innerHTML = msg;
    }
  }
  const ST = { paid: ['Lunas', 'paid'], completed: ['Selesai', 'paid'], void: ['Batal', 'void'], open: ['Terbuka', 'open'] };
  function renderOrders(orders) {
    const el = document.getElementById('paneOrders');
    if (!orders || !orders.length) { el.innerHTML = '<div class="card empty">Belum ada transaksi.</div>'; return; }
    el.innerHTML = '<div class="card list">' + orders.map((o) => {
      const st = ST[o.status] || [o.status || '—', 'open'];
      const who = o.cashierName || (o.source === 'qr_table' ? 'Pesanan QR' : '—');
      return '<div class="item"><div class="main">' +
        '<div class="t1">' + esc(o.orderNumber || '—') + ' <span class="tag ' + st[1] + '">' + esc(st[0]) + '</span></div>' +
        '<div class="t2">' + esc(fmtTime(o.paidAt || o.createdAt)) + ' · ' + esc(who) + '</div></div>' +
        '<div class="amt">' + rupiah(o.grandTotal) + (o.discountAmount > 0 ? '<small>diskon ' + rupiah(o.discountAmount) + '</small>' : '') + '</div></div>';
    }).join('') + '</div><div class="muted" style="text-align:center;margin-top:10px">60 transaksi terbaru · unduh PDF untuk periode lengkap</div>';
  }
  function renderActivity(logs) {
    const el = document.getElementById('paneActivity');
    if (!logs || !logs.length) { el.innerHTML = '<div class="card empty">Belum ada log aktivitas.</div>'; return; }
    el.innerHTML = '<div class="card list">' + logs.map((l) =>
      '<div class="item"><div class="main">' +
      '<div class="t1">' + esc(l.userName || '—') + ' <span class="tag">' + esc(l.action || '') + '</span></div>' +
      '<div class="t2">' + esc(l.details || '') + '</div></div>' +
      '<div class="muted" style="white-space:nowrap">' + esc(fmtTime(l.createdAt)) + '</div></div>').join('') + '</div>';
  }

  function showTab(which) {
    if (!TABS.some(([key]) => key === which)) which = 'orders';
    currentTab = which;
    for (const [key, , pane] of TABS) document.getElementById(pane).classList.toggle('hide', which !== key);
    for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('active', b.dataset.tab === which);
    document.getElementById('exportBar').classList.toggle('hide', which !== 'orders' && which !== 'cancels');
    document.getElementById('expTitle').textContent = which === 'cancels' ? 'Unduh PDF pembatalan' : 'Unduh PDF transaksi';
    setExpMsg('');
    if (LOADERS[which] && !loaded[which]) LOADERS[which]();
  }

  // ---- Kode pembatalan Pemilik ----
  function renderOwnerCode(st) {
    document.getElementById('ocDel').classList.toggle('hide', !st.active);
    document.getElementById('ocGen').textContent = st.active ? 'Buat Kode Baru' : 'Buat Kode';
    let text;
    if (st.active) text = 'Ada 1 kode aktif sejak ' + fmtTime(st.active.createdAt) + ', belum terpakai. Membuat kode baru menggantikannya.';
    else if (st.lastUsed) text = 'Tidak ada kode aktif. Terakhir dipakai ' + fmtTime(st.lastUsed.usedAt) + (st.lastUsed.deviceLabel ? ' di ' + st.lastUsed.deviceLabel : '') + '.';
    else text = 'Buat kode 6 digit saat kasir perlu membatalkan pesanan atau retur dan Anda tidak di tempat.';
    document.getElementById('ocStatus').textContent = text;
  }
  async function loadOwnerCode() {
    try { renderOwnerCode(await api('/owner-code')); }
    catch (e) { if (String(e.message) !== '401') document.getElementById('ocStatus').textContent = 'Gagal memuat status kode.'; }
  }
  async function genOwnerCode() {
    const btn = document.getElementById('ocGen');
    document.getElementById('ocErr').textContent = '';
    btn.disabled = true;
    try {
      const r = await api('/owner-code', 'POST');
      document.getElementById('ocCode').textContent = r.code;
      document.getElementById('ocShow').classList.remove('hide');
      renderOwnerCode({ active: { createdAt: r.createdAt }, lastUsed: null });
    } catch (e) {
      if (String(e.message) !== '401') document.getElementById('ocErr').textContent = e.message;
    } finally { btn.disabled = false; }
  }
  async function delOwnerCode() {
    document.getElementById('ocErr').textContent = '';
    try {
      await api('/owner-code', 'DELETE');
      document.getElementById('ocShow').classList.add('hide');
      document.getElementById('ocCode').textContent = '';
      loadOwnerCode();
    } catch (e) { if (String(e.message) !== '401') document.getElementById('ocErr').textContent = e.message; }
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
      const res = await apiRes('/export/' + kind + '.pdf?from=' + from + '&to=' + to);
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
    } catch (e) {
      if (String(e.message) !== '401') setExpMsg(e.message, true);
    } finally { btn.disabled = false; btn.textContent = 'Unduh PDF'; }
  }

  // ---- Pembatalan ----
  const STAGE = {
    paid: ['Sudah lunas · uang dikembalikan', 'void'],
    kitchen: ['Sudah ke dapur', 'open'],
    unprocessed: ['Belum diproses', ''],
  };
  const APPROVAL = { owner_code: 'Kode Pemilik', supervisor: 'PIN Supervisor', self: 'Tanpa persetujuan' };
  const KIND = { removed: 'dihapus', voided: 'di-void', reduced: 'dikurangi' };

  async function loadCancels(days) {
    if (days) cancelDays = days;
    const pane = document.getElementById('paneCancels');
    pane.innerHTML = '<div class="card loading">Memuat…</div>';
    try { renderCancels(await api('/cancellations?days=' + cancelDays)); loaded.cancels = true; }
    catch (e) { if (String(e.message) !== '401') pane.innerHTML = '<div class="card empty">Gagal memuat pembatalan.</div>'; }
  }
  function groupHtml(title, groups) {
    const top = (groups || []).slice(0, 5);
    return '<div class="card group"><h4>' + esc(title) + '</h4>' +
      (top.length ? top.map((g) => '<div class="gr"><span>' + esc(g.name) + '</span><span>' + g.count + '× · ' + compact(g.value) + '</span></div>').join('')
                  : '<div class="muted">—</div>') + '</div>';
  }
  function correctionsHtml(r) {
    const list = r.corrections || [];
    if (!list.length) return '';
    return '<div class="corr"><div class="cm">Item dikoreksi sebelum dibatalkan' + (r.emptiedFirst ? ' — nilai = total item yang dihapus' : '') + '</div>' +
      list.map((c) =>
        '<div class="ci"><span>' + esc(c.name) + (c.qty ? ' ×' + c.qty : '') + ' · ' + KIND[c.kind] +
        ' · ' + esc(c.reason || (c.kind === 'reduced' ? 'lihat Aktivitas' : 'tanpa alasan')) +
        (c.by ? ' · ' + esc(c.by) : '') + (c.ownerApproved ? ' · kode Pemilik' : '') +
        '</span><span>−' + rupiah(c.value) + '</span></div>').join('') + '</div>';
  }
  function renderCancels(d) {
    const seg = '<div class="seg">' + [7, 30, 90].map((n) =>
      '<button class="' + (n === cancelDays ? 'active' : '') + '" onclick="loadCancels(' + n + ')">' + n + ' hari</button>').join('') + '</div>';
    const head = '<div class="toolbar"><span class="muted">Semua pembatalan ' + d.days + ' hari terakhir</span>' + seg + '</div>';
    const t = d.totals;
    const kp = '<div class="ckpis">' + [
      kpi('Jumlah batal', t.count, compact(t.value), t.count > 0),
      kpi('Batal setelah lunas', t.paidCount, compact(t.paidValue), t.paidCount > 0),
      kpi('Dikosongkan dulu', t.emptiedFirstCount, compact(t.emptiedFirstValue), t.emptiedFirstCount > 0),
      kpi('Pakai kode Pemilik', t.ownerCodeCount, ''),
      kpi('Retur', d.returnTotals.count, compact(d.returnTotals.value), d.returnTotals.count > 0),
    ].join('') + '</div>';
    const returnsHtml = (d.returns || []).length
      ? '<div class="sect">Retur — pengembalian uang (' + d.returns.length + ')</div>' +
        d.returns.map((x) =>
          '<div class="card crow"><div class="top"><span class="no">' + esc((x.orderNumber || '—') + (x.buyer ? ' · ' + x.buyer : '')) + '</span>' +
          '<span class="amt">−' + rupiah(x.amount) + '</span></div>' +
          '<div class="tags"><span class="tag void">Retur</span>' + (x.ownerApproved ? '<span class="tag owner">Kode Pemilik</span>' : '') + '</div>' +
          '<div class="reason">' + esc(x.reason || '(tanpa alasan)') + '</div>' +
          '<div class="who"><span>Item <b>' + esc(x.items.join(', ') || '—') + '</b></span>' +
          '<span>Waktu <b>' + esc(fmtTime(x.at)) + '</b></span><span>Disetujui <b>' + esc(x.approvedBy || '—') + '</b></span></div></div>').join('')
      : '';
    const pane = document.getElementById('paneCancels');
    if (!d.rows.length) { pane.innerHTML = head + kp + '<div class="card empty">Tidak ada pembatalan pada periode ini.</div>' + returnsHtml; return; }
    const groups = '<div class="groups">' + groupHtml('Diminta oleh', d.byRequester) + groupHtml('Disetujui oleh', d.byApprover) + groupHtml('Alasan', d.byReason) + '</div>';
    const list = d.rows.map((r) => {
      const st = STAGE[r.stage] || STAGE.unprocessed;
      const label = (r.queueNumber ? '#' + r.queueNumber + ' · ' : '') + (r.orderNumber || '—') + (r.buyer ? ' · ' + r.buyer : '');
      return '<div class="card crow">' +
        '<div class="top"><span class="no">' + esc(label) + '</span><span class="amt">' + rupiah(r.value) + '</span></div>' +
        '<div class="tags"><span class="tag ' + st[1] + '">' + st[0] + '</span>' +
          (r.approval ? '<span class="tag' + (r.approval === 'owner_code' ? ' owner' : '') + '">' + esc(APPROVAL[r.approval] || r.approval) + '</span>' : '') +
          (r.payLater ? '<span class="tag open">Tagihan tertunda</span>' : '') +
          (r.emptiedFirst ? '<span class="tag void">Dikosongkan dulu lalu dibatalkan</span>' : '') +
          (r.neverHadItems ? '<span class="tag">Pesanan kosong</span>' : '') + '</div>' +
        '<div class="reason">' + esc(r.reason || '(tanpa alasan)') + '</div>' + correctionsHtml(r) +
        '<div class="who"><span>Dibatalkan <b>' + esc(fmtTime(r.voidedAt)) + '</b></span>' +
          '<span>Diminta <b>' + esc(r.requestedBy || '—') + '</b></span>' +
          '<span>Disetujui <b>' + esc(r.approvedBy || '—') + '</b></span>' +
          '<span>Kasir <b>' + esc(r.cashierName || '—') + '</b></span></div></div>';
    }).join('');
    pane.innerHTML = head + kp + groups + list + returnsHtml;
  }

  // ---- Penjualan (isi dibedakan: kafe vs kantin) ----
  const SALES_PRESETS = [['today', 'Hari ini'], ['7d', '7 hari'], ['30d', '30 hari'], ['month', 'Bulan ini']];
  async function loadSales(preset) {
    if (preset) salesPreset = preset;
    const pane = document.getElementById('paneSales');
    pane.innerHTML = '<div class="card loading">Memuat…</div>';
    const [from, to] = presetRange(salesPreset);
    try { renderSales(await api('/sales?from=' + from + '&to=' + to)); loaded.sales = true; }
    catch (e) { if (String(e.message) !== '401') pane.innerHTML = '<div class="card empty">Gagal memuat penjualan.</div>'; }
  }
  /** Daftar dengan batang proporsional; \`val\` = angka pembanding, \`right\` = teks kanan. */
  function barList(title, rows, empty) {
    const max = Math.max(1, ...rows.map((r) => r.val));
    return '<div class="card group blist"><h4>' + esc(title) + '</h4>' +
      (rows.length ? rows.map((r) => '<div class="br"><i style="width:' + Math.round((r.val / max) * 100) + '%"></i>' +
        '<span>' + esc(r.name) + '</span><span>' + esc(r.right) + '</span></div>').join('')
        : '<div class="muted">' + esc(empty || '—') + '</div>') + '</div>';
  }
  function hoursChart(byHour) {
    const busy = byHour.filter((h) => h.count > 0);
    if (!busy.length) return '';
    const from = Math.min(...busy.map((h) => h.hour)), to = Math.max(...busy.map((h) => h.hour));
    const slots = byHour.slice(from, to + 1);
    const max = Math.max(1, ...slots.map((h) => h.count));
    const peak = slots.reduce((a, h) => (h.count > a.count ? h : a), slots[0]);
    return '<div class="card hours"><h4>Jam ramai · tersibuk ' + String(peak.hour).padStart(2, '0') + '.00 (' + peak.count + ' transaksi)</h4>' +
      '<div class="chart">' + slots.map((h) =>
        '<div class="col' + (h.hour === peak.hour ? ' today' : '') + '" title="' + esc(String(h.hour).padStart(2, '0') + '.00: ' + h.count + ' transaksi · ' + rupiah(h.revenue)) + '">' +
        '<span class="v">' + (h.count || '') + '</span>' +
        '<div class="barwrap"><div class="bar" style="height:' + Math.max(2, Math.round((h.count / max) * 100)) + '%"></div></div>' +
        '<span class="d">' + String(h.hour).padStart(2, '0') + '</span></div>').join('') + '</div></div>';
  }
  function renderSales(d) {
    const cafe = d.profile === 'cafe', kantin = d.profile === 'kantin';
    const seg = '<div class="seg">' + SALES_PRESETS.map(([k, label]) =>
      '<button class="' + (k === salesPreset ? 'active' : '') + '" onclick="loadSales(\\'' + k + '\\')">' + label + '</button>').join('') + '</div>';
    const head = '<div class="toolbar"><span class="muted">Penjualan lunas · ' + esc(d.label) + '</span>' + seg + '</div>';
    const t = d.totals;
    const k = [
      kpi('Omzet', compact(t.revenue), rupiah(t.revenue)),
      kpi('Transaksi', t.count.toLocaleString('id-ID'), t.count ? 'rata-rata ' + compact(t.avgTicket) : ''),
      kpi('Diskon', compact(t.discount), ''),
    ];
    if (cafe) k.push(kpi('Tip', compact(t.tips), 'di luar omzet'), kpi('Tamu dine-in', t.guests.toLocaleString('id-ID'), ''));
    if (kantin) k.push(kpi('Tagihan tertunda', d.payLater.count, d.payLater.count ? compact(d.payLater.value) + ' belum dibayar' : 'semua lunas', d.payLater.count > 0));
    const kp = '<div class="ckpis">' + k.join('') + '</div>';

    const typeRows = d.byType.map((x) => ({ name: x.label, val: x.revenue, right: x.count + '× · ' + compact(x.revenue) }));
    const groups = '<div class="groups">' +
      barList(kantin ? 'Makan di tempat / bungkus' : 'Jenis pesanan', typeRows) +
      barList('Metode bayar', d.byMethod.map((m) => ({ name: m.label, val: m.amount, right: m.count + '× · ' + compact(m.amount) }))) +
      barList('Produk terlaris', d.topProducts.slice(0, 10).map((p) => ({ name: p.name, val: p.qty, right: p.qty.toLocaleString('id-ID') + ' · ' + compact(p.revenue) }))) +
      '</div>';

    let extra = '';
    if (cafe) {
      extra += '<div class="sect">Per pelayan</div>' + (d.byWaiter.length
        ? '<div class="card list"><table class="sales-tbl"><thead><tr><th>Pelayan</th><th>Pesanan</th><th>Omzet</th><th>Tip</th></tr></thead><tbody>' +
          d.byWaiter.map((w) => '<tr><td>' + esc(w.name) + '</td><td>' + w.count + '</td><td>' + rupiah(w.revenue) + '</td><td>' + rupiah(w.tips) + '</td></tr>').join('') +
          '</tbody></table></div>'
        : '<div class="card empty">Belum ada pesanan yang mencatat pelayan pada periode ini.</div>');
    }

    const pane = document.getElementById('paneSales');
    if (!t.count) { pane.innerHTML = head + kp + '<div class="card empty">Belum ada penjualan lunas pada periode ini.</div>' + extra; return; }
    pane.innerHTML = head + kp + groups + hoursChart(d.byHour) + extra;
  }

  // ---- Meja (kafe) ----
  const TABLE_ST = { available: ['Kosong', ''], occupied: ['Terisi', 'busy'], awaiting_payment: ['Menunggu bayar', 'bill'], needs_cleaning: ['Perlu dibersihkan', 'clean'] };
  async function loadTables() {
    const pane = document.getElementById('paneTables');
    pane.innerHTML = '<div class="card loading">Memuat…</div>';
    try { renderTables((await api('/tables')).tables); loaded.tables = true; }
    catch (e) { if (String(e.message) !== '401') pane.innerHTML = '<div class="card empty">Gagal memuat status meja.</div>'; }
  }
  function renderTables(tables) {
    const pane = document.getElementById('paneTables');
    if (!tables.length) { pane.innerHTML = '<div class="card empty">Belum ada meja. Meja diatur di tablet kasir (menu Meja).</div>'; return; }
    const busy = tables.filter((t) => t.status !== 'available');
    const running = busy.reduce((a, t) => a + (t.order && t.order.status === 'open' ? t.order.grandTotal : 0), 0);
    const head = '<div class="toolbar"><span class="muted">' + busy.length + ' dari ' + tables.length + ' meja terisi' +
      (running ? ' · pesanan berjalan ' + rupiah(running) : '') + '</span>' +
      '<button class="linkbtn" onclick="loadTables()">Muat ulang</button></div>';
    const areas = [];
    for (const t of tables) {
      const key = t.area || 'Tanpa area';
      let g = areas.find((x) => x.key === key);
      if (!g) areas.push(g = { key, rows: [] });
      g.rows.push(t);
    }
    pane.innerHTML = head + areas.map((g) =>
      (areas.length > 1 ? '<div class="sect">' + esc(g.key) + '</div>' : '') +
      '<div class="tables">' + g.rows.map((t) => {
        const st = TABLE_ST[t.status] || [t.status, ''];
        const since = t.occupiedSince && t.status !== 'available' ? ' · ' + ago(t.occupiedSince).replace(' lalu', '') : '';
        const o = t.order && t.status !== 'available'
          ? '<div class="ord">' + esc(t.order.orderNumber || '—') + ' · <b>' + rupiah(t.order.grandTotal) + '</b>' +
            (t.order.waiterName ? '<div class="muted">' + esc(t.order.waiterName) + '</div>' : '') + '</div>'
          : '';
        return '<div class="card tbl ' + st[1] + '"><div class="nm">' + esc(t.name) + '<small>' +
          (t.guestCount ? t.guestCount + '/' : '') + (t.capacity || '–') + ' kursi</small></div>' +
          '<div class="st">' + esc(st[0] + since) + '</div>' + o + '</div>';
      }).join('') + '</div>').join('');
  }

  // ---- Tagihan Tertunda (kantin) ----
  async function loadPayLater() {
    const pane = document.getElementById('panePayLater');
    pane.innerHTML = '<div class="card loading">Memuat…</div>';
    try { renderPayLater(await api('/pay-later')); loaded.payLater = true; }
    catch (e) { if (String(e.message) !== '401') pane.innerHTML = '<div class="card empty">Gagal memuat tagihan tertunda.</div>'; }
  }
  function payLaterItem(r, settled) {
    return '<div class="item"><div class="main"><div class="t1">' + esc(r.name) +
      (settled ? ' <span class="tag paid">Lunas</span>' : ' <span class="tag open">Belum dibayar</span>') + '</div>' +
      '<div class="t2">' + esc(r.orderNumber || '—') + ' · dicatat ' + esc(fmtTime(r.markedAt)) + (r.markedByName ? ' oleh ' + esc(r.markedByName) : '') +
      (settled ? ' · dilunasi ' + esc(fmtTime(r.paidAt)) : ' · ' + esc(ago(r.markedAt))) +
      (r.note ? '<br>' + esc(r.note) : '') + '</div></div>' +
      '<div class="amt">' + rupiah(r.value) + '</div></div>';
  }
  function renderPayLater(d) {
    const pane = document.getElementById('panePayLater');
    const kp = '<div class="ckpis">' +
      kpi('Belum dibayar', d.open.length, d.open.length ? compact(d.openValue) : 'semua lunas', d.open.length > 0) +
      kpi('Dilunasi 30 hari', d.settled.length, compact(d.settled.reduce((a, r) => a + r.value, 0))) + '</div>';
    pane.innerHTML = kp +
      '<div class="sect">Belum dibayar (' + d.open.length + ') · terlama di atas</div>' +
      (d.open.length ? '<div class="card list">' + d.open.map((r) => payLaterItem(r, false)).join('') + '</div>'
                     : '<div class="card empty">Tidak ada tagihan tertunda.</div>') +
      (d.settled.length ? '<div class="sect">Dilunasi 30 hari terakhir</div><div class="card list">' + d.settled.map((r) => payLaterItem(r, true)).join('') + '</div>' : '');
  }

  // ---- Bukti bayar QRIS/transfer (kantin) ----
  const PROOF_PRESETS = [['today', 'Hari ini'], ['yesterday', 'Kemarin'], ['7d', '7 hari']];
  const METHOD = { qris: 'QRIS', transfer: 'Transfer' };
  async function loadProofs(preset) {
    if (preset) proofPreset = preset;
    const pane = document.getElementById('paneProofs');
    pane.innerHTML = '<div class="card loading">Memuat…</div>';
    const [from, to] = presetRange(proofPreset);
    try { renderProofs(await api('/proofs?from=' + from + '&to=' + to)); loaded.proofs = true; }
    catch (e) { if (String(e.message) !== '401') pane.innerHTML = '<div class="card empty">Gagal memuat bukti bayar.</div>'; }
  }
  function renderProofs(d) {
    const seg = '<div class="seg">' + PROOF_PRESETS.map(([k, label]) =>
      '<button class="' + (k === proofPreset ? 'active' : '') + '" onclick="loadProofs(\\'' + k + '\\')">' + label + '</button>').join('') + '</div>';
    const noPhoto = d.proofs.filter((x) => !x.hasPhoto).length;
    const head = '<div class="toolbar"><span class="muted">Bukti bayar QRIS & transfer · ' + esc(d.label) +
      (noPhoto ? ' · <b style="color:var(--bad)">' + noPhoto + ' tanpa foto</b>' : '') + '</span>' + seg + '</div>';
    const pane = document.getElementById('paneProofs');
    if (!d.proofs.length) { pane.innerHTML = head + '<div class="card empty">Belum ada bukti bayar pada periode ini.</div>'; return; }
    pane.innerHTML = head + '<div class="card list">' + d.proofs.map((x) =>
      '<div class="item proof"><div class="main"><div class="t1">' + esc(x.orderNumber || '—') +
      ' <span class="tag">' + esc(METHOD[x.method] || 'Non-tunai') + '</span>' +
      (x.hasPhoto ? '' : ' <span class="tag void">Tanpa foto</span>') + '</div>' +
      '<div class="t2">' + esc(fmtTime(x.createdAt)) + ' · ' + esc(x.takenByName || '—') +
      (x.noPhotoReason ? '<br>Alasan: ' + esc(x.noPhotoReason) : '') + '</div>' +
      (x.hasPhoto ? '<div id="ph-' + esc(x.id) + '"><button class="linkbtn" onclick="showProofPhoto(\\'' + esc(x.id) + '\\')">Lihat foto</button></div>' : '') +
      '</div><div class="amt">' + rupiah(x.amount) + '</div></div>').join('') + '</div>';
  }
  async function showProofPhoto(id) {
    const box = document.getElementById('ph-' + id);
    if (!box) return;
    box.innerHTML = '<span class="muted">Memuat foto…</span>';
    try {
      const res = await apiRes('/proofs/' + encodeURIComponent(id) + '/photo');
      if (!res.ok) throw new Error('Foto tidak bisa dimuat (HTTP ' + res.status + ').');
      const url = URL.createObjectURL(await res.blob());
      box.innerHTML = '<img alt="Foto bukti bayar" src="' + url + '" />';
    } catch (e) {
      if (String(e.message) !== '401') box.innerHTML = '<span class="err">' + esc(e.message) + '</span>';
    }
  }

  document.getElementById('token').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });

  // Tautan akses \`…/owner#k=<token>\`: simpan token, lalu hapus dari bilah alamat.
  (function boot() {
    const fromLink = parseToken(location.hash);
    if (location.hash && fromLink && fromLink !== location.hash) {
      setToken(fromLink);
      history.replaceState(null, '', location.pathname + location.search);
    }
    if (!token()) { showGate(''); return; }
    start().catch((e) => { if (String(e.message) !== '401') showGate(e.message); });
  })();
</script>
</body>
</html>
`
