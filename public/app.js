// Joyhavn front end: plain ES modules, no build step, hash routing (works on any static host).
import { initWallets, onWalletChange, snapshot as walletSnap, connectWallet, disconnectWallet, isMobile, phantomDeepLink, solflareDeepLink } from './wallet.js';
import { payWithWallet, PayError } from './x402-browser.js';
import { agentSupported, getAgentWallet, createAgentWallet, forgetAgentWallet, agentSign } from './agent-wallet.js';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = (a, n = 4) => (a && a.length > 2 * n + 2 ? `${a.slice(0, n)}…${a.slice(-n)}` : a || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usd = (n, d = 3) => `$${Number(n || 0).toFixed(d)}`;
const nf = (n, o = {}) => new Intl.NumberFormat('en-US', o).format(n);

/* ---------------- icons ---------------- */
const I = {
  home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  doc: '<path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/>',
  db: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  sol: '<path d="M5 8h13l-2 2.5H3zM5 13.5h13l-2 2.5H3zM8 19h13l-2-2.5H6z"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
};
const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[n] || I.bolt}</svg>`;

/* ---------------- fallback catalogue (used only if the API cannot be reached) ---------------- */
const FALLBACK_SERVICES = [
  { id: 'url-safety-scan', name: 'URL Safety Scan', icon: 'link', category: 'Security', description: 'Check if a link is safe, malicious or suspicious before you click.', price: '$0.005', priceUsd: 0.005, path: '/api/v1/url-safety-scan', param: 'url', paramLabel: 'URL to scan', example: 'https://phantom-airdrop-claim.secure-verify.xyz/connect-wallet', maxLen: 500 },
  { id: 'ai-summary', name: 'AI Summary', icon: 'doc', category: 'Writing', description: 'Get a clear, concise summary of any article or document.', price: '$0.008', priceUsd: 0.008, path: '/api/v1/ai-summary', param: 'text', paramLabel: 'Text to summarise', example: 'Solana is a high-performance blockchain known for fast confirmation and very low fees. x402 revives the HTTP 402 Payment Required status code so a client can pay for an API call inside the same request. Combined, they make tiny pay-per-use payments practical.', maxLen: 3000 },
  { id: 'data-snapshot', name: 'Data Snapshot', icon: 'db', category: 'Market data', description: 'Get a live market snapshot for any crypto asset: price, 24h change, volume and rank.', price: '$0.01', priceUsd: 0.01, path: '/api/v1/data-snapshot', param: 'asset', paramLabel: 'Crypto asset (name or symbol)', example: 'solana', maxLen: 60 },
  { id: 'json-validator', name: 'JSON Validator', icon: 'code', category: 'Developer tools', description: 'Validate and format JSON data with detailed error messages.', price: '$0.003', priceUsd: 0.003, path: '/api/v1/json-validator', param: 'json', paramLabel: 'JSON to validate', example: '{"name": "Joyhavn", "network": "solana", "services": [1, 2, 3],}', maxLen: 2000 },
];

/* ---------------- state ---------------- */
const state = { config: null, services: [], query: '', route: 'home', health: null, apiDown: false, wallet: walletSnap(), bal: null };
const KEY = 'joyhavn.history.v1';
const SEEN = 'joyhavn.seen.v1';
let memHistory = [];
const store = {
  get(k, fb) {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : fb;
    } catch {
      return k === KEY ? memHistory : fb;
    }
  },
  set(k, v) {
    if (k === KEY) memHistory = v;
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* private mode: keep in memory only */
    }
  },
};
const history = () => store.get(KEY, []);
const addHistory = (e) => store.set(KEY, [{ at: new Date().toISOString(), ...e }, ...history()].slice(0, 100));

function totals() {
  const h = history();
  const paid = h.filter((e) => e.status === 'paid');
  const failed = h.filter((e) => e.status === 'failed');
  return {
    spent: paid.reduce((n, e) => n + (e.priceUsd || 0), 0),
    requests: h.length,
    paid: paid.length,
    failed: failed.length,
    rate: h.length ? (paid.length / h.length) * 100 : null,
  };
}

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || res.statusText || 'Request failed'), { status: res.status });
  return body;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2600);
}

const txLink = (sig) =>
  sig ? `<a class="mono" target="_blank" rel="noopener" href="https://explorer.solana.com/tx/${esc(sig)}?cluster=devnet">${esc(short(sig, 6))} ↗</a>` : '<span class="muted">pending</span>';
const addrLink = (a) =>
  a ? `<a class="mono" target="_blank" rel="noopener" href="https://explorer.solana.com/address/${esc(a)}?cluster=devnet">${esc(a)}</a>` : '<span class="muted">not set</span>';

/* ---------------- chrome (sidebar, status) ---------------- */
const NAV = [
  ['home', 'Home', 'home'],
  ['services', 'Services', 'grid'],
  ['activity', 'Activity', 'clock'],
  ['wallet', 'Wallet', 'wallet'],
  ['agent', 'Agent', 'bolt'],
  ['developers', 'Developers', 'code'],
  ['analytics', 'Analytics', 'chart'],
  ['settings', 'Settings', 'gear'],
];

function paintChrome() {
  $('#nav').innerHTML = NAV.map(([id, label, ic]) => `<a href="#/${id}" data-route="${id}" ${state.route === id ? 'aria-current="page"' : ''} class="${state.route === id ? 'active' : ''}">${svg(ic)}${label}</a>`).join('');
  const c = state.config;
  const ok = Boolean(c?.configured);
  $('#net-dot').className = `dot ${ok ? 'on' : ''}`;
  $('#net-name').textContent = c?.networkName ? c.networkName.replace('Devnet', 'Network') : 'Solana Network';
  const badge = $('#net-badge');
  badge.textContent = ok ? 'Connected' : 'Setup needed';
  badge.className = `badge ${ok ? '' : 'off'}`;
  const w = state.wallet;
  $('#net-wallet').innerHTML = w.connected
    ? `<span class="chain">${w.icon ? `<img src="${esc(w.icon)}" alt="" />` : svg('sol')}</span><span><b class="wname">${esc(w.name)}</b><br><span class="mono">${esc(short(w.address))}</span></span><button class="copy" data-copy="${esc(w.address)}" aria-label="Copy wallet address">${svg('copy')}</button>`
    : `<button class="btn lime sm full" data-connect>${svg('wallet')}Connect wallet</button>`;
  $('#who-name').textContent = w.connected ? w.name : 'Guest';
  $('#who-addr').textContent = w.connected ? short(w.address, 4) : 'not connected';
  $('#avatar').innerHTML = w.connected && w.icon ? `<img src="${esc(w.icon)}" alt="" />` : w.connected ? esc(w.name[0]) : 'G';
  paintWalletSlot();
  const h = history();
  $('#ping').hidden = !(h[0] && h[0].at > store.get(SEEN, ''));
}

/* ---------------- wallet UI ---------------- */
function paintWalletSlot() {
  const w = state.wallet;
  const slot = $('#wallet-slot');
  if (!slot) return;
  slot.innerHTML = w.connected
    ? `<button class="wallet-pill" data-wallet-menu aria-label="Wallet menu"><span class="wp-dot"></span>${w.icon ? `<img src="${esc(w.icon)}" alt="" />` : ''}<span class="mono">${esc(short(w.address, 4))}</span><b>${state.bal ? `${nf(state.bal.usdc, { maximumFractionDigits: 3 })} USDC` : '…'}</b></button>`
    : `<button class="btn lime sm" data-connect>${svg('wallet')}<span class="hide-sm">Connect wallet</span><span class="show-sm">Connect</span></button>`;
}

async function refreshBalance() {
  const w = state.wallet;
  if (!w.connected) {
    state.bal = null;
    return paintWalletSlot();
  }
  try {
    state.bal = await api(`/api/wallet/${w.address}`);
  } catch {
    state.bal = null;
  }
  paintWalletSlot();
  if (state.route === 'wallet') fillWallet();
  if (state.route === 'developers') fillEarnings();
  if (state.route === 'agent') fillAgent();
  if (state.route === 'home') fillSolana();
}

function openConnect() {
  const dlg = $('#connect');
  const list = walletSnap().wallets;
  const mobile = isMobile();
  const installs = [
    ['Phantom', 'https://phantom.app/download'],
    ['Solflare', 'https://solflare.com/download'],
    ['Backpack', 'https://backpack.app/downloads'],
  ];
  dlg.innerHTML = `
    <div class="run-wrap">
      <div class="run-head"><div class="ico">${svg('wallet')}</div><div class="grow"><h2 id="connect-title">Connect a wallet</h2><p>Approve in your own wallet. We never see your keys.</p></div><button class="icon-btn" data-close-connect aria-label="Close">✕</button></div>
      <div class="run-body">
        ${list.length ? `<div class="wlist">${list.map((x) => `<button class="wopt" data-pick="${esc(x.name)}">${x.icon ? `<img src="${esc(x.icon)}" alt="" />` : `<span class="chain">${svg('wallet')}</span>`}<span>${esc(x.name)}</span><small>Detected</small></button>`).join('')}</div>` : `
          <div class="callout"><b>No Solana wallet detected in this browser.</b> ${mobile ? 'Open this page inside your wallet app, or install one.' : 'Install a wallet extension, then reload this page.'}</div>`}
        ${mobile ? `<div class="wlist"><a class="wopt" href="${esc(phantomDeepLink())}"><span class="chain">${svg('link')}</span><span>Open in Phantom app</span><small>Opens this page in Phantom</small></a><a class="wopt" href="${esc(solflareDeepLink())}"><span class="chain">${svg('link')}</span><span>Open in Solflare app</span><small>Opens this page in Solflare</small></a></div>` : ''}
        ${list.length ? '' : `<div class="wlist">${installs.map(([n, u]) => `<a class="wopt" target="_blank" rel="noopener" href="${u}"><span class="chain">${svg('arrow')}</span><span>Get ${n}</span><small>Install</small></a>`).join('')}</div>`}
        <p class="note">Joyhavn runs on <b>Solana devnet</b> with test USDC. In Phantom, turn on <i>Settings → Developer Settings → Testnet Mode</i> so it can sign devnet transactions. Free test USDC: <a target="_blank" rel="noopener" href="https://faucet.circle.com">faucet.circle.com</a>.</p>
        <div id="connect-err"></div>
      </div>
    </div>`;
  if (!dlg.open) dlg.showModal();
}

async function doConnect(name) {
  const errBox = $('#connect-err');
  try {
    await connectWallet(name);
    $('#connect').close();
    toast(`Connected to ${name}`);
  } catch (err) {
    if (errBox) errBox.innerHTML = `<div class="callout"><b>Could not connect.</b> ${esc(err.message || 'Request was cancelled.')}</div>`;
  }
}

function walletMenu() {
  const w = state.wallet;
  const dlg = $('#connect');
  dlg.innerHTML = `
    <div class="run-wrap">
      <div class="run-head"><div class="chain big">${w.icon ? `<img src="${esc(w.icon)}" alt="" />` : svg('wallet')}</div><div class="grow"><h2 id="connect-title">${esc(w.name)}</h2><p class="mono">${esc(short(w.address, 8))}</p></div><button class="icon-btn" data-close-connect aria-label="Close">✕</button></div>
      <div class="run-body">
        <div class="grid-2">
          <div class="card bal"><div class="label">USDC (devnet)</div><div class="value">${state.bal ? nf(state.bal.usdc, { maximumFractionDigits: 4 }) : '–'}</div></div>
          <div class="card bal"><div class="label">SOL (devnet)</div><div class="value">${state.bal ? nf(state.bal.sol, { maximumFractionDigits: 4 }) : '–'}</div></div>
        </div>
        <div class="actions">
          <button class="btn ghost" data-copy="${esc(w.address)}">${svg('copy')}Copy address</button>
          <a class="btn ghost" target="_blank" rel="noopener" href="https://explorer.solana.com/address/${esc(w.address)}?cluster=devnet">Explorer ↗</a>
          <a class="btn ghost" target="_blank" rel="noopener" href="https://faucet.circle.com">Get test USDC ↗</a>
        </div>
        <div class="actions"><button class="btn danger" data-disconnect>Disconnect</button></div>
      </div>
    </div>`;
  dlg.showModal();
}

/* ---------------- setup checklist ---------------- */
function setupBanner() {
  const h = state.health;
  if (state.apiDown) {
    return '<div class="callout"><b>The Joyhavn API is not reachable.</b> Showing the built-in catalogue. On Vercel, open the project’s Functions logs, make sure <code>api/index.js</code> deployed, and that the repository root is the project root.</div>';
  }
  if (!state.config?.configured) {
    return '<div class="callout"><b>Server setup needed.</b> Add <code>SOLANA_PAY_TO</code> (the wallet that receives payments) in Vercel → Settings → Environment Variables, then redeploy. Until then, services cannot take payments.</div>';
  }
  if (h && h.checks && h.checks.facilitator === false) {
    return '<div class="callout"><b>Payment facilitator unreachable.</b> The x402 facilitator did not respond, so payments may fail. Check <code>FACILITATOR_URL</code>.</div>';
  }
  return '';
}

/* ---------------- shared pieces ---------------- */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function statsHtml() {
  const t = totals();
  const cards = [
    ['wallet', 'Total Spent', usd(t.spent), `<b>${t.paid}</b> settled payment${t.paid === 1 ? '' : 's'} (USDC)`],
    ['bolt', 'Requests Made', nf(t.requests), t.requests ? `<b>${t.paid}</b> unlocked, ${t.failed} rejected` : 'on this device'],
    ['grid', 'Active Services', state.services.length, 'all live on Solana devnet'],
    ['check', 'Success Rate', t.rate === null ? '–' : `${t.rate.toFixed(1)}%`, t.rate === null ? 'run a service to see this' : 'paid vs rejected'],
  ];
  return cards.map(([ic, label, value, hint]) => `<div class="card stat"><div class="ico">${svg(ic)}</div><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`).join('');
}

const svcCard = (s) => `
  <article class="svc">
    <div class="svc-top">
      <div class="ico">${svg(s.icon)}</div>
      <div><h3>${esc(s.name)}</h3><p>${esc(s.description)}</p></div>
    </div>
    <div class="svc-foot">
      <div class="price"><span class="coin">$</span><span>${esc(s.price)} <small>USDC</small></span></div>
      <button class="btn lime sm" data-run="${esc(s.id)}">Pay &amp; Run</button>
    </div>
  </article>`;

function activityList(entries) {
  if (!entries.length) return '<div class="empty"><b>No activity yet</b>Run a service and it shows up here.</div>';
  return `<ul class="act">${entries
    .map((e) => {
      const s = state.services.find((x) => x.id === e.service);
      return `<li>
        <div class="ico" style="width:46px;height:46px">${svg(s?.icon || 'bolt')}</div>
        <div><div class="t">${esc(e.name || s?.name || e.service)}</div><div class="d">${e.status === 'paid' ? 'Unlocked 1 request' : 'Payment rejected'}</div></div>
        <div class="when"><span>${esc(ago(e.at))}</span><b>${usd(e.priceUsd)} USDC</b></div>
        <span class="pill ${e.status === 'paid' ? 'ok' : 'bad'}">${e.status === 'paid' ? 'Success' : 'Failed'}</span>
      </li>`;
    })
    .join('')}</ul>`;
}

/* ---------------- pages ---------------- */
function solanaPanel() {
  return `
    <section class="card panel solana" aria-labelledby="why-sol">
      <div class="panel-head"><div><h2 id="why-sol">Solana is the access control</h2><p>There are no accounts or API keys here. A service unlocks only when a USDC transfer settles on Solana.</p></div><span class="live"><i></i>Live on devnet</span></div>
      <div class="sol-grid">
        <div class="sol-fact"><b id="sol-slot">–</b><span>current slot</span></div>
        <div class="sol-fact"><b id="sol-tps">–</b><span>transactions / sec</span></div>
        <div class="sol-fact"><b id="sol-time">–</b><span>average slot time</span></div>
        <div class="sol-fact"><b>$0.0008</b><span>base fee, paid by the facilitator, not you</span></div>
      </div>
      <ol class="sol-how">
        <li><b>402 Payment Required</b> The server answers with the price in USDC and the merchant’s Solana address.</li>
        <li><b>You sign a USDC transfer</b> Your own wallet signs an SPL-token transfer. No key ever leaves it.</li>
        <li><b>Settled on-chain</b> The facilitator verifies it, pays the fee and lands it on Solana in about a second.</li>
        <li><b>Result unlocked</b> The response carries the transaction signature, so every request has a public receipt.</li>
      </ol>
      <p class="note">Why not cards? A $0.005 request costs more in card fees than it earns. On Solana the fee is a fraction of a cent, so pay-per-request becomes viable.</p>
    </section>`;
}

async function fillSolana() {
  if (!$('#sol-slot')) return;
  try {
    const st = await api('/api/solana/stats');
    if (!$('#sol-slot')) return;
    $('#sol-slot').textContent = nf(st.slot);
    $('#sol-tps').textContent = st.tps == null ? '–' : nf(st.tps);
    $('#sol-time').textContent = st.slotTimeMs == null ? '–' : `${st.slotTimeMs} ms`;
  } catch {
    /* leave dashes */
  }
}

function pageHome() {
  const h = history().slice(0, 5);
  return `
    <div class="page-head">
      <div><h1>${greeting()}${state.wallet.connected ? '' : ', builder'}</h1><p class="sub">Pay for tools only when you need them.</p></div>
      ${state.wallet.connected ? '<a class="btn lime" href="#/wallet">' + svg('wallet') + 'My Wallet</a>' : '<button class="btn lime" data-connect>' + svg('wallet') + 'Connect Wallet</button>'}
    </div>
    ${setupBanner()}
    <section class="stats">${statsHtml()}</section>
    ${solanaPanel()}
    <div class="two">
      <section class="card panel">
        <div class="panel-head"><div><h2>Explore Services</h2><p>Choose a service, pay with USDC on Solana, and get results instantly.</p></div><a class="more" href="#/services">View all services ${svg('arrow')}</a></div>
        <div class="svc-grid">${state.services.map(svcCard).join('')}</div>
      </section>
      <section class="card panel">
        <div class="panel-head"><h2>Recent Activity</h2><a class="more" href="#/activity">View all ${svg('arrow')}</a></div>
        ${activityList(h)}
      </section>
    </div>`;
}

function pageServices() {
  const q = state.query.trim().toLowerCase();
  const list = q ? state.services.filter((s) => `${s.name} ${s.description} ${s.category}`.toLowerCase().includes(q)) : state.services;
  return `
    <div class="page-head"><div><h1>Services</h1><p class="sub">${q ? `${list.length} result${list.length === 1 ? '' : 's'} for “${esc(state.query.trim())}”` : 'Every tool is priced per request. No subscription.'}</p></div></div>
    ${setupBanner()}
    <div class="svc-grid" style="grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))">${list.map(svcCard).join('') || '<div class="card empty"><b>No services match</b>Try “url”, “json” or “market”.</div>'}</div>
    <div class="card panel" style="margin-top:22px">
      <h2 style="margin-bottom:12px">Call a service from your own code</h2>
      <p class="note" style="margin-bottom:12px">Any x402 client can pay and call these endpoints directly. The 402 response tells the client the price.</p>
      <pre class="json">${esc(`import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";

const client = new x402Client();
client.register("solana:*", new ExactSvmScheme(yourSigner));
const pay = wrapFetchWithPayment(fetch, client);

const res = await pay("${location.origin}/api/v1/data-snapshot?asset=solana");
console.log(await res.json());`)}</pre>
    </div>`;
}

function pageActivity() {
  const h = history();
  const rows = h
    .map((e) => {
      const s = state.services.find((x) => x.id === e.service);
      return `<tr><td>${esc(new Date(e.at).toLocaleString())}</td><td>${esc(e.name || s?.name || e.service)}</td><td><span class="pill ${e.status === 'paid' ? 'ok' : 'bad'}">${e.status === 'paid' ? 'Success' : 'Failed'}</span></td><td class="num">${e.status === 'paid' ? usd(e.priceUsd) : '–'}</td><td>${e.status === 'paid' ? txLink(e.transaction) : ''}</td></tr>`;
    })
    .join('');
  return `
    <div class="page-head"><div><h1>Activity</h1><p class="sub">Your payments and results on this device.</p></div>${h.length ? '<button class="btn ghost" data-clear>Clear history</button>' : ''}</div>
    <section class="stats">${statsHtml()}</section>
    <div class="card panel table-wrap">${rows ? `<table><thead><tr><th>Time</th><th>Service</th><th>Status</th><th class="num">Amount</th><th>Transaction</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty"><b>No activity yet</b>Run a service from Home or Services.</div>'}</div>
    <p class="note" style="margin-top:12px">History is stored in this browser only. Settled payments link to their transaction on Solana Explorer.</p>`;
}

