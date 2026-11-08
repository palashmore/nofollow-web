import { api, post, isRemoteOrigin, getAgentUrl, setAgentUrl, getAgentToken, setAgentToken, pairWithAgent, disconnectAgent } from './api.js';
import { $, esc, icon, fmtDate, fmtNum, setTheme, toast, confirmModal } from './ui.js';
import { store, hooks } from './state.js';
import * as V from './views.js';

const NP = 'Pending / contact-style records from the export. Informational only: these are not followers and nothing here is ever unfollowed.';
const ROUTES = [
  { sep: 'Overview' },
  { id: 'dashboard', label: 'Dashboard', icon: 'home', render: V.dashboard },
  { sep: 'Relationships' },
  { id: 'non-followers', label: 'Non-Followers', icon: 'userx', count: k => k.nonFollowers, render: V.tableView({ id: 'nf', title: "Non-Followers", list: 'nonFollowers', selectable: true, engine: 'unfollow', sub: "Manage accounts that you follow but that do not follow you back." }) },
  { id: 'followers', label: 'Followers', icon: 'users', count: k => k.followers, render: V.tableView({ id: 'fo', title: 'Followers', lists: [['followers', 'All followers'], ['fans', "I don't follow back"]], selectable: true, sub: 'People who follow you.' }) },
  { id: 'following', label: 'Following', icon: 'users', count: k => k.following, render: V.tableView({ id: 'fg', title: 'Following', list: 'following', selectable: true, engine: 'unfollow', sub: 'Everyone you follow.' }) },
  { id: 'mutual-followers', label: 'Mutual Followers', icon: 'heart', count: k => k.mutual, render: V.tableView({ id: 'mu', title: 'Mutual followers', list: 'mutual', selectable: true, engine: 'unfollow', sub: 'You follow each other.' }) },
  { id: 'pending-requests', label: 'Pending Requests', icon: 'clock', count: k => k.cancel?.total, render: V.tableView({ id: 'pe', title: 'Pending requests', kind: 'requests', lists: [['pending', 'Sent (outgoing)'], ['incoming', 'Received (incoming)']], selectable: true, engine: 'cancel', sub: 'Follow requests you sent to private accounts can be cancelled here, one at a time. Requests other people sent to you are listed separately and never touched.' }) },
  { id: 'recently-unfollowed', label: 'Recently Unfollowed', icon: 'history', render: V.tableView({ id: 're', title: 'Recently unfollowed', list: 'recent', note: NP, sub: 'From recently_unfollowed_profiles.' }) },
  { id: 'blocked-profiles', label: 'Blocked Profiles', icon: 'ban', render: V.tableView({ id: 'bl', title: 'Blocked profiles', list: 'blocked', sub: 'From blocked_profiles.' }) },
  { sep: 'Intelligence' },
  { id: 'intelligence', label: 'Followers Intelligence', icon: 'sparkles', render: V.intelligenceView },
  { id: 'analytics', label: 'Analytics', icon: 'activity', render: V.analyticsView },
  { sep: 'Automation' },
  { id: 'queue', label: 'Automation Queue', icon: 'clock', render: V.queueView },
  { sep: 'Content' },
  { id: 'archive', label: 'Post Archive', icon: 'archive', render: V.postArchiveView },
  { id: 'highlights', label: 'Stories & Highlights', icon: 'heart', render: V.storiesHighlightsView },
  { sep: 'System' },
  { id: 'execution-history', label: 'Execution History', icon: 'history', render: V.history },
  { id: 'import-data', label: 'Import & Export', icon: 'upload', render: V.importView },
  { id: 'settings', label: 'Settings', icon: 'gear', render: V.settingsView },
];

