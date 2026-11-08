import { api, post } from './api.js';
import { $, esc, icon, fmtDate, fmtNum, toast, confirmModal, infoModal, badge } from './ui.js';
import { store, hooks } from './state.js';
import { PROFILES, perHour, label, enginePanel, healthPanel, engineOf } from './panels.js';

const STATUSES = ['PENDING', 'UNFOLLOWED', 'ALREADY_UNFOLLOWED', 'PROFILE_UNAVAILABLE', 'SKIPPED', 'NEEDS_REVIEW', 'FAILED', 'ACTION_BLOCKED', 'RETRY_PENDING', 'PAUSED'];
const REQ_STATUSES = ['PENDING', 'CANCELLED', 'ALREADY_CANCELLED', 'ACCEPTED', 'PROFILE_UNAVAILABLE', 'FAILED', 'NEEDS_REVIEW'];
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function formatAge(ts) {
  if (!ts) return '—';
  const ms = typeof ts === 'number' ? ts : Date.parse(ts);
  if (isNaN(ms)) return '—';
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  const yr = Math.floor(day / 365.25);
  const mo = Math.floor(day / 30.4375);

  if (yr >= 1) return `${yr} yr${yr > 1 ? 's' : ''} ago`;
  if (mo >= 1) return `${mo} mo${mo > 1 ? 's' : ''} ago`;
  if (day >= 1) return `${day} d ago`;
  if (hr >= 1) return `${hr} hr${hr > 1 ? 's' : ''} ago`;
  return `${min} min ago`;
}

export const kpiCard = (l, v, id = '') => `<div class="card kpi"><div class="label">${l}</div><div class="value"${id ? ` id="${id}"` : ''}>${typeof v === 'number' ? fmtNum(v) : esc(v)}</div></div>`;