function pageWallet() {
  const w = state.wallet;
  if (!w.connected) {
    return `
      <div class="page-head"><div><h1>Wallet</h1><p class="sub">Connect your Solana wallet to pay for services.</p></div></div>
      <div class="card panel hero-connect">
        <div class="ico big">${svg('wallet')}</div>
        <h2>Pay from your own wallet</h2>
        <p class="note">Phantom, Solflare and Backpack are supported. You approve every payment in your wallet. Joyhavn never holds your funds or keys.</p>
        <div class="actions"><button class="btn lime" data-connect>${svg('wallet')}Connect wallet</button></div>
      </div>
      <div id="wallet-body"></div>`;
  }
  return `
    <div class="page-head"><div><h1>Wallet</h1><p class="sub">${esc(w.name)} · ${esc(short(w.address, 6))}</p></div><div class="actions"><button class="btn ghost" data-refresh-wallet>Refresh balances</button><button class="btn danger" data-disconnect>Disconnect</button></div></div>
    <div id="wallet-body"><div class="loading">Reading balances from Solana devnet…</div></div>`;
}

async function fillWallet() {
  const el = $('#wallet-body');
  const w = state.wallet;
  if (!el || !w.connected) return;
  let mer = null;
  try {
    const x = await api('/api/wallet');
    mer = x.merchantBalances;
  } catch {
    /* optional */
  }
  if (!el.isConnected) return;
  const b = state.bal;
  const low = b && b.usdc < 0.05;
  el.innerHTML = `
    ${!b ? '<div class="callout"><b>Could not read balances.</b> The Solana devnet RPC may be busy. Press Refresh in a moment.</div>' : ''}
    ${low ? '<div class="callout"><b>You need devnet USDC to pay.</b> Get free test USDC at <a target="_blank" rel="noopener" href="https://faucet.circle.com">faucet.circle.com</a>: choose <i>Solana</i>, <i>Devnet</i>, <i>USDC</i>, paste your address below, then press Refresh.</div>' : ''}
    <div class="grid-3">
      <div class="card bal"><div class="label">Your USDC</div><div class="value">${b ? nf(b.usdc, { maximumFractionDigits: 4 }) : '–'}</div><div class="note">pays for requests</div></div>
      <div class="card bal"><div class="label">Your SOL</div><div class="value">${b ? nf(b.sol, { maximumFractionDigits: 4 }) : '–'}</div><div class="note">not needed: the facilitator pays network fees</div></div>
      <div class="card bal"><div class="label">Merchant USDC received</div><div class="value">${mer ? nf(mer.usdc, { maximumFractionDigits: 4 }) : '–'}</div><div class="note">what Joyhavn services have earned</div></div>
    </div>
    <div class="card panel"><dl class="kv">
      <dt>Wallet</dt><dd>${addrLink(w.address)} <button class="copy" style="display:inline-grid;vertical-align:middle" data-copy="${esc(w.address)}" aria-label="Copy">${svg('copy')}</button></dd>
      <dt>Network</dt><dd>Solana Devnet (test money only)</dd>
      <dt>Token</dt><dd>USDC <span class="mono muted">4zMM…ncDU</span></dd>
    </dl>
    <p class="note" style="margin-top:16px">Each payment is a USDC transfer you sign. The maximum Joyhavn will ever ask for in one request is 0.05 USDC.</p></div>`;
}