function renderShell() {
  const k = store.data?.kpis || {};
  $('#sidebar').innerHTML = `
    <div class="brand">
      <div class="brand-icon">${icon('shield', 18)}</div>
      <div class="brand-info">
        <span class="brand-name">NoFollow Web</span>
        <span class="brand-sub">Instagram Intelligence &amp; Automation</span>
      </div>
    </div>
    <nav class="nav">${ROUTES.map(r => r.sep
      ? `<div class="sep">${r.sep}</div>`
      : `<a href="#/${r.id}" data-id="${r.id}">${icon(r.icon, 16)} <span>${r.label}</span>${r.count && store.data?.summary ? `<span class="count">${fmtNum(r.count(k))}</span>` : ''}</a>`).join('')}</nav>`;
  markActive();
  renderTopbar();
}
const markActive = () => document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.id === current()));
const current = () => (location.hash.replace(/^#\//, '') || 'dashboard');

function renderTopbar() {
  const d = store.data; if (!d) return;
  const e = d.engine, b = d.browser, s = b.session || {};
  const br = b.open ? ['ok', 'Browser connected'] : ['bad', 'Browser closed'];
  const ig = !b.open ? ['', 'Instagram not checked'] : s.state === 'AUTHENTICATED' ? ['ok', `Instagram verified${s.account ? ' (@' + esc(s.account) + ')' : ''}`] : ['LOGIN_REQUIRED', 'SECURITY', 'DISCONNECTED'].includes(s.state) ? ['bad', s.state === 'SECURITY' ? 'Security check needed' : 'Login required'] : ['warn', 'Login not verified'];
  const en = e.status === 'IDLE' ? ['', 'Engine idle'] : e.status === 'RUNNING' ? ['ok', 'Running'] : ['SAFETY_PAUSED', 'FAILED'].includes(e.status) ? ['bad', e.status.replace('_', ' ').toLowerCase()] : ['warn', e.status.replace('_', ' ').toLowerCase()];
  const remote = isRemoteOrigin();

  $('#topbar').innerHTML = `<button class="btn ghost menu-btn" id="menu" aria-label="Menu">${icon('menu', 18)}</button>
    ${remote ? `<span class="chip" id="chip-agent" title="Local Windows Agent Connected"><span class="dot ok"></span>Local Agent Active</span>` : ''}
    <span class="chip" id="chip-browser" title="Playwright Browser Status"><span class="dot ${br[0]}"></span>${br[1]}</span>
    <span class="chip" id="chip-ig" title="Instagram Session Status"><span class="dot ${ig[0]}"></span>${ig[1]}</span>
    <span class="chip" id="chip-engine" title="Automation Engine Status"><span class="dot ${en[0]}"></span>${esc(en[1])}</span>
    <span class="chip" title="Export Ingestion Timestamp">Synced ${d.summary ? fmtDate(d.summary.importedAt) : 'never'}</span>
    <span class="spacer"></span>
    <button class="btn sm" id="ig">${b.open ? 'Show Instagram' : 'Open Instagram'}</button>
    ${remote ? `<button class="btn sm ghost" id="btn-agent-status" title="Manage Local Agent Pairing">Agent Settings</button>` : ''}
    <button class="btn sm ghost" id="theme" aria-label="Switch theme" title="Toggle Theme">${icon('sun', 16)}</button>
    <a class="btn sm ghost" href="#/settings" aria-label="Automation settings" title="Settings">${icon('gear', 16)}</a>`;
}

function route() {
  const r = ROUTES.find(x => x.id === current()) || ROUTES[0];
  markActive(); $('#sidebar').classList.remove('open');
  // fresh element every render so views never stack duplicate event listeners
  const old = $('#view'); const el = old.cloneNode(false); old.replaceWith(el);
  store.view = r.render(el) || null;
  document.title = `${r.label} · NoFollow Web`;
}

async function refresh() {
  store.data = await api('/api/state');
  renderShell();
  store.view?.onData?.();
}
hooks.refresh = refresh;
hooks.route = route;

// browser/tab/session info changes without engine events (manual tabs, closed windows): re-read it, but not more than once a second
let healthTimer = null;
function refreshHealth() { clearTimeout(healthTimer); healthTimer = setTimeout(async () => { try { const d = await api('/api/state'); store.data.browser = d.browser; store.data.kpis = d.kpis; renderTopbar(); store.view?.onEngine?.(store.data.engine); } catch { /* server stopping */ } }, 900); }
setInterval(() => { if (store.data) refreshHealth(); }, 8000);

const debounce = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };

function connect() {
  const base = getAgentUrl();
  const token = getAgentToken();
  const esUrl = `${base}/api/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  const es = new EventSource(esUrl);
  es.addEventListener('state', ev => {
    const s = JSON.parse(ev.data);
    store.data.engine = s; store.data.engines = { ...store.data.engines, [s.job]: s };
    renderTopbar(); store.view?.onEngine?.(s);
    if (['RUNNING', 'COMPLETED', 'IDLE', 'LOGIN_REQUIRED', 'RECOVERING', 'SAFETY_PAUSED', 'PAUSED'].includes(s.status)) refreshHealth();
  });
  es.addEventListener('log', ev => { const l = JSON.parse(ev.data); store.logs.push(l); if (store.logs.length > 300) store.logs.shift(); store.view?.onLog?.(l); if (l.level === 'CRITICAL') toast(l.message, 'err'); });
  const upd = debounce(async () => { await refresh(); store.view?.onAccounts?.(); }, 700);
  es.addEventListener('account', upd);
}

document.addEventListener('click', async e => {
  if (e.target.closest('#theme')) { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; setTheme(t); post('/api/settings', { theme: t }).catch(() => {}); }
  if (e.target.closest('#menu')) $('#sidebar').classList.toggle('open');
  if (e.target.closest('#ig')) { try { await post('/api/browser/open'); await refresh(); } catch (err) { toast(err.message, 'err'); } }
  if (e.target.closest('#btn-pair-submit')) {
    const pin = $('#pair-pin-field')?.value;
    try {
      await pairWithAgent(pin);
      toast('Paired successfully with Windows Local Agent!', 'ok');
      await init();
    } catch (err) {
      toast(err.message, 'err');
    }
  }
  if (e.target.closest('#btn-agent-status')) {
    const confirmed = await confirmModal({
      title: 'Windows Local Agent Connection',
      body: `<p>Connected to Local Agent on <code>${esc(getAgentUrl() || 'http://127.0.0.1:4173')}</code>.</p><p>Would you like to disconnect or re-pair?</p>`,
      confirmText: 'Disconnect / Re-pair',
      danger: true
    });
    if (confirmed) {
      await disconnectAgent();
      toast('Disconnected from agent.');
      location.reload();
    }
  }
});

async function init() {
  try { setTheme(localStorage.getItem('nf-theme') || 'dark'); } catch { /* ignore */ }
  try {
    store.data = await api('/api/state');
    setTheme(store.data.settings.theme);
    store.logs = await api('/api/logs?n=100');
  } catch (e) {
    const isMixed = window.__nfMixedContentBlocked;
    const remote = isRemoteOrigin();
    $('#view').innerHTML = `
      <div class="empty" style="max-width:540px;margin:40px auto;text-align:left">
        <h2>${remote ? 'Connect Windows Local Agent' : 'Cannot Reach NoFollow Web Server'}</h2>
        <p>${remote
          ? 'This Vercel dashboard communicates exclusively with your local Windows Playwright agent on loopback (<code>127.0.0.1:4173</code>).'
          : esc(e.message)}</p>
        <div class="card" style="margin-top:16px">
          <h3>Enter Pairing PIN</h3>
          <p class="sub">Check your Windows terminal or run <code>node unfollow.mjs</code> to see your 6-character PIN (e.g. <code>NF-7429</code>):</p>
          <input type="text" id="pair-pin-field" placeholder="Enter PIN (e.g. NF-7429)" style="width:100%;padding:10px;font-size:16px;margin:8px 0;text-transform:uppercase">
          <div class="row" style="margin-top:10px;gap:8px">
            <button class="btn primary" id="btn-pair-submit">Connect Local Agent</button>
            <a class="btn ghost" href="http://127.0.0.1:4173" target="_blank" rel="noopener noreferrer">Open Local Dashboard Directly</a>
          </div>
        </div>
        <div class="card" style="margin-top:14px;background:var(--surface-2);border-color:var(--border-subtle)">
          <h4 style="margin:0 0 8px;font-size:13px;display:flex;align-items:center;gap:6px">${icon('sparkles', 14)} New user? 3-step setup:</h4>
          <ol style="margin:0;padding-left:18px;font-size:12.5px;color:var(--text-sub);line-height:1.6">
            <li>Download the portable agent from <a href="https://github.com/palashmore/nofollow-web" target="_blank" rel="noopener noreferrer" style="font-weight:600;color:var(--accent)">GitHub (nofollow-web)</a>.</li>
            <li>Double-click <code>run.bat</code> on your Windows PC.</li>
            <li>Enter the 6-character PIN shown in your terminal, or click <a href="http://127.0.0.1:4173" target="_blank" rel="noopener noreferrer" style="font-weight:600;color:var(--accent)">Open Local Dashboard Directly</a>.</li>
          </ol>
        </div>
        ${isMixed ? `
          <div class="notice bad" style="margin-top:16px">
            <b>Browser Local Network Access Policy:</b> Modern browsers block direct HTTPS-to-HTTP loopback requests without user permission.
            <br>Click <a href="http://127.0.0.1:4173" target="_blank" style="text-decoration:underline;color:inherit;font-weight:bold">Open Local Dashboard Directly</a> to run on loopback with zero restrictions.
          </div>
        ` : ''}
      </div>`;
    return;
  }
  renderShell(); route(); connect();
  window.addEventListener('hashchange', route);
}

init();