/* ---------------------------------------------------------------- dashboard */
export function dashboard(el) {
  const account = store.data?.browser?.session?.account || 'Instagram User';
  const syncTime = store.data?.summary?.importedAt ? fmtDate(store.data.summary.importedAt) : 'never';

  el.innerHTML = `
    <!-- Section A: Editorial Hero -->
    <div class="obsidian-hero">
      <div class="hero-main">
        <h1 class="hero-title">Your account, in focus.</h1>
        <div class="hero-sub">Relationship intelligence, account insights and controlled automation.</div>
      </div>
      <div class="hero-meta">
        <div class="user-badge" id="hero-user-badge">
          <div class="avatar-dot">IG</div>
          <span>@${esc(account)}</span>
        </div>
        <span class="chip" id="hero-sync-chip"><span class="dot ok"></span>Synced ${syncTime}</span>
        <a class="btn sm primary" href="#/non-followers">Review Non-Followers</a>
      </div>
    </div>

    <!-- Section G: Quick Workspaces -->
    <div class="quick-action-bar">
      <span class="label">Workspaces:</span>
      <a class="quick-pill" href="#/non-followers">${icon('userx', 14)} Non-Followers</a>
      <a class="quick-pill" href="#/pending-requests">${icon('clock', 14)} Pending Requests</a>
      <a class="quick-pill" href="#/queue">${icon('activity', 14)} Automation Queue</a>
      <a class="quick-pill" href="#/intelligence">${icon('sparkles', 14)} Intelligence</a>
      <a class="quick-pill" href="#/import-data">${icon('upload', 14)} Import &amp; Export</a>
    </div>

    <!-- Section B: Asymmetric Bento Metrics Layout -->
    <div id="cards"></div>

    <!-- Section D & E: Automation Command Center + Browser/Agent Health -->
    <div class="grid two" style="margin-top:20px">
      <div class="card" id="eng"></div>
      <div class="card" id="health"></div>
    </div>

    <!-- Section C: Relationship Distribution & Ingestion Status -->
    <div class="grid two" style="margin-top:20px">
      <div class="card" id="ov"></div>
      <div class="card" id="imp"></div>
    </div>

    <!-- Section F: Real-Time Activity Timeline -->
    <div class="card" style="margin-top:20px">
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <h2 style="margin:0">Activity Timeline</h2>
        <span class="chip" style="font-size:11px"><span class="dot ok"></span>Live Event Stream</span>
      </div>
      <div class="log" id="log" aria-live="polite"></div>
    </div>`;

  const panel = enginePanel($('#eng', el), 'unfollow');
  const health = healthPanel($('#health', el));

  function drawData() {
    const d = store.data, k = d.kpis;
    const account = d.browser?.session?.account || d.profile?.username || 'Instagram User';
    const heroBadge = $('#hero-user-badge span', el);
    if (heroBadge) heroBadge.textContent = `@${account}`;

    // Bento composition inside #cards
    $('#cards', el).innerHTML = `
      <div class="bento-overview">
        <!-- Hero Highlight Metric: Don't Follow Back -->
        <div class="hero-kpi card kpi accent">
          <div>
            <div class="label">${icon('userx', 15)} Don't follow back</div>
            <div class="value">${fmtNum(k.nonFollowers)}</div>
            <div class="desc">Unreciprocated accounts you follow that do not follow you back.</div>
          </div>
          <a class="hero-action" href="#/non-followers">Review &amp; Clean Up →</a>
        </div>

        <!-- Secondary Metrics Trio -->
        <div class="sub-kpi card kpi">
          <div class="label">${icon('users', 14)} Total followers</div>
          <div class="value">${fmtNum(k.followers)}</div>
          <div class="tag">Audience &amp; fans</div>
        </div>

        <div class="sub-kpi card kpi">
          <div class="label">${icon('users', 14)} Total following</div>
          <div class="value">${fmtNum(k.following)}</div>
          <div class="tag">Accounts you follow</div>
        </div>

        <div class="sub-kpi card kpi">
          <div class="label">${icon('heart', 14)} Mutual followers</div>
          <div class="value">${fmtNum(k.mutual)}</div>
          <div class="tag">Reciprocal connections</div>
        </div>
      </div>

      <!-- Tertiary Status Metric Row -->
      <div class="tertiary-kpis">
        <div class="tertiary-card card kpi">
          <div class="info-block">
            <span class="label">Already unfollowed</span>
            <span class="value">${fmtNum(k.alreadyUnfollowed)}</span>
          </div>
          ${icon('check', 16)}
        </div>
        <div class="tertiary-card card kpi">
          <div class="info-block">
            <span class="label">Successfully unfollowed</span>
            <span class="value">${fmtNum(k.unfollowed)}</span>
          </div>
          ${icon('check', 16)}
        </div>
        <div class="tertiary-card card kpi">
          <div class="info-block">
            <span class="label">Pending review</span>
            <span class="value">${fmtNum(k.pendingReview)}</span>
          </div>
          ${icon('clock', 16)}
        </div>
        <div class="tertiary-card card kpi">
          <div class="info-block">
            <span class="label">Failed accounts</span>
            <span class="value">${fmtNum(k.failed)}</span>
          </div>
          ${icon('ban', 16)}
        </div>
      </div>
    `;

    // Relationship Distribution in #ov
    const fans = d.summary?.totals.fans || 0, tot = (k.mutual + k.nonFollowers + fans) || 1;
    const mutualPct = ((k.mutual / tot) * 100).toFixed(1);
    const nonFollowPct = ((k.nonFollowers / tot) * 100).toFixed(1);
    const fansPct = ((fans / tot) * 100).toFixed(1);

    $('#ov', el).innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:6px">
        <h2 style="margin:0">Relationship Distribution</h2>
        <span class="chip" style="font-size:11px">${fmtNum(tot)} Total Analyzed</span>
      </div>
      <p class="sub" style="margin:0 0 12px;font-size:12.5px">Proportional audience composition from your verified data export.</p>
      
      <div class="viz-meter">
        <i style="width:${mutualPct}%;background:var(--ok)" title="Mutual: ${mutualPct}%"></i>
        <i style="width:${nonFollowPct}%;background:var(--accent)" title="Don't Follow Back: ${nonFollowPct}%"></i>
        <i style="width:${fansPct}%;background:var(--info)" title="Fans: ${fansPct}%"></i>
      </div>

      <div class="viz-legend">
        <div class="legend-item">
          <div class="legend-color" style="background:var(--ok)"></div>
          <div class="legend-data">
            <span class="legend-name">Mutual</span>
            <span class="legend-val">${fmtNum(k.mutual)} <small style="color:var(--muted);font-weight:400">(${mutualPct}%)</small></span>
          </div>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background:var(--accent)"></div>
          <div class="legend-data">
            <span class="legend-name">Don't Follow Back</span>
            <span class="legend-val">${fmtNum(k.nonFollowers)} <small style="color:var(--muted);font-weight:400">(${nonFollowPct}%)</small></span>
          </div>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background:var(--info)"></div>
          <div class="legend-data">
            <span class="legend-name">Fans (Follow You)</span>
            <span class="legend-val">${fmtNum(fans)} <small style="color:var(--muted);font-weight:400">(${fansPct}%)</small></span>
          </div>
        </div>
      </div>
      <p class="sub" style="margin:14px 0 0;font-size:12px">Remaining to process: <b style="color:var(--text)">${fmtNum(k.remaining)}</b> · Unavailable profiles: ${fmtNum(k.unavailable)}</p>
    `;

    // Ingestion Status in #imp
    const s = d.summary;
    $('#imp', el).innerHTML = !s
      ? `<h2>Import Status</h2><div class="empty"><h2>No data imported yet</h2><p>Import your Instagram export to begin relationship analysis.</p><a class="btn primary" href="#/import-data">Import data</a></div>`
      : `<div class="row" style="justify-content:space-between;margin-bottom:6px">
           <h2 style="margin:0">Import Status</h2>
           <span class="chip" style="font-size:11px">${s.files?.length || 0} Files Verified</span>
         </div>
         <p class="sub" style="margin:0 0 10px;font-size:12.5px">Ingested ${fmtDate(s.importedAt)}</p>
         ${s.warnings.map(w => `<div class="notice ${/INCOMPLETE|No followers|No following/.test(w) ? 'bad' : ''}">${esc(w)}</div>`).join('') || '<div class="notice ok">Export verified and structurally complete.</div>'}
         <div class="legend" style="margin-top:12px">${s.files.filter(f => f.role).map(f => `<span style="--c:var(--accent)">${esc(f.name)} · ${fmtNum(f.count)}</span>`).join('')}</div>`;
  }
  drawData();

  const log = $('#log', el);
  const line = e => `
    <div class="timeline-entry ${e.level}">
      <div class="timeline-dot ${e.level === 'SUCCESS' ? 'ok' : ['ERROR', 'CRITICAL'].includes(e.level) ? 'bad' : e.level === 'WARNING' ? 'warn' : ''}"></div>
      <div class="timeline-content">
        <div class="timeline-time">${new Date(e.timestamp).toLocaleTimeString()}${e.username ? ' · @' + esc(e.username) : ''}</div>
        <div class="timeline-msg">${esc(e.message)}</div>
      </div>
    </div>
  `;
  log.innerHTML = store.logs.slice(-40).map(line).join('') || '<span class="t">No activity yet.</span>';
  log.scrollTop = log.scrollHeight;
  return {
    onEngine: () => { panel.update(); health.update(); }, onData: () => { drawData(); panel.update(); health.update(); },
    onLog: e => { if (log.firstElementChild?.tagName === 'SPAN') log.innerHTML = ''; log.insertAdjacentHTML('beforeend', line(e)); log.scrollTop = log.scrollHeight; },
  };
}

/* ---------------------------------------------------------------- list tables */
const tableState = new Map();

export const tableView = cfg => el => {
  const lists = cfg.lists || [[cfg.list, cfg.title]];
  const requests = cfg.kind === 'requests';
  const st = tableState.get(cfg.id) || { list: lists[0][0], q: '', status: '', sort: requests ? 'requestedAt' : 'username', dir: 'asc', page: 1, size: 50 };
  tableState.set(cfg.id, st);
  const empty = !store.data.summary;
  const outgoing = requests && st.list === 'pending';                     // only OUTGOING requests can be selected or cancelled
  const sel = requests ? store.reqSelection : store.selection;
  const selectable = cfg.selectable && (!requests || outgoing);
  const statuses = requests ? REQ_STATUSES : STATUSES;
  const kpi = (l, v, id) => `<div class="card kpi"><div class="label">${l}</div><div class="value" id="${id}">${fmtNum(v)}</div></div>`;
  el.innerHTML = `<h1>${esc(cfg.title)}</h1><p class="sub">${cfg.sub || ''}</p>
    ${requests ? `<div class="grid kpis" id="rq-kpis"></div>` : ''}
    ${cfg.engine ? '<div class="card" id="eng" style="margin-bottom:14px"></div>' : ''}
    ${cfg.note ? `<div class="notice">${cfg.note}</div>` : ''}
    ${requests ? `<div class="notice ${outgoing ? '' : 'ok'}">${outgoing ? '<b>Sent requests</b>: follow requests YOU sent to private accounts. Only these can be cancelled.' : '<b>Received requests</b>: requests other people sent to you. Shown for information only; nothing here is ever cancelled or changed.'}</div>` : ''}
    ${lists.length > 1 ? `<div class="row" style="margin-bottom:12px">${lists.map(l => `<button class="btn sm ${l[0] === st.list ? 'primary' : ''}" data-list="${l[0]}">${esc(l[1])}</button>`).join('')}</div>` : ''}
    <div class="toolbar">
      <input type="search" id="q" placeholder="${requests ? 'Search username or display name' : 'Search username'}" value="${esc(st.q)}" aria-label="Search">
      <select id="st" aria-label="Filter by status"><option value="">All statuses</option>${statuses.map(s => `<option value="${s}" ${st.status === s ? 'selected' : ''}>${label(s)}</option>`).join('')}</select>
      ${requests ? `<select id="sort-sel" aria-label="Sort order">
        <option value="oldest" ${st.sort === 'requestedAt' && st.dir === 'asc' ? 'selected' : ''}>Oldest First (Default)</option>
        <option value="newest" ${st.sort === 'requestedAt' && st.dir === 'desc' ? 'selected' : ''}>Newest First</option>
        <option value="user_asc" ${st.sort === 'username' && st.dir === 'asc' ? 'selected' : ''}>Username A–Z</option>
        <option value="user_desc" ${st.sort === 'username' && st.dir === 'desc' ? 'selected' : ''}>Username Z–A</option>
      </select>` : ''}
      <select id="sz" aria-label="Page size">${[25, 50, 100, 200].map(n => `<option ${st.size === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
      ${selectable ? `<span class="chip" id="selc"></span>
        <button class="btn sm" data-s="page">Select page</button><button class="btn sm" data-s="filtered">Select all filtered</button>
        <button class="btn sm" data-s="pending">${requests ? 'Select all pending' : 'Select pending only'}</button><button class="btn sm ghost" data-s="clear">Clear</button>` : ''}
    </div>
    <div class="tablewrap"><table><thead><tr>${selectable ? '<th style="width:36px"><input type="checkbox" id="all" aria-label="Select page"></th>' : ''}
      ${requests ? `
        <th class="sortable" data-sort="username">Username</th>
        <th class="sortable" data-sort="displayName">Display Name</th>
        <th class="sortable" data-sort="requestedAt">Request Date</th>
        <th>Request Age</th>
        <th class="sortable" data-sort="relationship">Current Relationship</th>
        <th class="sortable" data-sort="status">Cancellation Status</th>
        <th class="sortable" data-sort="lastAttemptAt">Last Attempt</th>
        <th>Action</th>
      ` : `
        <th class="sortable" data-sort="username">Profile</th>
        <th class="sortable" data-sort="relationship">Relationship</th>
        <th>Account</th>
        <th class="sortable" data-sort="status">Automation</th>
        <th class="sortable" data-sort="lastAttemptAt">Last attempt</th>
        <th>Action</th>
      `}
      </tr></thead>
      <tbody id="tb"></tbody></table></div><div class="pager" id="pg"></div>
    ${requests ? '<div class="grid two" style="margin-top:18px"><div class="card"><h2>Live activity</h2><div class="log" id="rlog" aria-live="polite"></div></div><div class="card"><h2>Cancellation history</h2><div class="tablewrap"><table><thead><tr><th>Started</th><th>Status</th><th>Done</th><th>Accepted</th><th>Failed</th></tr></thead><tbody id="rhist"></tbody></table></div></div></div>' : ''}`;
  const panel = cfg.engine ? enginePanel($('#eng', el), cfg.engine) : null;
  let rows = [], total = 0, seq = 0;

  const kpis = () => {
    if (!requests) return;
    const k = store.data.kpis.cancel || {};
    $('#rq-kpis', el).innerHTML =
      kpi('Total pending requests', k.imported || k.total, 'k-imported') +
      kpi('Eligible pending', k.eligible ?? k.total, 'k-eligible') +
      kpi('Selected', sel.size, 'k-sel') +
      kpi('Successfully cancelled', k.cancelled, 'k-done') +
      kpi('Already cancelled', k.alreadyCancelled, 'k-already') +
      kpi('Accepted', k.accepted, 'k-acc') +
      kpi('Profile unavailable', k.unavailable, 'k-unav') +
      kpi('Failed', k.failed, 'k-fail') +
      kpi('Needs review', k.needsReview || k.review, 'k-review') +
      kpi('Remaining', k.remaining, 'k-rem') +
      kpi('Received requests (info)', k.received || 0, 'k-received');
  };
  const qs = extra => new URLSearchParams({ list: st.list, q: st.q, status: st.status, sort: st.sort, dir: st.dir, page: st.page, size: st.size, ...extra });
  const cols = requests ? (selectable ? 9 : 8) : ((selectable ? 1 : 0) + 5);
  const selCount = () => { const ch = $('#selc', el); if (ch) ch.textContent = `${fmtNum(sel.size)} selected`; const ks = $('#k-sel', el); if (ks) ks.textContent = fmtNum(sel.size); panel?.update(); };

  async function load() {
    const my = ++seq;
    $('#tb', el).innerHTML = Array.from({ length: 6 }, () => `<tr class="skeleton">${'<td><div></div></td>'.repeat(cols)}</tr>`).join('');
    try {
      const r = await api(`/api/accounts?${qs()}`);
      if (my !== seq) return;
      rows = r.rows; total = r.total; draw();
    } catch (e) { $('#tb', el).innerHTML = `<tr><td colspan="${cols}"><div class="empty"><h2>Could not load</h2>${esc(e.message)}</div></td></tr>`; }
  }

  const profile = u => `https://www.instagram.com/${encodeURIComponent(u)}/`;
  function draw() {
    const tb = $('#tb', el);
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="${cols}"><div class="empty"><h2>${empty ? 'No data imported yet' : 'No accounts match'}</h2>${empty ? '<a class="btn primary" href="#/import-data">Import data</a>' : 'Try a different search or filter.'}</div></td></tr>`;
    } else {
      tb.innerHTML = rows.map(r => `<tr>
        ${selectable ? `<td><input type="checkbox" data-u="${esc(r.username)}" ${sel.has(r.username) ? 'checked' : ''} aria-label="Select ${esc(r.username)}"></td>` : ''}
        ${requests ? `
          <td><a href="${profile(r.username)}" target="_blank" rel="noopener noreferrer">@${esc(r.username)}</a></td>
          <td>${esc(r.displayName || '—')}</td>
          <td class="muted">${fmtDate(r.requestedAt)}</td>
          <td><span class="chip" title="${esc(r.requestedAt ? new Date(r.requestedAt).toLocaleString() : '')}">${formatAge(r.requestedAt)}</span></td>
          <td>${esc(r.relationship || 'Request pending')}</td>
          <td>${badge(r.status)} <span class="muted">${esc(r.requestStatus)}</span></td>
          <td class="muted">${fmtDate(r.lastAttemptAt)}</td>
          <td>${outgoing ? `<button class="btn sm" data-c="${esc(r.username)}" ${['CANCELLED', 'ALREADY_CANCELLED', 'ACCEPTED', 'PROFILE_UNAVAILABLE'].includes(r.status) ? 'disabled' : ''}>Cancel request</button>` : ''}
              <a class="btn sm ghost" href="${profile(r.username)}" target="_blank" rel="noopener noreferrer">Open</a>
              ${r.reason || r.screenshot ? `<button class="btn sm ghost" data-i="${esc(r.username)}">Inspect</button>` : ''}</td>
        ` : `
          <td><a href="${profile(r.username)}" target="_blank" rel="noopener noreferrer">@${esc(r.username)}</a></td>
          <td>${esc(r.relationship)}</td><td class="muted">${esc(r.accountStatus)}</td><td>${badge(r.status)}</td>
          <td class="muted">${fmtDate(r.lastAttemptAt)}</td>
          <td>
            ${['Mutual', 'Not following back', 'Following'].includes(r.relationship) ? `<button class="btn sm danger-ghost" data-unfollow="${esc(r.username)}" ${['UNFOLLOWED', 'ALREADY_UNFOLLOWED'].includes(r.status) ? 'disabled' : ''}>Unfollow</button>` : ''}
            ${r.relationship === 'Follows you only' ? `<button class="btn sm primary-ghost" data-follow="${esc(r.username)}">Follow</button>` : ''}
            <a class="btn sm ghost" href="${profile(r.username)}" target="_blank" rel="noopener noreferrer">Open</a>
            ${r.reason || r.screenshot ? `<button class="btn sm ghost" data-i="${esc(r.username)}">Inspect</button>` : ''}
          </td>
        `}
      </tr>`).join('');
    }
    const pages = Math.max(1, Math.ceil(total / st.size));
    $('#pg', el).innerHTML = `<span>${fmtNum(total)} accounts${total ? ` · ${(st.page - 1) * st.size + 1}–${Math.min(total, st.page * st.size)}` : ''}</span>
      <span class="row"><button class="btn sm" data-p="-1" ${st.page <= 1 ? 'disabled' : ''}>Previous</button> Page ${st.page} of ${pages} <button class="btn sm" data-p="1" ${st.page >= pages ? 'disabled' : ''}>Next</button></span>`;
    selCount();
  }

  const reload = () => { st.page = 1; load(); };
  $('#q', el).addEventListener('input', debounce(e => { st.q = e.target.value; reload(); }, 250));
  $('#st', el).addEventListener('change', e => { st.status = e.target.value; reload(); });
  $('#sz', el).addEventListener('change', e => { st.size = +e.target.value; reload(); });
  const sortSel = $('#sort-sel', el);
  if (sortSel) {
    sortSel.addEventListener('change', e => {
      const v = e.target.value;
      if (v === 'oldest') { st.sort = 'requestedAt'; st.dir = 'asc'; }
      else if (v === 'newest') { st.sort = 'requestedAt'; st.dir = 'desc'; }
      else if (v === 'user_asc') { st.sort = 'username'; st.dir = 'asc'; }
      else if (v === 'user_desc') { st.sort = 'username'; st.dir = 'desc'; }
      reload();
    });
  }
  el.addEventListener('click', async ev => {
    const t = ev.target;
    if (t.dataset.list) { st.list = t.dataset.list; st.page = 1; st.status = ''; hooks.route(); return; }
    if (t.dataset.sort) { st.dir = st.sort === t.dataset.sort && st.dir === 'asc' ? 'desc' : 'asc'; st.sort = t.dataset.sort; load(); return; }
    if (t.dataset.p) { st.page += +t.dataset.p; load(); return; }
    if (t.dataset.i) { const r = rows.find(x => x.username === t.dataset.i); infoModal(`@${r.username}`, `<p>Status: ${badge(r.status)}</p><p>${esc(r.reason || 'No note.')}</p>${r.screenshot ? `<p><a href="/${esc(r.screenshot)}" target="_blank">View screenshot</a></p>` : ''}`); return; }
    if (t.dataset.c) {
      const u = t.dataset.c;
      if (!await confirmModal({ title: `Cancel the request to @${u}?`, danger: true, confirmText: 'Confirm Cancellation', body: '<p>The request is re-checked on Instagram first. If it was accepted meanwhile, nothing is changed.</p>' })) return;
      try { await post('/api/run/start', { mode: 'cancel', usernames: [u], confirm: true }); toast(`Cancelling @${u}`, 'ok'); await hooks.refresh(); } catch (e) { toast(e.message, 'err'); }
      return;
    }
    if (t.dataset.unfollow) {
      const u = t.dataset.unfollow;
      if (!await confirmModal({
        title: `Unfollow @${u}?`,
        danger: true,
        confirmText: 'Confirm Unfollow',
        body: `<p>The account <b>@${esc(u)}</b> will be verified on Instagram and safely unfollowed.</p>`
      })) return;
      try {
        await post('/api/run/start', { mode: 'unfollow', usernames: [u], confirm: true });
        toast(`Unfollowing @${u}`, 'ok');
        await hooks.refresh();
      } catch (e) {
        toast(e.message, 'err');
      }
      return;
    }
    if (t.dataset.follow) {
      const u = t.dataset.follow;
      try {
        await post('/api/tabs/open', { username: u });
        toast(`Opened @${u} in Instagram browser`, 'ok');
      } catch (e) {
        window.open(`https://www.instagram.com/${encodeURIComponent(u)}/`, '_blank');
      }
      return;
    }
    const s = t.dataset.s; if (!s) return;
    if (s === 'clear') sel.clear();
    if (s === 'page') rows.forEach(r => sel.add(r.username));
    if (s === 'filtered' || s === 'pending') {
      const r = await api(`/api/accounts?${qs({ ids: 1, status: s === 'pending' ? 'PENDING' : st.status })}`);
      r.ids.forEach(u => sel.add(u));
      toast(`${fmtNum(r.ids.length)} ${requests ? 'requests' : 'accounts'} added to the selection`);
    }
    draw();
  });
  el.addEventListener('change', ev => {
    const t = ev.target;
    if (t.id === 'all') { rows.forEach(r => (t.checked ? sel.add(r.username) : sel.delete(r.username))); draw(); }
    else if (t.dataset.u) { t.checked ? sel.add(t.dataset.u) : sel.delete(t.dataset.u); selCount(); }
  });

  if (requests) {
    kpis();
    const rlog = $('#rlog', el), line = e => `<div class="${e.level}"><span class="t">${new Date(e.timestamp).toLocaleTimeString()}</span> ${e.username ? '@' + esc(e.username) + ' ' : ''}${esc(e.message)}</div>`;
    rlog.innerHTML = store.logs.slice(-40).map(line).join('') || '<span class="t">No activity yet.</span>'; rlog.scrollTop = rlog.scrollHeight;
    const loadHist = () => api('/api/history').then(runs => {
      const mine = runs.filter(r => r.job === 'cancel').slice(0, 8);
      $('#rhist', el).innerHTML = mine.length ? mine.map(r => { const k = r.counts || {}; return `<tr><td>${fmtDate(r.startedAt)}</td><td>${esc(r.status.toLowerCase())}</td><td>${fmtNum(k.unfollowed)}</td><td>${fmtNum(k.accepted)}</td><td>${fmtNum(k.failed)}</td></tr>`; }).join('') : '<tr><td colspan="5" class="muted">No cancellation runs yet.</td></tr>';
    });
    loadHist();
    load();
    return {
      onEngine: () => { panel?.update(); kpis(); loadHist(); }, onAccounts: () => { load(); kpis(); }, onData: () => { panel?.update(); kpis(); },
      onLog: e => { if (rlog.firstElementChild?.tagName === 'SPAN') rlog.innerHTML = ''; rlog.insertAdjacentHTML('beforeend', line(e)); rlog.scrollTop = rlog.scrollHeight; },
    };
  }
  load();
  return { onEngine: panel?.update, onAccounts: load, onData: () => panel?.update() };
};