const AGENT_EXAMPLE = 'Is https://phantom-airdrop-claim.secure-verify.xyz/connect-wallet safe, and what is SOL doing today?';
const agentState = { wallet: null, bal: null, supported: true, running: false };

function pageAgent() {
  return `
    <div class="page-head"><div><h1>Agent</h1><p class="sub">Give it a task. It buys the tools it needs, paying with its own wallet on Solana.</p></div></div>
    ${setupBanner()}
    <div id="agent-body"><div class="loading">Preparing the agent…</div></div>`;
}

async function fillAgent() {
  const el = $('#agent-body');
  if (!el) return;
  agentState.supported = await agentSupported();
  agentState.wallet = agentState.supported ? await getAgentWallet() : null;
  agentState.bal = null;
  if (agentState.wallet) {
    try {
      agentState.bal = await api(`/api/wallet/${agentState.wallet.address}`);
    } catch {
      /* shown as – */
    }
  }
  if (!el.isConnected) return;
  paintAgent();
}

function paintAgent() {
  const el = $('#agent-body');
  if (!el) return;
  const w = agentState.wallet;
  const b = agentState.bal;
  if (!agentState.supported) {
    el.innerHTML = '<div class="callout"><b>This browser cannot create the agent wallet.</b> Open Joyhavn in an up-to-date Safari (17+), Chrome or Edge and try again.</div>';
    return;
  }
  if (!w) {
    el.innerHTML = `<div class="card panel hero-connect"><div class="ico big">${svg('bolt')}</div><h2>Create the agent’s wallet</h2>
      <p class="note">A small throwaway Solana wallet is created in this browser, for test money only. You fund it with free devnet USDC, and the agent spends from it by itself, capped per task. No key ever leaves your device.</p>
      <div class="actions"><button class="btn lime" data-agent-create>${svg('bolt')}Create agent wallet</button></div></div>`;
    return;
  }
  const funded = b && b.usdc >= 0.01;
  el.innerHTML = `
    <section class="card panel">
      <div class="panel-head"><div><h2>Agent wallet</h2><p>The agent pays from this wallet. Fund it with test USDC, no pasting into Joyhavn needed.</p></div><span class="live"><i></i>Devnet</span></div>
      <div class="grid-3">
        <div class="card bal"><div class="label">Agent USDC</div><div class="value">${b ? nf(b.usdc, { maximumFractionDigits: 4 }) : '–'}</div><div class="note">its spending money</div></div>
        <div class="card bal"><div class="label">Spending cap per task</div><div class="value"><input id="agent-cap" class="cap" type="number" min="0.003" max="0.2" step="0.005" value="0.05" aria-label="Spending cap in USDC" /></div><div class="note">USDC, enforced before it buys</div></div>
        <div class="card bal"><div class="label">Address</div><div class="mono small">${esc(short(w.address, 8))}</div><div class="actions" style="margin-top:8px"><button class="btn ghost sm" data-copy="${esc(w.address)}">${svg('copy')}Copy</button><a class="btn ghost sm" target="_blank" rel="noopener" href="https://faucet.circle.com">Get USDC ↗</a></div></div>
      </div>
      ${funded ? '' : `<div class="callout"><b>The agent has no USDC yet.</b> Copy its address, open <a target="_blank" rel="noopener" href="https://faucet.circle.com">faucet.circle.com</a> (Solana, Devnet, USDC), paste the address and send. Then press Refresh.</div>`}
      <div class="actions"><button class="btn ghost sm" data-agent-refresh>Refresh balance</button><button class="btn danger sm" data-agent-reset>Discard wallet</button></div>
    </section>
    <section class="card panel" style="margin-top:22px">
      <h2 style="margin-bottom:10px">Task</h2>
      <label class="field">What should the agent find out?<textarea id="agent-task" rows="3" maxlength="4000">${esc(AGENT_EXAMPLE)}</textarea></label>
      <div class="actions" style="margin-top:12px"><button class="btn lime" data-agent-run ${funded ? '' : 'disabled'}>${svg('bolt')}Run agent</button></div>
      <div class="flow" id="agent-flow" hidden></div>
    </section>`;
}

async function runAgent() {
  if (agentState.running) return;
  const task = $('#agent-task').value.trim();
  const cap = Math.max(0.003, Math.min(0.2, Number($('#agent-cap').value) || 0.05));
  const flow = $('#agent-flow');
  const btn = $('[data-agent-run]');
  const rows = [];
  const paint = (extra = '') => {
    flow.hidden = false;
    flow.innerHTML = rows.map((r, i) => `<div class="step ${r.status}"><div class="n">${r.status === 'done' ? '✓' : r.status === 'error' ? '✕' : i + 1}</div><div><div class="t">${esc(r.title)}</div><div class="d">${r.html || ''}</div></div></div>`).join('') + extra;
  };
  agentState.running = true;
  btn.disabled = true;
  rows.push({ status: 'active', title: 'Planning', html: 'Deciding which tools to buy…' });
  paint();
  try {
    const plan = await api('/api/agent/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task }) });
    if (!plan.steps.length) {
      rows[0] = { status: 'error', title: 'Planning', html: 'None of the tools fit this task. Try mentioning a link, a coin (like SOL), some JSON, or text to summarise.' };
      return paint();
    }
    // Spending cap: buy in order until the next tool would break the cap.
    const priced = plan.steps.map((st) => ({ ...st, svc: state.services.find((x) => x.id === st.service) })).filter((st) => st.svc);
    let spent = 0;
    const buy = [];
    const skipped = [];
    for (const st of priced) (spent + st.svc.priceUsd <= cap + 1e-9 ? (buy.push(st), (spent += st.svc.priceUsd)) : skipped.push(st));
    rows[0] = { status: 'done', title: 'Planning', html: `${buy.length} tool${buy.length === 1 ? '' : 's'} to buy for <b>${usd(spent)}</b> (cap ${usd(cap)}). Planned by ${plan.engine === 'claude' ? 'Claude' : 'keyword rules'}.${skipped.length ? ` <span class="err">Skipped ${skipped.length} to stay under the cap.</span>` : ''}` };
    paint();

    const results = [];
    let totalPaid = 0;
    for (const st of buy) {
      const i = rows.push({ status: 'active', title: `Buy: ${st.svc.name} (${st.svc.price})`, html: esc(st.why) }) - 1;
      paint();
      const url = new URL(st.svc.path, location.origin);
      url.searchParams.set(st.svc.param, st.input);
      try {
        const out = await payWithWallet({ url: url.toString(), payer: agentState.wallet.address, sign: agentSign, onStep: () => {} });
        const sig = out.settlement.transaction;
        results.push({ service: st.service, result: out.result.result });
        totalPaid += st.svc.priceUsd;
        addHistory({ service: st.service, name: `Agent: ${st.svc.name}`, status: 'paid', priceUsd: st.svc.priceUsd, transaction: sig, payer: agentState.wallet.address });
        rows[i] = { status: 'done', title: `Bought: ${st.svc.name} (${st.svc.price})`, html: `${esc(st.why)}<br>Receipt ${txLink(sig)}` };
      } catch (err) {
        rows[i] = { status: 'error', title: `Could not buy: ${st.svc.name}`, html: `<span class="err">${esc(err.message)}</span> Nothing was charged for this step.${err.needFunds ? ` ${FUNDS_HELP}` : ''}` };
      }
      paint();
    }
    if (!results.length) return;

    const k = rows.push({ status: 'active', title: 'Answer', html: 'Writing the answer from what it bought…' }) - 1;
    paint();
    let report;
    try {
      report = await api('/api/agent/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task, results }) });
    } catch {
      report = { answer: results.map((r) => JSON.stringify(r.result)).join('\n'), engine: 'raw' };
    }
    rows[k] = { status: 'done', title: 'Answer', html: `<div class="result"><p style="white-space:pre-wrap">${esc(report.answer)}</p><div class="chips"><span class="chip">Spent ${usd(totalPaid)} USDC</span><span class="chip">${results.length} on-chain receipt${results.length === 1 ? '' : 's'}</span><span class="chip">${report.engine === 'claude' ? 'Written by Claude' : 'Written from results'}</span></div></div>` };
    paint();
  } catch (err) {
    rows.push({ status: 'error', title: 'Agent stopped', html: `<span class="err">${esc(err.message)}</span>` });
    paint();
  } finally {
    agentState.running = false;
    btn.disabled = false;
    try {
      agentState.bal = await api(`/api/wallet/${agentState.wallet.address}`);
      const v = $('#agent-body .bal .value');
      if (v && agentState.bal) v.textContent = nf(agentState.bal.usdc, { maximumFractionDigits: 4 });
    } catch {
      /* ignore */
    }
  }
}

function pageDevelopers() {
  const c = state.config || {};
  const rows = state.services.map((s) => `<tr><td><b>${esc(s.name)}</b><div class="note">${esc(s.category)}</div></td><td class="mono">GET ${esc(s.path)}?${esc(s.param)}=</td><td class="num">${esc(s.price)}</td></tr>`).join('');
  return `
    <div class="page-head"><div><h1>Developers</h1><p class="sub">Publish an API, get paid per request in USDC. No billing system to build.</p></div></div>
    <section class="card panel"><div class="panel-head"><div><h2>Earnings, straight from Solana</h2><p>Read from the chain, not a database: every row is a real settled payment to the merchant wallet.</p></div><button class="btn ghost sm" data-refresh-earn>Refresh</button></div>
      <div id="earn-body"><div class="loading">Reading on-chain receipts…</div></div>
    </section>
    <section class="card panel" style="margin-top:22px"><div class="panel-head"><h2>Your paid endpoints</h2></div>
      <div class="table-wrap"><table><thead><tr><th>Service</th><th>Endpoint</th><th class="num">Price</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="note" style="margin-top:12px">Merchant wallet: ${addrLink(c.payTo)}</p>
    </section>
    <section class="card panel" style="margin-top:22px"><h2 style="margin-bottom:6px">Add your own paid endpoint</h2>
      <p class="note" style="margin-bottom:12px">Three lines of middleware turn any Express route into a Solana-priced API.</p>
      <pre class="json">${esc(`import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: "${c.facilitator || 'https://x402.org/facilitator'}" }))
  .register("${c.network || 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'}", new ExactSvmScheme());