/* ---------------------------------------------------------------- history */
export function history(el) {
  el.innerHTML = `<h1>Execution history</h1><p class="sub">Every run, with its result counts. Logs are also written to the logs/ folder.</p>
    <div class="row" style="margin-bottom:14px"><a class="btn" href="/api/report" download>Download error report</a></div>
    <div class="tablewrap"><table><thead><tr><th>Started</th><th>Ended</th><th>Job</th><th>Status</th><th>Selected</th><th>Done</th><th>Already</th><th>Accepted</th><th>Unavailable</th><th>Review</th><th>Failed</th></tr></thead><tbody id="runs"></tbody></table></div>
    <h2 style="margin-top:22px">Live log</h2><div class="log" id="log" style="max-height:420px"></div>`;
  const line = e => `<div class="${e.level}"><span class="t">${new Date(e.timestamp).toLocaleTimeString()} [${e.level}]</span> ${e.username ? '@' + esc(e.username) + ': ' : ''}${esc(e.message)}</div>`;
  const log = $('#log', el);
  api('/api/logs?n=300').then(l => { log.innerHTML = l.map(line).join('') || '<span class="t">No log entries yet.</span>'; log.scrollTop = log.scrollHeight; });
  const loadRuns = () => api('/api/history').then(runs => {
    $('#runs', el).innerHTML = runs.length ? runs.map(r => { const c = r.counts || {}; return `<tr><td>${fmtDate(r.startedAt)}</td><td>${fmtDate(r.endedAt)}</td><td>${esc(r.job === 'cancel' ? 'Cancel requests' : 'Unfollow')}</td><td><span class="badge b-${r.status === 'COMPLETED' ? 'UNFOLLOWED' : r.status === 'RUNNING' ? 'IN_PROGRESS' : r.status === 'STOPPED' ? 'SKIPPED' : 'NEEDS_REVIEW'}">${esc(r.status.toLowerCase())}</span></td><td>${fmtNum(r.selectedCount)}</td><td>${fmtNum(c.unfollowed)}</td><td>${fmtNum(c.alreadyUnfollowed)}</td><td>${fmtNum(c.accepted)}</td><td>${fmtNum(c.unavailable)}</td><td>${fmtNum(c.needsReview)}</td><td>${fmtNum(c.failed)}</td></tr>`; }).join('')
      : `<tr><td colspan="11"><div class="empty"><h2>No runs yet</h2>Runs appear here after you start one.</div></td></tr>`;
  });
  loadRuns();
  return { onLog: e => { log.insertAdjacentHTML('beforeend', line(e)); log.scrollTop = log.scrollHeight; }, onEngine: debounce(loadRuns, 800) };
}