app.use(paymentMiddleware({
  "GET /api/v1/my-tool": { accepts: [{ scheme: "exact", price: "$0.002", network: "${c.network || 'solana:…'}", payTo: "<your wallet>" }] },
}, server));`)}</pre>
    </section>`;
}

async function fillEarnings() {
  const el = $('#earn-body');
  if (!el) return;
  try {
    const e = await api('/api/earnings');
    if (!el.isConnected) return;
    el.innerHTML = `
      <div class="grid-3" style="margin-bottom:16px"><div class="card bal"><div class="label">Recent USDC received</div><div class="value">${nf(e.totalUsdc, { maximumFractionDigits: 4 })}</div><div class="note">last ${e.receipts.length} settled payments</div></div></div>
      ${e.receipts.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Payer</th><th class="num">Amount</th><th>Transaction</th></tr></thead><tbody>${e.receipts.map((r) => `<tr><td>${esc(r.blockTime ? new Date(r.blockTime).toLocaleString() : '–')}</td><td class="mono">${esc(short(r.payer || '', 4))}</td><td class="num">${usd(r.amountUsdc)}</td><td>${txLink(r.signature)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><b>No payments yet</b>Run a service and the receipt appears here within seconds.</div>'}`;
  } catch (err) {
    if (el.isConnected) el.innerHTML = `<div class="callout"><b>Could not read receipts.</b> ${esc(err.message)}</div>`;
  }
}

function pageAnalytics() {
  const h = history();
  const per = state.services.map((s) => {
    const rows = h.filter((e) => e.service === s.id);
    const paid = rows.filter((e) => e.status === 'paid');
    return { s, paid: paid.length, failed: rows.length - paid.length, spend: paid.reduce((n, e) => n + (e.priceUsd || 0), 0) };
  });
  const maxPaid = Math.max(1, ...per.map((p) => p.paid));
  const days = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (6 - i));
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    const spend = h.filter((e) => e.status === 'paid' && new Date(e.at) >= d && new Date(e.at) < next).reduce((n, e) => n + (e.priceUsd || 0), 0);
    return { label: d.toLocaleDateString('en-US', { weekday: 'short' }), spend };
  });
  const maxDay = Math.max(0.001, ...days.map((d) => d.spend));
  return `
    <div class="page-head"><div><h1>Analytics</h1><p class="sub">Where your requests and spend go.</p></div></div>
    <section class="stats">${statsHtml()}</section>
    <div class="stack">
      <section class="card panel"><div class="panel-head"><h2>Spend, last 7 days</h2></div>
        <div class="cols">${days.map((d) => `<div class="col"><b>${d.spend ? usd(d.spend) : ''}</b><div class="stick ${d.spend ? '' : 'zero'}" style="height:${d.spend ? Math.max(6, (d.spend / maxDay) * 100) : 0}%"></div><span>${esc(d.label)}</span></div>`).join('')}</div>
      </section>
      <section class="card panel"><div class="panel-head"><h2>Requests by service</h2></div>
        <div class="bars">${per.map((p) => `<div class="bar-row"><span>${esc(p.s.name)}</span><div class="bar" title="${p.paid} settled, ${p.failed} rejected"><span style="width:${(p.paid / maxPaid) * 100}%"></span></div><span class="note">${p.paid} paid · ${usd(p.spend)}</span></div>`).join('')}</div>
      </section>
    </div>
    <p class="note" style="margin-top:12px">Based on payments made from this browser.</p>`;
}

function pageSettings() {
  const c = state.config || {};
  return `
    <div class="page-head"><div><h1>Settings</h1><p class="sub">How Joyhavn is wired to Solana.</p></div></div>
    <div class="stack">
      <section class="card panel"><div class="panel-head"><h2>Payments</h2></div><dl class="kv">
        <dt>Network</dt><dd>${esc(c.networkName || 'Solana Devnet')} <span class="mono muted">${esc(c.network || '')}</span></dd>
        <dt>Protocol</dt><dd>x402 v2, scheme <span class="mono">${esc(c.scheme || 'exact')}</span>, paid in ${esc(c.asset || 'USDC')}</dd>
        <dt>Facilitator</dt><dd>${esc(c.facilitator || '')}</dd>
        <dt>Merchant wallet</dt><dd>${addrLink(c.payTo)}</dd>
        <dt>AI Summary engine</dt><dd>${c.aiEngine === 'claude' ? 'Claude' : 'Local summariser (set ANTHROPIC_API_KEY to use Claude)'}</dd>
        <dt>Status</dt><dd>${c.configured ? 'Configured' : '<span class="err">Not configured: set SOLANA_PAY_TO</span>'}</dd>
        <dt>Facilitator reachable</dt><dd>${state.health?.checks?.facilitator == null ? '–' : state.health.checks.facilitator ? 'Yes' : '<span class="err">No</span>'}</dd>
        <dt>Instant demo wallet</dt><dd>${state.health?.checks?.demoWallet ? 'Enabled (server-side, devnet only)' : 'Not configured (optional)'}</dd>
      </dl></section>
      <section class="card panel"><div class="panel-head"><h2>This device</h2></div>
        <p class="note" style="margin-bottom:14px">Your activity and analytics are kept in this browser's local storage. Nothing about you is stored on the server.</p>
        <div class="actions"><button class="btn danger" data-clear>Clear activity history</button></div>
      </section>
    </div>`;
}

const PAGES = { home: pageHome, services: pageServices, activity: pageActivity, wallet: pageWallet, agent: pageAgent, developers: pageDevelopers, analytics: pageAnalytics, settings: pageSettings };
const TITLES = { home: 'Home', services: 'Services', activity: 'Activity', wallet: 'Wallet', agent: 'Agent', developers: 'Developers', analytics: 'Analytics', settings: 'Settings' };