/* ---------------------------------------------------------------- import */
const KNOWN = /^(followers(_\d+)?|following|pending_follow_requests|recently_unfollowed_profiles|blocked_profiles|profiles_you've_favorited|restricted_profiles|recent_follow_requests|follow_requests_you've_received|removed_suggestions)\.(json|html)$/i;

export function importView(el) {
  el.innerHTML = `<h1>Import data</h1><p class="sub">Select the files from your Instagram export folder <code>connections\\followers_and_following</code> (JSON or HTML).</p>
    <div class="drop" id="drop"><p><b>Drop files here</b> or</p><input type="file" id="files" multiple accept=".json,.html"><p style="margin-bottom:0">Pick <b>followers_1</b> (and followers_2… if present) and <b>following</b>. Other files are optional.</p></div>
    <div id="picked" style="margin-top:14px"></div><div class="row" style="margin-top:14px"><button class="btn primary" id="go" disabled>Import selected files</button></div><div id="res" style="margin-top:18px"></div>`;
  let files = [];
  const pick = list => {
    files = [...list]; const ok = files.filter(f => KNOWN.test(f.name));
    $('#picked', el).innerHTML = files.length ? `<div class="legend">${files.map(f => `<span style="--c:${KNOWN.test(f.name) ? 'var(--ok)' : 'var(--muted)'}">${esc(f.name)}${KNOWN.test(f.name) ? '' : ' (ignored)'}</span>`).join('')}</div>` : '';
    $('#go', el).disabled = !ok.length;
  };
  $('#files', el).addEventListener('change', e => pick(e.target.files));
  const drop = $('#drop', el);
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer.files); });
  $('#go', el).addEventListener('click', async () => {
    const btn = $('#go', el); btn.disabled = true; btn.textContent = 'Importing…';
    try {
      for (const f of files.filter(f => KNOWN.test(f.name))) await api(`/api/import/file?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: await f.text() });
      const s = await post('/api/import/commit');
      await hooks.refresh();
      $('#res', el).innerHTML = `${s.warnings.map(w => `<div class="notice ${/INCOMPLETE|No followers|No following/.test(w) ? 'bad' : ''}">${esc(w)}</div>`).join('') || '<div class="notice ok">Export looks complete.</div>'}
        <div class="card"><b>${fmtNum(s.totals.following)}</b> following · <b>${fmtNum(s.totals.followers)}</b> followers · <b>${fmtNum(s.totals.nonFollowers)}</b> don't follow back · <b>${fmtNum(s.totals.mutual)}</b> mutual
        <div style="margin-top:12px"><a class="btn primary" href="#/non-followers">Review non-followers</a></div></div>`;
      toast('Import complete', 'ok');
    } catch (e) { toast(e.message, 'err'); } finally { btn.textContent = 'Import selected files'; btn.disabled = false; }
  });
}

/* ---------------------------------------------------------------- settings */
export function settingsView(el) {
  const s = store.data.settings;
  const num = (k, l, hint, min, max) => `<label class="field">${l}<input type="number" id="s-${k}" value="${s[k]}" min="${min}" max="${max}" step="1"><span>${hint}</span></label>`;
  el.innerHTML = `<h1>Automation settings</h1><p class="sub">One action worker, one account at a time, with a fixed wait between actions. Invalid values are rejected, never changed silently.</p>
    <div class="card" style="max-width:720px"><h2>Execution</h2><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr))">
      <label class="field">Execution profile<select id="s-executionProfile">${Object.entries(PROFILES).map(([k, p]) => `<option value="${k}">${p.name} (${p.intervalSec} s)</option>`).join('')}<option value="custom">Custom</option></select><span id="s-pnote"></span></label>
      ${num('actionIntervalSec', 'Action interval (seconds)', 'Fixed wait between accounts, 2 to 600', 2, 600)}
      ${num('navigationTimeoutSec', 'Navigation timeout (seconds)', 'Opening a profile, 10 to 120', 10, 120)}
      ${num('elementTimeoutSec', 'Element detection timeout (seconds)', 'Waiting for buttons to appear, 3 to 60', 3, 60)}
      ${num('maxAttempts', 'Retries per account', 'Bounded, 1 to 5', 1, 5)}
      ${num('maxPerRun', 'Max accounts per run', 'Hard cap for one run', 1, 5000)}
      ${num('errorThreshold', 'Failure streak limit', 'Consecutive failures before a safety pause', 2, 50)}</div>
      <h2 style="margin-top:20px">Application</h2><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr))">
      <label class="field">Browser<select id="s-browserChannel"><option value="chrome">Google Chrome</option><option value="msedge">Microsoft Edge</option><option value="">Playwright Chromium</option></select><span>Applies after the app restarts</span></label>
      <label class="field">Theme<select id="s-theme"><option value="dark">Dark</option><option value="light">Light</option></select></label></div>
      <p class="sub" id="rate" style="margin:16px 0 0"></p><div class="row" style="margin-top:16px"><button class="btn primary" id="save">Save settings</button></div>
      <p class="sub" style="margin:12px 0 0;font-size:12px">Pause, Resume and Stop are on the Dashboard. Resume re-verifies your Instagram login before anything continues.</p></div>`;
  $('#s-browserChannel', el).value = s.browserChannel; $('#s-theme', el).value = s.theme; $('#s-executionProfile', el).value = s.executionProfile;
  const rate = () => { const v = +$('#s-actionIntervalSec', el).value; $('#rate', el).textContent = Number.isFinite(v) && v > 0 ? `About ${fmtNum(perHour({ actionIntervalSec: v }))} accounts per hour at this interval.` : ''; };
  $('#s-executionProfile', el).addEventListener('change', e => { const p = PROFILES[e.target.value]; if (p) $('#s-actionIntervalSec', el).value = p.intervalSec; rate(); });
  $('#s-actionIntervalSec', el).addEventListener('input', () => { const m = Object.entries(PROFILES).find(([, p]) => p.intervalSec === +$('#s-actionIntervalSec', el).value); $('#s-executionProfile', el).value = m ? m[0] : 'custom'; rate(); });
  rate();
  $('#save', el).addEventListener('click', async () => {
    const body = {}; for (const k of ['actionIntervalSec', 'navigationTimeoutSec', 'elementTimeoutSec', 'maxAttempts', 'maxPerRun', 'errorThreshold']) body[k] = $(`#s-${k}`, el).value === '' ? NaN : Number($(`#s-${k}`, el).value);
    body.browserChannel = $('#s-browserChannel', el).value; body.theme = $('#s-theme', el).value;
    try { await post('/api/settings', body); await hooks.refresh(); toast('Settings saved', 'ok'); } catch (e) { toast(e.message, 'err'); }
  });
}