function render() {
  state.route = (location.hash.replace(/^#\//, '').split(/[?/]/)[0] || 'home').toLowerCase();
  if (!PAGES[state.route]) state.route = 'home';
  document.title = `${TITLES[state.route]} · Joyhavn`;
  $('#content').innerHTML = PAGES[state.route]();
  paintChrome();
  if (state.route === 'wallet') fillWallet();
}

/* ---------------- run dialog ---------------- */
const STEP_TITLES = ['Request the service', 'Payment required (HTTP 402)', 'Sign, verify and settle on Solana', 'Result unlocked'];
const num = (n, o) => (n === null || n === undefined ? '–' : nf(n, o));
const money = (n) => (n === null || n === undefined ? '–' : `$${nf(n, { maximumFractionDigits: n < 1 ? 4 : 2 })}`);
const pct = (n) => (n === null || n === undefined ? '–' : `${n > 0 ? '+' : ''}${n}%`);

function renderResult(id, payload) {
  const r = payload?.result ?? payload;
  let body = '';
  if (id === 'url-safety-scan') {
    const cls = r.level === 'high' ? 'bad' : r.level === 'medium' ? 'warn' : 'good';
    body = `<div class="headline ${cls}">${esc(String(r.level).toUpperCase())} risk · score ${esc(r.score)}/100</div><p>${esc(r.verdict)}</p>${r.flags?.length ? `<ul>${r.flags.map((f) => `<li>${esc(f.detail)}</li>`).join('')}</ul>` : ''}<p class="note">${esc(r.method)}</p>`;
  } else if (id === 'ai-summary') {
    body = `<p>${esc(r.summary)}</p><div class="chips"><span class="chip">${esc(r.engine === 'claude' ? 'Claude' : 'Local summariser')}</span><span class="chip">${esc(r.originalWords)} → ${esc(r.summaryWords)} words</span></div>${r.note ? `<p class="note">${esc(r.note)}</p>` : ''}`;
  } else if (id === 'data-snapshot') {
    const up = (r.change24hPct ?? 0) >= 0;
    body = `<div class="headline">${esc(r.asset.name)} (${esc(r.asset.symbol)}) · ${money(r.priceUsd)}</div><div class="chips"><span class="chip" style="color:${up ? 'var(--green)' : 'var(--red)'}">24h ${pct(r.change24hPct)}</span><span class="chip">7d ${pct(r.change7dPct)}</span>${r.asset.marketCapRank ? `<span class="chip">Rank #${esc(r.asset.marketCapRank)}</span>` : ''}</div><ul><li>24h high ${money(r.high24hUsd)} · low ${money(r.low24hUsd)}</li><li>Market cap ${money(r.marketCapUsd)}</li><li>24h volume ${money(r.volume24hUsd)}</li></ul><p class="note">Source: ${esc(r.source)} · as of ${esc(r.asOf ? new Date(r.asOf).toLocaleTimeString() : 'now')}</p>`;
  } else if (id === 'json-validator') {
    body = r.valid
      ? `<div class="headline good">Valid JSON</div><div class="chips"><span class="chip">${esc(r.type)}</span><span class="chip">${esc(r.totalKeys)} keys</span><span class="chip">depth ${esc(r.depth)}</span><span class="chip">${esc(r.bytes)} bytes</span></div><pre class="json">${esc(r.formatted)}</pre>`
      : `<div class="headline bad">Invalid JSON</div><p>${esc(r.error)}</p>${r.line ? `<div class="chips"><span class="chip">line ${esc(r.line)}, column ${esc(r.column)}</span><span class="chip">near ${esc(JSON.stringify(r.character))}</span></div>` : ''}`;
  }
  return `<div class="result">${body}<details><summary>Raw response</summary><pre class="json">${esc(JSON.stringify(payload, null, 2))}</pre></details></div>`;
}

function stepsHtml(steps) {
  return steps
    .map((s, i) => `<div class="step ${s.status}"><div class="n">${s.status === 'done' ? '✓' : s.status === 'error' ? '✕' : i + 1}</div><div><div class="t">${esc(STEP_TITLES[i])}</div><div class="d">${s.html || ''}</div></div></div>`)
    .join('');
}

function openRun(id) {
  const s = state.services.find((x) => x.id === id);
  if (!s) return;
  const dlg = $('#run');
  dlg.dataset.id = id;
  dlg.innerHTML = `
    <div class="run-wrap">
      <div class="run-head"><div class="ico">${svg(s.icon)}</div><div class="grow"><h2 id="run-title">${esc(s.name)}</h2><p>${esc(s.description)}</p></div><button class="icon-btn" data-close aria-label="Close">✕</button></div>
      <div class="run-body">
        <label class="field">${esc(s.paramLabel)}<textarea id="run-input" rows="${s.id === 'ai-summary' ? 6 : s.id === 'data-snapshot' ? 1 : 3}" maxlength="${s.maxLen}" spellcheck="false">${esc(s.example)}</textarea></label>
        <div id="run-actions"></div>
        <p class="note">You are charged only if the input is valid and the payment settles on Solana. Test USDC on devnet.</p>
        <div class="flow" id="run-flow" hidden></div>
      </div>
    </div>`;
  paintRunActions();
  if (!dlg.open) dlg.showModal();
}

function paintRunActions() {
  const box = $('#run-actions');
  const dlg = $('#run');
  if (!box) return;
  const s = state.services.find((x) => x.id === dlg.dataset.id);
  if (!s) return;
  const w = state.wallet;
  const demoOk = state.health?.checks?.demoWallet;
  box.innerHTML = `<div class="actions">
    ${w.connected ? `<button class="btn lime" data-go-wallet>${svg('wallet')}Pay ${esc(s.price)} with ${esc(w.name)}</button>` : `<button class="btn lime" data-connect>${svg('wallet')}Connect wallet to pay</button>`}
    ${demoOk ? `<button class="btn ghost" data-go title="Pays from a server-side devnet wallet, no wallet needed">Quick demo (no wallet)</button>` : ''}
    <button class="btn ghost" data-fail title="Sends a forged payment to show how failures are handled">Simulate failed payment</button>
  </div>`;
}

const FUNDS_HELP = '<a target="_blank" rel="noopener" href="https://faucet.circle.com">Get free devnet USDC</a> (Solana, Devnet, USDC), then try again.';

async function runPay(kind) {
  const dlg = $('#run');
  const id = dlg.dataset.id;
  const s = state.services.find((x) => x.id === id);
  const input = $('#run-input').value;
  const flow = $('#run-flow');
  const btns = dlg.querySelectorAll('#run-actions button');
  btns.forEach((b) => (b.disabled = true));
  const steps = STEP_TITLES.map(() => ({ status: 'idle', html: '' }));
  const paint = () => {
    flow.hidden = false;
    flow.innerHTML = stepsHtml(steps);
  };
  const done = () => {
    btns.forEach((b) => (b.disabled = false));
    if (['home', 'activity', 'analytics'].includes(state.route)) {
      const y = window.scrollY;
      $('#content').innerHTML = PAGES[state.route]();
      window.scrollTo(0, y);
      if (state.route === 'home') fillSolana();
    }
    refreshBalance();
  };
  const record = (status, tx, payer) => {
    addHistory({ service: id, name: s.name, status, priceUsd: s.priceUsd, transaction: tx || null, payer: payer || null });
    paintChrome();
  };

  /* ---- real wallet payment, signed in the browser ---- */
  if (kind === 'wallet') {
    const url = new URL(s.path, location.origin);
    url.searchParams.set(s.param, input);
    const problem = (s.maxLen && input.length > s.maxLen) || !input.trim();
    if (problem) {
      steps[0] = { status: 'error', html: '<span class="err">Enter a valid input first.</span> You were not charged.' };
      paint();
      return done();
    }
    const onStep = (i, status, html) => {
      steps[i] = { status, html };
      if (status === 'done' && steps[i + 1] && steps[i + 1].status === 'idle') steps[i + 1] = { status: 'active', html: '' };
      paint();
    };
    try {
      const out = await payWithWallet({ url: url.toString(), payer: state.wallet.address, onStep });
      const sig = out.settlement.transaction;
      onStep(2, 'done', `Signed by <code>${esc(short(out.payer))}</code>. The facilitator verified it and settled on Solana. Transaction ${txLink(sig)}`);
      steps[3] = { status: 'done', html: `Unlocked in ${esc(out.timings.payAndUnlockMs)} ms.${renderResult(id, out.result)}` };
      paint();
      record('paid', sig, out.payer);
    } catch (err) {
      const e = err instanceof PayError ? err : new PayError('payment', err.message || 'Payment failed');
      const at = e.stage === 'request' ? 0 : 2;
      steps[at] = { status: 'error', html: `<span class="err">${esc(e.message)}</span>${e.needFunds ? ` ${FUNDS_HELP}` : ''}${e.stage === 'request' ? ' You were not charged.' : ''}` };
      if (at === 2) steps[3] = { status: 'error', html: 'No result was delivered and nothing was charged.' };
      paint();
      if (e.stage === 'payment') record('failed');
    }
    return done();
  }

  /* ---- server-side demo wallet (optional) ---- */
  steps[0] = { status: 'active', html: 'Calling the service…' };
  paint();
  let out;
  try {
    out = await api(`/api/demo/${kind}/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input }) });
  } catch (err) {
    steps[0] = { status: 'error', html: `<span class="err">${esc(err.message)}</span> You were not charged.` };
    paint();
    return done();
  }
  const step = async (i, status, html, delay = 320) => {
    steps[i] = { status, html };
    if (status === 'done' && steps[i + 1]) steps[i + 1] = { status: 'active', html: '' };
    paint();
    await sleep(delay);
  };
  if (kind === 'fail') {
    await step(0, 'done', 'Sent the request with a forged payment signature.');
    await step(1, 'done', 'Server answered <code>402 Payment Required</code>.');
    await step(2, 'error', `Rejected by verification (HTTP ${esc(out.status)}): ${esc(out.error)}`, 0);
    steps[3] = { status: 'error', html: 'Nothing was delivered and nothing was charged.' };
    paint();
    record('failed');
  } else if (out.stage === 'request') {
    await step(0, 'error', `<span class="err">${esc(out.error)}</span> You were not charged.`, 0);
  } else {
    const r = out.requirements;
    await step(0, 'done', `Called <code>${esc(s.path)}</code> with no payment.`);
    await step(1, 'done', r ? `Server asked for <strong>${esc(r.amountUsdc)} USDC</strong> on <code>${esc(short(r.network, 9))}</code> to <code>${esc(short(r.payTo))}</code> (scheme <code>${esc(r.scheme)}</code>).` : 'Payment requirements received.');
    if (!out.ok) {
      await step(2, 'error', `<span class="err">${esc(out.error)}</span>`, 0);
      steps[3] = { status: 'error', html: 'No result was delivered.' };
      paint();
      record('failed');
    } else {
      await step(2, 'done', `Demo wallet <code>${esc(short(out.payer))}</code> signed; the facilitator verified and settled. Transaction ${txLink(out.settlement.transaction)}`);
      await step(3, 'done', `Unlocked in ${esc(out.timings.payAndUnlockMs)} ms.${renderResult(id, out.result)}`, 0);
      record('paid', out.settlement.transaction, out.payer);
    }
  }
  done();
}

/* ---------------- events ---------------- */
document.addEventListener('click', async (e) => {
  const t = e.target;
  const run = t.closest('[data-run]');
  if (run) return openRun(run.dataset.run);
  if (t.closest('[data-go-wallet]')) return runPay('wallet');
  if (t.closest('[data-go]')) return runPay('pay');
  if (t.closest('[data-fail]')) return runPay('fail');
  if (t.closest('[data-connect]')) return openConnect();
  if (t.closest('[data-agent-create]')) {
    await createAgentWallet();
    return fillAgent();
  }
  if (t.closest('[data-agent-refresh]')) return fillAgent();
  if (t.closest('[data-agent-reset]')) {
    if (confirm('Discard the agent wallet? Any test USDC in it will be lost.')) {
      forgetAgentWallet();
      fillAgent();
    }
    return;
  }
  if (t.closest('[data-agent-run]')) return runAgent();
  const pick = t.closest('[data-pick]');
  if (pick) return doConnect(pick.dataset.pick);
  if (t.closest('[data-wallet-menu]')) return walletMenu();
  if (t.closest('[data-disconnect]')) {
    await disconnectWallet();
    if ($('#connect').open) $('#connect').close();
    toast('Wallet disconnected');
    return;
  }
  if (t.closest('[data-close-connect]') || t === $('#connect')) return $('#connect').close();
  if (t.closest('[data-close]') || t === $('#run')) return $('#run').close();
  const cp = t.closest('[data-copy]');
  if (cp) {
    try {
      await navigator.clipboard.writeText(cp.dataset.copy);
      toast('Address copied');
    } catch {
      toast('Could not copy. Select the address and copy it manually.');
    }
    return;
  }
  if (t.closest('[data-clear]')) {
    if (confirm('Clear the activity history stored in this browser?')) {
      store.set(KEY, []);
      render();
      toast('History cleared');
    }
    return;
  }
  if (t.closest('[data-refresh-wallet]')) {
    $('#wallet-body').innerHTML = '<div class="loading">Reading balances from Solana devnet…</div>';
    await refreshBalance();
    return fillWallet();
  }
  if (t.closest('[data-refresh-earn]')) {
    $('#earn-body').innerHTML = '<div class="loading">Reading on-chain receipts…</div>';
    return fillEarnings();
  }
  if (t.closest('.nav a, .brand')) $('#app').classList.remove('open');
  if (t.closest('#menu-btn')) $('#app').classList.toggle('open');
  if (t === $('#scrim')) $('#app').classList.remove('open');
  if (t.closest('#bell')) {
    const h = history();
    store.set(SEEN, h[0]?.at || '');
    paintChrome();
    toast(h[0] ? `Latest: ${h[0].name} ${h[0].status === 'paid' ? 'unlocked' : 'was rejected'} ${ago(h[0].at)}` : 'No activity yet');
  }
});

$('#search').addEventListener('input', (e) => {
  state.query = e.target.value;
  if (state.route !== 'services') location.hash = '#/services';
  else render();
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('#search').focus();
  }
  if (e.key === 'Escape') $('#app').classList.remove('open');
});
window.addEventListener('hashchange', render);

/* ---------------- boot ---------------- */
onWalletChange((snap) => {
  const was = state.wallet.address;
  state.wallet = snap;
  paintChrome();
  if (snap.address !== was) refreshBalance();
  if ($('#run')?.open) paintRunActions();
  if ($('#connect')?.open && snap.connected && !$('#connect-err')?.innerHTML) {
    /* picker stays open until doConnect closes it */
  }
  if (['home', 'wallet'].includes(state.route)) render();
});

async function boot() {
  initWallets();
  const [cfg, svc, health] = await Promise.allSettled([api('/api/config'), api('/api/services'), api('/api/health')]);
  state.config = cfg.status === 'fulfilled' ? cfg.value : null;
  state.health = health.status === 'fulfilled' ? health.value : null;
  state.apiDown = cfg.status !== 'fulfilled' || svc.status !== 'fulfilled';
  state.services = svc.status === 'fulfilled' && Array.isArray(svc.value) && svc.value.length ? svc.value : FALLBACK_SERVICES;
  render();
}
boot();