/* ---------------------------------------------------------------- Central Queue */
export function queueView(el) {
  el.innerHTML = `<h1>Automation Queue</h1><p class="sub">Central job queue enforcing the Single Mutating Worker rule. Every mutation requires explicit approval before execution.</p>
    <div class="card" id="q-panel" style="margin-bottom:18px">
      <div class="row" style="justify-content:space-between">
        <h2>Active Worker</h2>
        <span class="chip" id="q-worker-status"><span class="dot"></span>IDLE</span>
      </div>
      <div class="row" style="gap:8px;margin-top:12px">
        <button class="btn sm" id="q-pause">Pause Worker</button>
        <button class="btn sm primary" id="q-resume">Resume Worker</button>
        <button class="btn sm danger" id="q-stop">Stop Worker</button>
      </div>
    </div>
    <h2>Queued & Historical Jobs</h2>
    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Job Title</th>
            <th>Type</th>
            <th>Accounts</th>
            <th>Status</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="q-table"></tbody>
      </table>
    </div>
    <h2 style="margin-top:24px">Audit History</h2>
    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Action</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody id="q-audit"></tbody>
      </table>
    </div>`;

  const loadQueue = async () => {
    try {
      const q = await api('/api/queue');
      const audit = await api('/api/audit');
      const statusEl = $('#q-worker-status', el);
      if (statusEl) {
        statusEl.innerHTML = `<span class="dot ${q.isBusy ? 'ok' : ''}"></span>${q.isBusy ? 'RUNNING (Job ' + esc(q.activeJobId?.slice(0, 8)) + ')' : 'IDLE'}`;
      }
      const tbody = $('#q-table', el);
      if (tbody) {
        tbody.innerHTML = q.jobs.length ? q.jobs.map(j => `
          <tr>
            <td><b>${esc(j.title)}</b></td>
            <td><span class="chip">${esc(j.type)}</span></td>
            <td>${fmtNum(j.usernames.length)}</td>
            <td>${badge(j.status)}</td>
            <td class="muted">${fmtDate(j.createdAt)}</td>
            <td>
              ${j.status === 'QUEUED' ? `<button class="btn sm primary" data-approve="${esc(j.id)}">Approve</button>` : ''}
              ${j.status === 'QUEUED' || j.status === 'APPROVED' ? `<button class="btn sm ghost" data-cancel="${esc(j.id)}">Cancel</button>` : ''}
            </td>
          </tr>
        `).join('') : '<tr><td colspan="6" class="muted">Queue is empty.</td></tr>';
      }
      const abody = $('#q-audit', el);
      if (abody) {
        abody.innerHTML = audit.length ? audit.slice(0, 15).map(a => `
          <tr>
            <td class="muted">${fmtDate(a.timestamp)}</td>
            <td><b>${esc(a.action)}</b></td>
            <td><code>${esc(JSON.stringify(a))}</code></td>
          </tr>
        `).join('') : '<tr><td colspan="3" class="muted">No audit entries yet.</td></tr>';
      }
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  el.addEventListener('click', async e => {
    const t = e.target;
    if (t.id === 'q-pause') { await post('/api/queue/pause'); toast('Worker paused'); loadQueue(); }
    if (t.id === 'q-resume') { await post('/api/queue/resume'); toast('Worker resumed'); loadQueue(); }
    if (t.id === 'q-stop') { await post('/api/queue/stop'); toast('Worker stopped'); loadQueue(); }
    if (t.dataset.approve) {
      if (await confirmModal({ title: 'Approve Job Execution?', body: '<p>This will authorize the job to execute sequentially on your Instagram session.</p>', confirmText: 'Approve & Execute' })) {
        await post('/api/queue/approve', { jobId: t.dataset.approve });
        toast('Job approved', 'ok');
        loadQueue();
      }
    }
    if (t.dataset.cancel) {
      await post('/api/queue/cancel', { jobId: t.dataset.cancel });
      toast('Job cancelled');
      loadQueue();
    }
  });

  loadQueue();
  return { onEngine: loadQueue, onData: loadQueue };
}

/* ---------------------------------------------------------------- Followers Intelligence */
export function intelligenceView(el) {
  el.innerHTML = `<h1>Followers Intelligence</h1><p class="sub">Deep relationship analytics, conversion ratios, and audience segmentation calculated from your verified export files.</p>
    <div class="grid kpis" id="intel-kpis" style="margin-bottom:20px"></div>
    <div class="grid two">
      <div class="card">
        <h2>Audience Conversion &amp; Ratios</h2>
        <div id="intel-ratios" style="line-height:2"></div>
      </div>
      <div class="card">
        <h2>Outgoing Pending Requests by Year</h2>
        <div id="intel-years"></div>
      </div>
    </div>
    <div class="card" style="margin-top:18px" id="intel-post-analytics">
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <h2>Post &amp; Engagement Intelligence</h2>
        <a class="btn sm" href="#/archive">Open Post Archive &rarr;</a>
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px" id="intel-post-kpis"></div>
    </div>
    <div class="card" style="margin-top:18px">
      <h2>Strategic Recommendations</h2>
      <ul id="intel-recs" style="padding-left:20px;line-height:1.8"></ul>
    </div>`;

  const loadIntel = async () => {
    try {
      const d = await api('/api/intelligence');
      const s = d.summary;
      const kpis = $('#intel-kpis', el);
      if (kpis) {
        kpis.innerHTML =
          kpiCard('Mutual Followers', s.mutual) +
          kpiCard('Loyal Fans', s.fans) +
          kpiCard("Don't Follow Back", s.nonFollowers) +
          kpiCard('Pending Requests Sent', s.pendingSent) +
          kpiCard('Account Health', d.healthGrade);
      }
      const ratios = $('#intel-ratios', el);
      if (ratios) {
        ratios.innerHTML = `
          <div><b>Follow-Back Conversion:</b> ${d.ratios.followBackPercentage}% (Mutual / Following)</div>
          <div><b>Fan Loyalty Ratio:</b> ${d.ratios.fanPercentage}% (Fans / Followers)</div>
          <div><b>Non-Follower Ratio:</b> ${d.ratios.nonFollowerPercentage}% (Unreciprocated / Following)</div>
          <div><b>Follower Health Ratio:</b> ${d.ratios.followerHealthRatio}x (Followers / Following)</div>
        `;
      }
      const years = $('#intel-years', el);
      if (years) {
        const dist = d.pendingYearDistribution || {};
        const entries = Object.entries(dist).sort(([a], [b]) => a.localeCompare(b));
        years.innerHTML = entries.length ? `
          <div class="tablewrap">
            <table>
              <thead><tr><th>Year</th><th>Requests Sent</th><th>Priority</th></tr></thead>
              <tbody>${entries.map(([y, count], i) => `<tr><td><b>${esc(y)}</b></td><td>${fmtNum(count)}</td><td><span class="chip">${i === 0 ? 'Highest (Oldest)' : 'Pending'}</span></td></tr>`).join('')}</tbody>
            </table>
          </div>
        ` : '<p class="muted">No outgoing pending requests.</p>';
      }
      const pk = $('#intel-post-kpis', el);
      if (pk) {
        const pa = store.data.postArchive || {};
        pk.innerHTML = `
          <div class="card kpi" style="margin:0"><div class="label">Synced Posts</div><div class="value">${fmtNum(pa.total || 0)}</div></div>
          <div class="card kpi" style="margin:0"><div class="label">Total Likes</div><div class="value" style="color:#FF5E7E">${fmtNum(pa.totalLikes || 0)}</div></div>
          <div class="card kpi" style="margin:0"><div class="label">Total Comments</div><div class="value" style="color:#4DAFFF">${fmtNum(pa.totalComments || 0)}</div></div>
          <div class="card kpi" style="margin:0"><div class="label">Avg Likes / Post</div><div class="value">${fmtNum(pa.avgLikes || 0)}</div></div>
          <div class="card kpi" style="margin:0"><div class="label">Avg Comments / Post</div><div class="value">${fmtNum(pa.avgComments || 0)}</div></div>
        `;
      }
      const recs = $('#intel-recs', el);
      if (recs) {
        recs.innerHTML = d.recommendations.map(r => `<li>${esc(r)}</li>`).join('');
      }
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  loadIntel();
  return { onData: loadIntel };
}

/* ---------------------------------------------------------------- Instagram Analytics */
export function analyticsView(el) {
  return intelligenceView(el);
}

/* ---------------------------------------------------------------- Post Archive Manager */
export function postArchiveView(el) {
  el.innerHTML = `
    <div class="row" style="justify-content:space-between;margin-bottom:8px">
      <div>
        <h1>Post Archive &amp; Analytics</h1>
        <p class="sub">Safely inspect, analyze engagement (likes &amp; comments), and archive published posts from your verified Instagram profile.</p>
      </div>
      <div>
        <button class="btn primary" id="sync-posts-btn">${icon('sparkles', 15)} Sync from Instagram</button>
      </div>
    </div>

    <div class="grid kpis" id="arch-kpis">
      <div class="card kpi"><div class="label">Total Posts</div><div class="value" id="k-p-total">0</div></div>
      <div class="card kpi"><div class="label">Active Posts</div><div class="value" id="k-p-active">0</div></div>
      <div class="card kpi"><div class="label">Archived Posts</div><div class="value" id="k-p-arch">0</div></div>
      <div class="card kpi"><div class="label">Total Likes</div><div class="value" id="k-p-likes" style="color:#FF5E7E">0</div></div>
      <div class="card kpi"><div class="label">Total Comments</div><div class="value" id="k-p-comments" style="color:#4DAFFF">0</div></div>
      <div class="card kpi"><div class="label">Avg Likes / Post</div><div class="value" id="k-p-avg">0</div></div>
    </div>

    <div class="toolbar" style="margin-top:16px">
      <input type="search" id="p-q" placeholder="Search caption or post ID..." style="max-width:280px" aria-label="Search posts">
      <select id="p-st" aria-label="Filter post status">
        <option value="">All statuses</option>
        <option value="ACTIVE">Active only</option>
        <option value="ARCHIVED">Archived only</option>
      </select>
      <select id="p-sort" aria-label="Sort posts">
        <option value="postedAt_desc">Newest First</option>
        <option value="likes_desc">Most Likes ❤️</option>
        <option value="comments_desc">Most Comments 💬</option>
        <option value="postedAt_asc">Oldest First</option>
      </select>
    </div>

    <div class="tablewrap" style="margin-top:14px">
      <table>
        <thead>
          <tr>
            <th style="width:54px">Media</th>
            <th>Post Link</th>
            <th>Engagement</th>
            <th>Caption</th>
            <th>Type</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody id="arch-table"></tbody>
      </table>
    </div>`;

  let filter = { q: '', status: '', sort: 'postedAt', dir: 'desc' };

  const loadPosts = async () => {
    try {
      const res = await api(`/api/posts?${new URLSearchParams(filter)}`);
      const s = res.summary || store.data.postArchive || {};
      $('#k-p-total', el).textContent = fmtNum(s.total || 0);
      $('#k-p-active', el).textContent = fmtNum(s.active || 0);
      $('#k-p-arch', el).textContent = fmtNum(s.archived || 0);
      $('#k-p-likes', el).textContent = fmtNum(s.totalLikes || 0);
      $('#k-p-comments', el).textContent = fmtNum(s.totalComments || 0);
      $('#k-p-avg', el).textContent = fmtNum(s.avgLikes || 0);

      const tb = $('#arch-table', el);
      if (tb) {
        tb.innerHTML = res.posts.length ? res.posts.map(p => `
          <tr>
            <td>
              ${p.thumbnailUrl ? `<img class="post-thumb" src="${esc(p.thumbnailUrl)}" alt="thumb" loading="lazy" onerror="this.style.display='none'">` : '<div class="post-thumb" style="display:grid;place-items:center;color:var(--muted)">📷</div>'}
            </td>
            <td><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer"><b>#${esc(p.id)}</b></a></td>
            <td>
              <div class="row" style="gap:6px">
                <span class="post-stat-pill likes" title="Total Likes">❤️ ${fmtNum(p.likeCount || 0)}</span>
                <span class="post-stat-pill comments" title="Total Comments">💬 ${fmtNum(p.commentCount || 0)}</span>
              </div>
            </td>
            <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.caption || '')}">${esc(p.caption || '—')}</td>
            <td><span class="chip">${esc(p.mediaType || 'IMAGE')}</span></td>
            <td>${badge(p.status)}</td>
            <td>
              ${p.status === 'ACTIVE' ? `<button class="btn sm danger-ghost" data-arch="${esc(p.id)}">Archive</button>` : ''}
              <a class="btn sm ghost" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">View</a>
            </td>
          </tr>
        `).join('') : `<tr><td colspan="7"><div class="empty"><h2>No posts found</h2>Click <b>Sync from Instagram</b> above to sync your profile posts and engagement metrics.</div></td></tr>`;
      }
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  $('#p-q', el).addEventListener('input', debounce(e => { filter.q = e.target.value; loadPosts(); }, 250));
  $('#p-st', el).addEventListener('change', e => { filter.status = e.target.value; loadPosts(); });
  $('#p-sort', el).addEventListener('change', e => {
    const [s, d] = e.target.value.split('_');
    filter.sort = s; filter.dir = d || 'desc';
    loadPosts();
  });

  $('#sync-posts-btn', el).addEventListener('click', async () => {
    const btn = $('#sync-posts-btn', el);
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Syncing...';
    try {
      toast('Connecting to Instagram browser and syncing posts...', 'info');
      const res = await post('/api/profile/sync');
      toast(`Profile synced! Ingested ${res.postsCount || 0} posts with likes and comments.`, 'ok');
      await hooks.refresh();
      loadPosts();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  });

  el.addEventListener('click', async e => {
    if (e.target.dataset.arch) {
      const pid = e.target.dataset.arch;
      if (await confirmModal({ title: `Archive post #${pid}?`, body: '<p>The post will be safely moved to your Instagram Archive. It will never be deleted.</p>', confirmText: 'Archive Post' })) {
        await post('/api/posts/archive', { postId: pid, confirm: true });
        toast(`Post #${pid} queued for archive`, 'ok');
        loadPosts();
      }
    }
  });

  loadPosts();
  return { onData: loadPosts };
}

/* ---------------------------------------------------------------- Stories & Highlights */
export function storiesHighlightsView(el) {
  el.innerHTML = `<h1>Stories & Highlights</h1><p class="sub">Inspect story activity, view archives, and highlight collections from your Instagram account.</p>
    <div class="grid two">
      <div class="card">
        <h2>Highlights Collections</h2>
        <div id="hl-list" class="tablewrap"></div>
      </div>
      <div class="card">
        <h2>Story Archive</h2>
        <div id="st-list" class="tablewrap"></div>
      </div>
    </div>`;

  const loadData = async () => {
    try {
      const hl = await api('/api/highlights');
      const st = await api('/api/stories');
      const hlEl = $('#hl-list', el);
      if (hlEl) {
        hlEl.innerHTML = hl.length ? `
          <table>
            <thead><tr><th>Title</th><th>Items</th><th>Created</th></tr></thead>
            <tbody>${hl.map(h => `<tr><td><b>${esc(h.title)}</b></td><td>${h.itemCount} items</td><td class="muted">${fmtDate(h.createdAt)}</td></tr>`).join('')}</tbody>
          </table>
        ` : '<p class="muted">No highlights imported yet.</p>';
      }
      const stEl = $('#st-list', el);
      if (stEl) {
        stEl.innerHTML = st.stories.length ? `
          <table>
            <thead><tr><th>Date</th><th>Type</th></tr></thead>
            <tbody>${st.stories.map(s => `<tr><td>${fmtDate(s.date)}</td><td>${esc(s.type)}</td></tr>`).join('')}</tbody>
          </table>
        ` : '<p class="muted">No story records found.</p>';
      }
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  loadData();
  return { onData: loadData };
}
