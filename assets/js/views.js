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
      <a class="quick-pill" href="#/import-data" style="color:var(--accent);font-weight:600">${icon('zap', 14)} ⚡ Live Browser Sync</a>
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
      <select id="st" aria-label="Filter by status">
        <option value="">All statuses</option>
        <option value="WHITELISTED" ${st.status === 'WHITELISTED' ? 'selected' : ''}>⭐ Protected (Whitelisted)</option>
        <option value="VERIFIED" ${st.status === 'VERIFIED' ? 'selected' : ''}>🔵 Verified Accounts (Blue Tick)</option>
        <option value="HIGH_AUTHORITY" ${st.status === 'HIGH_AUTHORITY' ? 'selected' : ''}>👑 High Authority (Ratio &gt; 10x)</option>
        <option value="ABOVE_10K" ${st.status === 'ABOVE_10K' ? 'selected' : ''}>🔥 Followers &gt; 10K</option>
        <option value="ABOVE_50K" ${st.status === 'ABOVE_50K' ? 'selected' : ''}>🌟 Mega Influencers &gt; 50K</option>
        <option value="UNFOLLOWED_YOU" ${st.status === 'UNFOLLOWED_YOU' ? 'selected' : ''}>🚨 Unfollowed You (Export Diff)</option>
        <option value="NEW_FOLLOWER" ${st.status === 'NEW_FOLLOWER' ? 'selected' : ''}>🎉 New Followers (Export Diff)</option>
        <option value="GHOST_FOLLOWER" ${st.status === 'GHOST_FOLLOWER' ? 'selected' : ''}>👻 Suspected Ghost Followers</option>
        ${statuses.map(s => `<option value="${s}" ${st.status === s ? 'selected' : ''}>${label(s)}</option>`).join('')}
      </select>
      ${requests ? `<select id="age-sel" aria-label="Retention Policy">
        <option value="" ${!st.age ? 'selected' : ''}>All Request Ages</option>
        <option value="30d" ${st.age === '30d' ? 'selected' : ''}>⏳ Older than 30 Days</option>
        <option value="90d" ${st.age === '90d' ? 'selected' : ''}>⏳ Older than 90 Days</option>
        <option value="180d" ${st.age === '180d' ? 'selected' : ''}>⏳ Older than 6 Months</option>
        <option value="365d" ${st.age === '365d' ? 'selected' : ''}>⏳ Older than 1 Year</option>
      </select>` : ''}
      ${requests ? `<select id="sort-sel" aria-label="Sort order">
        <option value="oldest" ${st.sort === 'requestedAt' && st.dir === 'asc' ? 'selected' : ''}>Oldest First (Default)</option>
        <option value="newest" ${st.sort === 'requestedAt' && st.dir === 'desc' ? 'selected' : ''}>Newest First</option>
        <option value="user_asc" ${st.sort === 'username' && st.dir === 'asc' ? 'selected' : ''}>Username A–Z</option>
        <option value="user_desc" ${st.sort === 'username' && st.dir === 'desc' ? 'selected' : ''}>Username Z–A</option>
      </select>` : ''}
      <select id="sz" aria-label="Page size">${[25, 50, 100, 200].map(n => `<option ${st.size === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
      ${requests && outgoing ? `<button class="btn sm danger" id="btn-cancel-retention" title="1-Click Auto-Cancellation Rule: Cancel all pending requests older than 90 days">⚡ Cancel &gt; 90 Days</button>` : ''}
      ${selectable ? `<span class="chip" id="selc"></span>
        <button class="btn sm" data-s="page">Select page</button><button class="btn sm" data-s="filtered">Select all filtered</button>
        <button class="btn sm" data-s="pending">${requests ? 'Select all pending' : 'Select pending only'}</button>
        <button class="btn sm primary" data-s="whitelist" title="Add all selected accounts to Protected Whitelist">${icon('shield', 13)} Whitelist selected</button>
        <button class="btn sm ghost" data-s="unwhitelist" title="Remove selected accounts from Protected Whitelist">Un-whitelist</button>
        <button class="btn sm ghost" data-s="clear">Clear</button>` : ''}
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
  const qs = extra => new URLSearchParams({ list: st.list, q: st.q, status: st.status, age: st.age || '', sort: st.sort, dir: st.dir, page: st.page, size: st.size, ...extra });
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
      const wlList = store.data?.whitelist || [];
      tb.innerHTML = rows.map(r => {
        const isWl = r.whitelisted || wlList.includes(r.username.toLowerCase());
        const starBtn = `<button class="star-btn ${isWl ? 'active' : ''}" data-star="${esc(r.username)}" title="${isWl ? 'Protected in Whitelist - Click to unprotect' : 'Click to star / protect in Whitelist'}" aria-label="Star / Whitelist">${icon('star', 15)}</button>`;
        const verifiedBadge = r.isVerified ? `<span class="chip" style="color:#0284c7;border-color:rgba(2,132,199,0.3);background:rgba(2,132,199,0.08);padding:1px 5px;font-size:10px;margin-left:3px" title="Verified Creator (Blue Tick)">🔵 Verified</span>` : '';
        const followersBadge = (r.followersText || r.followersCount) ? `<span class="chip" style="padding:1px 5px;font-size:10px;margin-left:3px" title="${fmtNum(r.followersCount)} followers">👥 ${esc(r.followersText || (r.followersCount >= 1e6 ? (r.followersCount/1e6).toFixed(1)+'M' : r.followersCount >= 1e3 ? (r.followersCount/1e3).toFixed(1)+'K' : r.followersCount))}</span>` : '';
        const authorityBadge = (r.authorityRatio && r.authorityRatio > 0) ? `<span class="chip ${r.authorityRatio >= 10 ? 'ok' : ''}" style="padding:1px 5px;font-size:10px;margin-left:3px;${r.authorityRatio >= 10 ? 'font-weight:bold;border-color:gold;' : ''}" title="Authority Ratio: ${r.authorityRatio.toFixed(1)}x">👑 ${r.authorityRatio.toFixed(1)}x</span>` : '';
        const ghostBadge = r.isGhostFollower ? `<span class="chip" style="color:#eab308;border-color:rgba(234,179,8,0.3);background:rgba(234,179,8,0.08);padding:1px 5px;font-size:10px;margin-left:3px" title="Suspected Ghost Follower (Mass-following >1.5K or bot ratio)">👻 Ghost</span>` : '';
        return `<tr>
        ${selectable ? `<td><input type="checkbox" data-u="${esc(r.username)}" ${sel.has(r.username) ? 'checked' : ''} aria-label="Select ${esc(r.username)}"></td>` : ''}
        ${requests ? `
          <td>${starBtn} <a href="${profile(r.username)}" target="_blank" rel="noopener noreferrer">@${esc(r.username)}</a>${verifiedBadge}${followersBadge}${authorityBadge}${ghostBadge}${isWl ? ` <span class="chip ok" style="padding:1px 5px;font-size:10px;margin-left:3px">⭐ Protected</span>` : ''}</td>
          <td>${esc(r.displayName || '—')}</td>
          <td class="muted">${fmtDate(r.requestedAt)}</td>
          <td><span class="chip" title="${esc(r.requestedAt ? new Date(r.requestedAt).toLocaleString() : '')}">${formatAge(r.requestedAt)}</span></td>
          <td>${esc(r.relationship || 'Request pending')}</td>
          <td>${badge(r.status)} <span class="muted">${esc(r.requestStatus)}</span></td>
          <td class="muted">${fmtDate(r.lastAttemptAt)}</td>
          <td>${outgoing ? `<button class="btn sm" data-c="${esc(r.username)}" ${['CANCELLED', 'ALREADY_CANCELLED', 'ACCEPTED', 'PROFILE_UNAVAILABLE'].includes(r.status) || isWl ? 'disabled' : ''} title="${isWl ? 'Protected: cannot cancel' : ''}">Cancel request</button>` : ''}
              <a class="btn sm ghost" href="${profile(r.username)}" target="_blank" rel="noopener noreferrer">Open</a>
              ${r.reason || r.screenshot ? `<button class="btn sm ghost" data-i="${esc(r.username)}">Inspect</button>` : ''}</td>
        ` : `
          <td>${starBtn} <a href="${profile(r.username)}" target="_blank" rel="noopener noreferrer">@${esc(r.username)}</a>${verifiedBadge}${followersBadge}${authorityBadge}${ghostBadge}${isWl ? ` <span class="chip ok" style="padding:1px 5px;font-size:10px;margin-left:3px">⭐ Protected</span>` : ''}</td>
          <td>${esc(r.relationship)}</td><td class="muted">${esc(r.accountStatus)}</td><td>${badge(r.status)}</td>
          <td class="muted">${fmtDate(r.lastAttemptAt)}</td>
          <td>
            ${['Mutual', 'Not following back', 'Following'].includes(r.relationship) ? `<button class="btn sm danger-ghost" data-unfollow="${esc(r.username)}" ${['UNFOLLOWED', 'ALREADY_UNFOLLOWED'].includes(r.status) || isWl ? 'disabled' : ''} title="${isWl ? 'Protected: cannot unfollow' : ''}">Unfollow</button>` : ''}
            ${r.relationship === 'Follows you only' ? `<button class="btn sm primary-ghost" data-follow="${esc(r.username)}">Follow</button>` : ''}
            <a class="btn sm ghost" href="${profile(r.username)}" target="_blank" rel="noopener noreferrer">Open</a>
            ${r.reason || r.screenshot ? `<button class="btn sm ghost" data-i="${esc(r.username)}">Inspect</button>` : ''}
          </td>
        `}
      </tr>`;
      }).join('');
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
  const ageSel = $('#age-sel', el);
  if (ageSel) {
    ageSel.addEventListener('change', e => {
      st.age = e.target.value;
      reload();
    });
  }
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
  const btnCancelRetention = $('#btn-cancel-retention', el);
  if (btnCancelRetention) {
    btnCancelRetention.addEventListener('click', async () => {
      const days = st.age === '30d' ? 30 : st.age === '180d' ? 180 : st.age === '365d' ? 365 : 90;
      let prev;
      try {
        prev = await api(`/api/cancel/preview?olderThanDays=${days}`);
      } catch (e) {
        toast('Failed to load cancellation preview: ' + e.message, 'err');
        return;
      }
      if (!prev || prev.eligible === 0) {
        toast(`No pending requests older than ${days} days found to cancel!`, 'ok');
        return;
      }
      if (!await confirmModal({
        title: `Auto-Cancellation Rule: Cancel requests older than ${days} days?`,
        danger: true,
        confirmText: `Confirm Cancel ${fmtNum(prev.eligible)} Requests`,
        body: `<p>This will start background cancellation for all <b>${fmtNum(prev.eligible)}</b> pending requests older than <b>${days} days</b> (processed oldest first).</p><p>Accounts in your Protected Whitelist will never be touched.</p>`
      })) return;
      try {
        await post('/api/run/start', { mode: 'cancel', all: true, olderThanDays: days, confirm: true, order: 'oldest' });
        toast(`Auto-cancellation started for ${fmtNum(prev.eligible)} requests (> ${days}d)`, 'ok');
        await hooks.refresh();
      } catch (e) {
        toast(e.message, 'err');
      }
    });
  }
  el.addEventListener('click', async ev => {
    const starBtn = ev.target.closest('[data-star]');
    if (starBtn) {
      const u = starBtn.dataset.star;
      try {
        await post('/api/whitelist/toggle', { username: u });
        const list = await api('/api/whitelist');
        if (store.data) store.data.whitelist = list;
        const nowProtected = list.includes(u.toLowerCase());
        toast(nowProtected ? `⭐ @${u} added to Protected Whitelist` : `Removed @${u} from Whitelist`, 'ok');
        const row = rows.find(x => x.username.toLowerCase() === u.toLowerCase());
        if (row) row.whitelisted = nowProtected;
        draw();
        await hooks.refresh();
      } catch (e) {
        toast(e.message, 'err');
      }
      return;
    }
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
    if (s === 'whitelist') {
      if (!sel.size) { toast('Please select at least one account first.', 'warn'); return; }
      const list = Array.from(sel);
      try {
        const res = await post('/api/whitelist/add', { usernames: list });
        const updated = await api('/api/whitelist');
        if (store.data) store.data.whitelist = updated;
        toast(`⭐ Added ${fmtNum(res.addedCount || list.length)} accounts to Protected Whitelist`, 'ok');
        rows.forEach(r => { if (sel.has(r.username)) r.whitelisted = true; });
        draw();
        await hooks.refresh();
      } catch (e) {
        toast(e.message, 'err');
      }
      return;
    }
    if (s === 'unwhitelist') {
      if (!sel.size) { toast('Please select at least one account first.', 'warn'); return; }
      const list = Array.from(sel);
      try {
        await post('/api/whitelist/remove', { usernames: list });
        const updated = await api('/api/whitelist');
        if (store.data) store.data.whitelist = updated;
        toast(`Removed ${fmtNum(list.length)} accounts from Protected Whitelist`, 'ok');
        rows.forEach(r => { if (sel.has(r.username)) r.whitelisted = false; });
        draw();
        await hooks.refresh();
      } catch (e) {
        toast(e.message, 'err');
      }
      return;
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
    <div class="row" style="margin-bottom:14px;gap:8px">
      <a class="btn primary" href="/api/export/csv" download="nofollow-actions-export.csv">${icon('download', 14)} Export Actions History (CSV)</a>
      <a class="btn ghost" href="/api/report" download="nofollow-error-report.json">${icon('download', 14)} Download Error Report (JSON)</a>
    </div>
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
  el.innerHTML = `<h1>Import &amp; Export Tracker</h1><p class="sub">Sync your followers and following directly from your live Instagram browser session, or select export files from <code>connections\\followers_and_following</code>. <b>Your Protected Whitelist and VIP Scanner data are preserved automatically.</b></p>

    <!-- ⚡ Live In-Browser Session Sync (Skip Manual Export) -->
    <div class="card" style="margin-bottom:24px;border-left:4px solid var(--accent);background:linear-gradient(135deg,var(--surface-1),var(--surface-2))">
      <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:8px">
        <div>
          <h2 style="display:flex;align-items:center;gap:8px">${icon('zap', 18)} ⚡ Live In-Browser Extraction (Skip Manual Exports!)</h2>
          <p class="sub" style="margin-bottom:0">Automatically pull your live Followers and Following directly from your active Instagram browser session in seconds. <b>Zero ZIP files, zero manual downloads.</b></p>
        </div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <span class="chip ok">${icon('sparkles', 12)} Direct Session Friendships API</span>
          <span class="chip">${icon('shield', 12)} Whitelist Preserved</span>
        </div>
      </div>

      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:14px 0">
        <label class="field">Pacing Delay (Safety)
          <select id="live-sync-delay">
            <option value="250">⚡ Fast (250ms - Quick Sync)</option>
            <option value="350" selected>🚀 Balanced (350ms - Default)</option>
            <option value="600">🛡️ Safe Stealth (600ms)</option>
          </select>
        </label>
        <label class="field">Limit / Scope
          <select id="live-sync-scope">
            <option value="0" selected>Full List (All accounts)</option>
            <option value="1000">First 1,000 accounts</option>
            <option value="2500">First 2,500 accounts</option>
          </select>
        </label>
      </div>

      <div class="row" style="gap:10px;margin-top:12px;flex-wrap:wrap">
        <button class="btn primary" id="btn-live-sync-start">${icon('refresh', 14)} ⚡ Start Live Sync from Instagram</button>
        <button class="btn danger" id="btn-live-sync-stop" disabled>${icon('ban', 14)} Stop Sync</button>
      </div>

      <!-- Live Progress Box -->
      <div id="live-sync-box" style="margin-top:14px;display:none;background:var(--surface-3);padding:12px;border-radius:var(--radius-sm);border:1px solid var(--border)">
        <div class="row" style="justify-content:space-between;margin-bottom:6px">
          <span id="live-sync-label" style="font-weight:600">Connecting to browser session...</span>
          <span class="chip" id="live-sync-chip">0 / 0</span>
        </div>
        <div style="background:var(--surface-2);border-radius:999px;height:8px;overflow:hidden">
          <div id="live-sync-bar" style="background:var(--accent);height:100%;width:0%;transition:width 0.3s"></div>
        </div>
      </div>
    </div>

    <div class="sep" style="margin:24px 0;text-align:center;font-weight:600;color:var(--muted)">— OR IMPORT OFFLINE INSTAGRAM EXPORT FILES —</div>

    <div class="drop" id="drop"><p><b>Drop files here</b> or</p><input type="file" id="files" multiple accept=".json,.html"><p style="margin-bottom:0">Pick <b>followers_1</b> (and followers_2… if present) and <b>following</b>. Other files are optional.</p></div>
    <div id="picked" style="margin-top:14px"></div><div class="row" style="margin-top:14px"><button class="btn primary" id="go" disabled>Import selected files</button></div>
    <div id="diff-box" style="margin-top:18px"></div>
    <div id="res" style="margin-top:18px"></div>`;
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

  const renderDiff = (diff) => {
    const box = $('#diff-box', el);
    if (!box) return;
    if (!diff || !diff.stats) {
      box.innerHTML = '';
      return;
    }
    const st = diff.stats;
    const netClass = st.netFollowerChange > 0 ? 'color:var(--ok)' : st.netFollowerChange < 0 ? 'color:var(--bad)' : '';
    const netSign = st.netFollowerChange > 0 ? '+' : '';

    box.innerHTML = `
      <div class="card" style="border-left:4px solid var(--accent);margin-bottom:18px">
        <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px">
          <h2>🚨 "Who Unfollowed Me" &amp; Follower Changes</h2>
          <span class="chip ok">Export Difference Engine</span>
        </div>
        <p class="sub" style="margin-bottom:14px">Detected automatically by comparing your new export (${fmtDate(diff.newImportAt)}) against your previous export (${fmtDate(diff.previousImportAt)}):</p>
        <div class="grid kpis" style="margin-bottom:16px">
          ${kpiCard('🚨 Unfollowed You', st.lostCount, 'diff-kpi-lost')}
          ${kpiCard('🎉 New Followers', st.gainedCount, 'diff-kpi-gained')}
          ${kpiCard('👥 You Unfollowed', st.unfollowedByYouCount, 'diff-kpi-unf')}
          <div class="card kpi"><div class="label">📈 Net Follower Growth</div><div class="value" style="${netClass}">${netSign}${fmtNum(st.netFollowerChange)}</div></div>
        </div>

        <div class="row" style="gap:10px;margin-bottom:14px;flex-wrap:wrap">
          ${st.stillFollowingLostCount > 0 ? `<button class="btn danger" id="btn-diff-unfollow-lost">${icon('userx', 14)} ⚡ Unfollow People Who Unfollowed You (${fmtNum(st.stillFollowingLostCount)})</button>` : ''}
          ${st.gainedCount > 0 ? `<button class="btn primary-ghost" id="btn-diff-whitelist-new">${icon('shield', 14)} ⭐ Whitelist All New Followers (${fmtNum(st.gainedCount)})</button>` : ''}
          <a class="btn ghost" href="/api/export/diff/csv" download="who-unfollowed-me-diff.csv">${icon('download', 14)} Download Diff CSV</a>
          <a class="btn ghost" href="#/followers?status=UNFOLLOWED_YOU">${icon('users', 14)} View Lost Followers in Table</a>
        </div>

        ${diff.lostFollowers?.length ? `
          <div style="margin-top:12px">
            <h3 style="font-size:13.5px;margin-bottom:8px">Accounts that unfollowed you (${fmtNum(diff.lostFollowers.length)}):</h3>
            <div class="row" style="gap:6px;flex-wrap:wrap;max-height:160px;overflow-y:auto;padding:8px;background:var(--surface-2);border-radius:var(--radius-sm)">
              ${diff.lostFollowers.map(u => `
                <span class="chip" style="font-size:12px">
                  <a href="https://www.instagram.com/${esc(u)}/" target="_blank" rel="noopener noreferrer">@${esc(u)}</a>
                  ${diff.stillFollowingLost?.includes(u) ? `<span style="color:var(--bad);margin-left:4px" title="You still follow them!">(you follow)</span>` : ''}
                </span>
              `).join('')}
            </div>
          </div>
        ` : '<p class="muted" style="margin-top:8px">No lost followers detected between these exports.</p>'}
      </div>
    `;

    const btnUnfollowLost = $('#btn-diff-unfollow-lost', el);
    if (btnUnfollowLost) {
      btnUnfollowLost.addEventListener('click', async () => {
        if (!await confirmModal({
          title: `Unfollow ${st.stillFollowingLostCount} accounts that unfollowed you?`,
          danger: true,
          confirmText: `Confirm Unfollow (${st.stillFollowingLostCount})`,
          body: `<p>These <b>${st.stillFollowingLostCount}</b> accounts were in your followers list previously, but are no longer following you. You still follow them.</p><p>Accounts in your Protected Whitelist will not be touched.</p>`
        })) return;
        try {
          await post('/api/run/start', { mode: 'unfollow', list: 'diffStillFollowing', confirm: true });
          toast(`Started unfollowing ${st.stillFollowingLostCount} accounts who unfollowed you`, 'ok');
          await hooks.refresh();
        } catch (e) {
          toast(e.message, 'err');
        }
      });
    }

    const btnWlNew = $('#btn-diff-whitelist-new', el);
    if (btnWlNew) {
      btnWlNew.addEventListener('click', async () => {
        try {
          const res = await post('/api/whitelist/add', { usernames: diff.gainedFollowers });
          toast(`⭐ Protected ${fmtNum(res.addedCount || diff.gainedFollowers.length)} new followers in Whitelist`, 'ok');
          await hooks.refresh();
        } catch (e) {
          toast(e.message, 'err');
        }
      });
    }
  };

  api('/api/export/diff').then(d => {
    if (d?.latest) renderDiff(d.latest);
  }).catch(() => {});

  $('#go', el).addEventListener('click', async () => {
    const btn = $('#go', el); btn.disabled = true; btn.textContent = 'Importing…';
    try {
      for (const f of files.filter(f => KNOWN.test(f.name))) await api(`/api/import/file?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: await f.text() });
      const s = await post('/api/import/commit');
      await hooks.refresh();
      if (s.latestDiff) renderDiff(s.latestDiff);
      $('#res', el).innerHTML = `${s.warnings.map(w => `<div class="notice ${/INCOMPLETE|No followers|No following/.test(w) ? 'bad' : ''}">${esc(w)}</div>`).join('') || '<div class="notice ok">Export looks complete.</div>'}
        <div class="card">
          <p style="font-size:14px;margin-bottom:8px"><b>${fmtNum(s.totals.following)}</b> following · <b>${fmtNum(s.totals.followers)}</b> followers · <b>${fmtNum(s.totals.nonFollowers)}</b> don't follow back · <b>${fmtNum(s.totals.mutual)}</b> mutual</p>
          <div class="row" style="gap:8px;margin-bottom:12px;flex-wrap:wrap">
            <span class="chip ok">⭐ Protected Whitelist: ${fmtNum(s.whitelistCount || 0)} accounts preserved</span>
            <span class="chip ok">👥 VIP Scanner Intelligence: ${fmtNum(s.scannedProfilesCount || 0)} profiles preserved</span>
          </div>
          <div><a class="btn primary" href="#/non-followers">Review non-followers</a></div>
        </div>`;
      toast('Import complete: Whitelist, VIP Scanner data, and Follower Changes tracked', 'ok');
    } catch (e) { toast(e.message, 'err'); } finally { btn.textContent = 'Import selected files'; btn.disabled = false; }
  });

  const updateLiveSyncUI = (snap) => {
    if (!snap) return;
    const startBtn = $('#btn-live-sync-start', el);
    const stopBtn = $('#btn-live-sync-stop', el);
    const box = $('#live-sync-box', el);
    const lbl = $('#live-sync-label', el);
    const chip = $('#live-sync-chip', el);
    const bar = $('#live-sync-bar', el);

    if (snap.active) {
      if (startBtn) startBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;
      if (box) box.style.display = 'block';

      if (snap.phase === 'INIT') {
        if (lbl) lbl.textContent = 'Resolving logged-in Instagram account & relationship totals...';
        if (chip) chip.textContent = 'Initializing...';
        if (bar) bar.style.width = '10%';
      } else if (snap.phase === 'FOLLOWING') {
        if (lbl) lbl.textContent = `Extracting Following: ${fmtNum(snap.processedFollowing)} / ${fmtNum(snap.totalFollowing)} accounts`;
        if (chip) chip.textContent = `${fmtNum(snap.processedFollowing)} / ${fmtNum(snap.totalFollowing)}`;
        const pct = snap.totalFollowing > 0 ? Math.round((snap.processedFollowing / snap.totalFollowing) * 45) : 25;
        if (bar) bar.style.width = `${pct}%`;
      } else if (snap.phase === 'FOLLOWERS') {
        if (lbl) lbl.textContent = `Extracting Followers: ${fmtNum(snap.processedFollowers)} / ${fmtNum(snap.totalFollowers)} accounts`;
        if (chip) chip.textContent = `${fmtNum(snap.processedFollowers)} / ${fmtNum(snap.totalFollowers)}`;
        const pct = snap.totalFollowers > 0 ? 50 + Math.round((snap.processedFollowers / snap.totalFollowers) * 45) : 75;
        if (bar) bar.style.width = `${pct}%`;
      } else if (snap.phase === 'INGESTING') {
        if (lbl) lbl.textContent = 'Calculating relationship sets & Who Unfollowed You diff...';
        if (chip) chip.textContent = 'Computing diff...';
        if (bar) bar.style.width = '95%';
      }
    } else {
      if (startBtn) startBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
      if (snap.phase === 'COMPLETED') {
        if (lbl) lbl.textContent = `Live Sync Completed: ${fmtNum(snap.processedFollowing)} following and ${fmtNum(snap.processedFollowers)} followers extracted!`;
        if (bar) bar.style.width = '100%';
      } else if (snap.phase === 'FAILED') {
        if (lbl) lbl.textContent = `Live Sync Failed: ${snap.error || 'Unknown error'}`;
      }
    }
  };

  $('#btn-live-sync-start', el)?.addEventListener('click', async () => {
    const delayMs = +$('#live-sync-delay', el)?.value || 350;
    const scope = +$('#live-sync-scope', el)?.value || 0;
    try {
      $('#btn-live-sync-start', el).disabled = true;
      $('#btn-live-sync-stop', el).disabled = false;
      $('#live-sync-box', el).style.display = 'block';
      await post('/api/sync/live/start', {
        delayMs,
        maxFollowing: scope,
        maxFollowers: scope
      });
      toast('Live relationship sync started in background...', 'ok');
    } catch (e) {
      toast(e.message, 'err');
      $('#btn-live-sync-start', el).disabled = false;
      $('#btn-live-sync-stop', el).disabled = true;
    }
  });

  $('#btn-live-sync-stop', el)?.addEventListener('click', async () => {
    try {
      await post('/api/sync/live/stop');
      toast('Stopping live sync...', 'warn');
    } catch (e) {
      toast(e.message, 'err');
    }
  });

  updateLiveSyncUI(store.data?.liveSync);

  return {
    onLiveSync: updateLiveSyncUI,
    onLiveSyncCompleted: (res) => {
      const s = res?.summary;
      if (s) {
        if (s.latestDiff) renderDiff(s.latestDiff);
        $('#res', el).innerHTML = `
          <div class="card" style="border-left:4px solid var(--ok);margin-top:16px">
            <p style="font-size:14px;margin-bottom:8px"><b>${fmtNum(s.totals.following)}</b> following · <b>${fmtNum(s.totals.followers)}</b> followers · <b>${fmtNum(s.totals.nonFollowers)}</b> don't follow back · <b>${fmtNum(s.totals.mutual)}</b> mutual</p>
            <div class="row" style="gap:8px;margin-bottom:12px;flex-wrap:wrap">
              <span class="chip ok">⭐ Protected Whitelist: ${fmtNum(s.whitelistCount || 0)} accounts preserved</span>
              <span class="chip ok">👥 VIP Scanner Intelligence: ${fmtNum(s.scannedProfilesCount || 0)} profiles preserved</span>
              <span class="chip ok">⚡ Source: Live Instagram Session</span>
            </div>
            <div><a class="btn primary" href="#/non-followers">Review non-followers</a></div>
          </div>`;
      }
      toast('Live sync completed: Relationship data and Follower Changes updated!', 'ok');
    }
  };
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
      ${num('maxPerRun', 'Max accounts per run', 'Hard cap for one run, 1 to 30000', 1, 30000)}
      ${num('errorThreshold', 'Failure streak limit', 'Consecutive failures before a safety pause', 2, 50)}</div>
      <h2 style="margin-top:20px">Safety &amp; Rate Limits</h2><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr))">
      ${num('hourlyLimit', 'Hourly action limit', 'Max actions in rolling 60 min, 10 to 200', 10, 200)}
      ${num('cooldownMinutes', 'Auto-cooldown duration (minutes)', 'Pause duration after reaching limit, 5 to 120', 5, 120)}</div>
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
    const body = {}; for (const k of ['actionIntervalSec', 'navigationTimeoutSec', 'elementTimeoutSec', 'maxAttempts', 'maxPerRun', 'errorThreshold', 'hourlyLimit', 'cooldownMinutes']) body[k] = $(`#s-${k}`, el).value === '' ? NaN : Number($(`#s-${k}`, el).value);
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
          kpiCard('Ghost Followers', s.ghostFollowers || 0, 'k-ghost') +
          kpiCard('Pending Requests Sent', s.pendingSent) +
          kpiCard('Account Health', d.healthGrade);
      }
      const ratios = $('#intel-ratios', el);
      if (ratios) {
        ratios.innerHTML = `
          <div><b>Follow-Back Conversion:</b> ${d.ratios.followBackPercentage}% (Mutual / Following)</div>
          <div><b>Fan Loyalty Ratio:</b> ${d.ratios.fanPercentage}% (Fans / Followers)</div>
          <div><b>Non-Follower Ratio:</b> ${d.ratios.nonFollowerPercentage}% (Unreciprocated / Following)</div>
          <div><b>Ghost Follower Ratio:</b> ${d.ratios.ghostFollowerPercentage || 0}% (Suspected inattentive/bot accounts)</div>
          <div><b>Follower Health Ratio:</b> ${d.ratios.followerHealthRatio}x (Followers / Following)</div>
          ${s.diff ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><b>Latest Export Changes:</b> 🚨 ${s.diff.lostCount} lost, 🎉 ${s.diff.gainedCount} gained (${s.diff.netFollowerChange >= 0 ? '+' : ''}${s.diff.netFollowerChange} net)</div>` : ''}
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

/* ---------------------------------------------------------------- custom list runner */
export function customListView(el) {
  el.innerHTML = `
    <h1>Custom Target List Runner</h1>
    <p class="sub">Run Follow, Unfollow, or Request Cancellation on a specific target list of accounts. Accounts are verified live on Instagram before any click.</p>

    <div class="grid two" style="margin-top:20px">
      <!-- Input Card -->
      <div class="card">
        <h2>Target Accounts</h2>
        <p class="sub">Paste handles, profile URLs, or upload a .txt/.csv file.</p>
        
        <div class="row" style="margin-bottom:12px;gap:8px">
          <label class="btn sm ghost" style="cursor:pointer">
            ${icon('upload', 14)} Upload .txt / .csv
            <input type="file" id="cl-file" accept=".txt,.csv" style="display:none">
          </label>
          <button class="btn sm ghost" id="cl-sample">Sample handles</button>
          <button class="btn sm ghost" id="cl-clear">Clear</button>
        </div>

        <label class="field" style="margin-bottom:14px">
          <textarea id="cl-input" rows="8" placeholder="@username1&#10;@username2&#10;https://www.instagram.com/username3/&#10;user4, user5" style="font-family:var(--font-mono);font-size:12px;resize:vertical"></textarea>
        </label>

        <div class="row" style="justify-content:space-between;align-items:center">
          <span class="chip" id="cl-count"><span class="dot"></span>0 accounts detected</span>
          <span class="sub" style="font-size:11px">Auto-cleaned &amp; deduplicated</span>
        </div>
      </div>

      <!-- Action & Config Card -->
      <div class="card">
        <h2>Action &amp; Pacing</h2>
        <p class="sub">Select mutation mode and execution speed.</p>

        <div style="margin-bottom:16px">
          <label class="field" style="margin-bottom:8px">Action
            <select id="cl-mode">
              <option value="follow">Follow (Follow profile / send request)</option>
              <option value="cancel">Cancel Request (Cancel pending follow request)</option>
              <option value="unfollow">Unfollow (Unfollow profile)</option>
            </select>
          </label>
          <p class="sub" id="cl-mode-hint" style="font-size:12px;margin:4px 0 12px;color:var(--muted)">Follows new accounts or sends requests to private profiles.</p>
        </div>

        <div class="row" id="cl-speed" style="margin-bottom:16px">
          <label class="field" style="grid-template-columns:auto auto;align-items:center;gap:8px">Profile
            <select id="cl-preset">
              ${Object.entries(PROFILES).map(([k, p]) => `<option value="${k}">${p.name} (${p.intervalSec} s)</option>`).join('')}
              <option value="custom">Custom</option>
            </select>
          </label>
          <label class="field" style="grid-template-columns:auto 64px auto;align-items:center;gap:6px">Interval
            <input type="number" id="cl-interval" min="2" max="600" step="1" value="${store.data?.settings?.actionIntervalSec || 15}"> s
          </label>
        </div>

        <div style="margin-bottom:16px">
          <label class="field">Execution Order
            <select id="cl-order">
              <option value="listed" selected>As Listed / Input Order</option>
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
            </select>
          </label>
        </div>

        <div class="row" style="margin-top:20px">
          <button class="btn primary" id="cl-start" disabled>Run Custom List (0)</button>
        </div>
      </div>
    </div>

    <!-- Active Engine Status -->
    <div class="card" id="cl-engine-host" style="margin-top:20px"></div>
  `;

  let currentEngine = enginePanel($('#cl-engine-host', el), 'follow');

  function parseUsernames(text) {
    if (!text) return [];
    const tokens = text.split(/[\r\n,;\s]+/);
    const cleaned = tokens
      .map(t => t.trim().replace(/^@+/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '').toLowerCase())
      .filter(u => /^[a-z0-9_][a-z0-9_.-]{0,29}$/.test(u));
    return Array.from(new Set(cleaned));
  }

  function syncCount() {
    const list = parseUsernames($('#cl-input', el).value);
    const countEl = $('#cl-count', el);
    const startBtn = $('#cl-start', el);
    const mode = $('#cl-mode', el).value;
    const modeVerb = mode === 'cancel' ? 'Cancel Requests for' : mode === 'follow' ? 'Follow' : 'Unfollow';
    if (countEl) countEl.innerHTML = `<span class="dot ${list.length ? 'ok' : ''}"></span>${fmtNum(list.length)} accounts detected`;
    if (startBtn) {
      startBtn.disabled = !list.length;
      startBtn.textContent = `${modeVerb} ${fmtNum(list.length)} Accounts`;
    }
  }

  $('#cl-input', el).addEventListener('input', syncCount);
  $('#cl-clear', el).addEventListener('click', () => { $('#cl-input', el).value = ''; syncCount(); });
  $('#cl-sample', el).addEventListener('click', () => {
    $('#cl-input', el).value = `@cristiano\n@leomessi\n@selenagomez\n@natgeo`;
    syncCount();
  });

  $('#cl-file', el).addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      $('#cl-input', el).value = ev.target.result;
      syncCount();
      toast(`Loaded ${file.name}`, 'ok');
    };
    reader.readAsText(file);
  });

  $('#cl-mode', el).addEventListener('change', e => {
    const mode = e.target.value;
    const hints = {
      follow: 'Follows new accounts or sends requests to private profiles.',
      cancel: 'Cancels pending follow requests previously sent to private accounts.',
      unfollow: 'Unfollows accounts that you currently follow.'
    };
    $('#cl-mode-hint', el).textContent = hints[mode] || '';
    $('#cl-engine-host', el).innerHTML = '';
    currentEngine = enginePanel($('#cl-engine-host', el), mode);
    syncCount();
  });

  $('#cl-preset', el).addEventListener('change', e => {
    const p = PROFILES[e.target.value];
    if (p) $('#cl-interval', el).value = p.intervalSec;
  });

  $('#cl-start', el).addEventListener('click', async () => {
    const list = parseUsernames($('#cl-input', el).value);
    if (!list.length) return toast('Please enter at least one valid username.', 'warn');
    const mode = $('#cl-mode', el).value;
    const order = $('#cl-order', el).value;
    const intervalSec = Number($('#cl-interval', el).value) || 15;

    try {
      await post('/api/settings', { actionIntervalSec: intervalSec });
    } catch {}

    const actionText = mode === 'cancel' ? 'Cancel Requests for' : mode === 'follow' ? 'Follow' : 'Unfollow';
    const confirmed = await confirmModal({
      title: `${actionText} ${fmtNum(list.length)} Custom Accounts?`,
      body: `<p>You are about to run <b>${mode.toUpperCase()}</b> on <b>${fmtNum(list.length)}</b> custom accounts at <b>${intervalSec}s</b> intervals.</p><p>Each account will be verified live on Instagram before any action.</p>`,
      confirmText: `Start ${mode.toUpperCase()}`,
      danger: mode === 'unfollow'
    });
    if (!confirmed) return;

    try {
      await post('/api/run/start', {
        mode,
        usernames: list,
        order,
        custom: true,
        confirm: true
      });
      toast(`Custom list ${mode} automation started!`, 'ok');
      await hooks.refresh();
      currentEngine?.update?.();
    } catch (e) {
      toast(e.message, 'err');
    }
  });

  syncCount();
  return {
    onData: () => currentEngine?.update?.(),
    onEngine: () => currentEngine?.update?.()
  };
}

/* ---------------------------------------------------------------- Whitelist */
export function whitelistView(el) {
  el.innerHTML = `<h1>Protected Whitelist</h1>
    <p class="sub">Accounts added to this list are completely shielded. They will NEVER be unfollowed or have their follow requests cancelled, even during bulk operations.</p>
    
    <div class="row" style="gap:16px;align-items:flex-start;margin-bottom:20px;flex-wrap:wrap">
      <div class="card" style="flex:1;min-width:300px">
        <h2>Protect Accounts</h2>
        <p class="sub">Add individual accounts or paste a list of handles.</p>
        <div class="row" style="gap:8px;margin-bottom:12px">
          <input type="text" id="wl-single" placeholder="@username to protect" style="flex:1">
          <button class="btn primary" id="wl-add-single">${icon('shield', 14)} Add</button>
        </div>
        <label class="field" style="margin-top:10px">Bulk Import / Paste Handles
          <textarea id="wl-bulk" rows="3" placeholder="Paste handles separated by commas or newlines..."></textarea>
        </label>
        <div class="row" style="gap:8px;margin-top:10px">
          <input type="file" id="wl-file" accept=".txt,.csv" style="display:none">
          <button class="btn ghost sm" id="wl-file-btn">${icon('upload', 14)} Load File</button>
          <button class="btn primary sm" id="wl-add-bulk">${icon('plus', 14)} Add All to Whitelist</button>
        </div>
      </div>

      <div class="card" style="width:300px">
        <h2>Shield Status</h2>
        <div style="font-size:32px;font-weight:700;margin:12px 0 6px" id="wl-count-big">0</div>
        <p class="sub" style="margin:0 0 14px">Protected VIP accounts</p>
        <div class="badge ok" style="display:inline-flex;align-items:center;gap:6px">
          ${icon('shield', 14)} Auto-Shield Active
        </div>
        <div style="margin-top:20px">
          <button class="btn danger sm" id="wl-clear-all" style="width:100%">${icon('trash', 14)} Clear Whitelist</button>
        </div>
      </div>
    </div>

    <div class="row" style="justify-content:space-between;margin-bottom:12px;gap:12px;flex-wrap:wrap">
      <input type="text" id="wl-search" placeholder="Filter protected accounts..." style="max-width:320px;flex:1">
      <div class="muted" id="wl-filter-count" style="align-self:center"></div>
    </div>

    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Account</th>
            <th>Protection Status</th>
            <th style="text-align:right">Action</th>
          </tr>
        </thead>
        <tbody id="wl-table"></tbody>
      </table>
    </div>`;

  const parseHandles = text => {
    if (!text) return [];
    return Array.from(new Set(
      text.split(/[\r\n,;\s]+/)
        .map(t => t.trim().replace(/^@+/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '').toLowerCase())
        .filter(u => /^[a-z0-9_][a-z0-9_.-]{0,29}$/.test(u))
    ));
  };

  let accounts = store.data?.whitelist || [];
  let filterText = '';

  const renderList = () => {
    const total = accounts.length;
    const bigCount = $('#wl-count-big', el);
    if (bigCount) bigCount.textContent = fmtNum(total);
    const filtered = accounts.filter(u => !filterText || u.toLowerCase().includes(filterText.toLowerCase()));
    const filterCountEl = $('#wl-filter-count', el);
    if (filterCountEl) filterCountEl.textContent = filterText ? `${fmtNum(filtered.length)} of ${fmtNum(total)} shown` : `${fmtNum(total)} accounts`;

    const tbody = $('#wl-table', el);
    if (!tbody) return;
    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted" style="text-align:center;padding:24px">${filterText ? 'No matching accounts found.' : 'No accounts in whitelist. Add accounts above to protect them.'}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((u, i) => `
      <tr>
        <td class="muted">${i + 1}</td>
        <td>
          <a href="https://www.instagram.com/${esc(u)}/" target="_blank" rel="noopener" style="font-weight:600">@${esc(u)}</a>
        </td>
        <td><span class="badge ok">${icon('shield', 12)} Protected</span></td>
        <td style="text-align:right">
          <button class="btn ghost sm danger" data-remove="${esc(u)}">Remove</button>
        </td>
      </tr>
    `).join('');
  };

  $('#wl-search', el).addEventListener('input', e => {
    filterText = e.target.value.trim();
    renderList();
  });

  $('#wl-add-single', el).addEventListener('click', async () => {
    const raw = $('#wl-single', el).value.trim();
    const handles = parseHandles(raw);
    if (!handles.length) return toast('Please enter a valid Instagram username', 'warn');
    const u = handles[0];
    try {
      await post('/api/whitelist/add', { username: u });
      accounts = await api('/api/whitelist');
      if (store.data) store.data.whitelist = accounts;
      $('#wl-single', el).value = '';
      renderList();
      toast(`@${u} added to whitelist`, 'ok');
      await hooks.refresh();
    } catch (e) {
      toast(e.message, 'err');
    }
  });

  $('#wl-single', el).addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#wl-add-single', el).click();
  });

  $('#wl-file-btn', el).addEventListener('click', () => $('#wl-file', el).click());
  $('#wl-file', el).addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      $('#wl-bulk', el).value = ev.target.result;
      toast(`Loaded ${file.name}`, 'ok');
    };
    reader.readAsText(file);
  });

  $('#wl-add-bulk', el).addEventListener('click', async () => {
    const handles = parseHandles($('#wl-bulk', el).value);
    if (!handles.length) return toast('No valid handles found in textarea', 'warn');
    try {
      const res = await post('/api/whitelist/add', { usernames: handles });
      accounts = await api('/api/whitelist');
      if (store.data) store.data.whitelist = accounts;
      $('#wl-bulk', el).value = '';
      renderList();
      toast(`Added ${fmtNum(res.addedCount || handles.length)} accounts to whitelist`, 'ok');
      await hooks.refresh();
    } catch (e) {
      toast(e.message, 'err');
    }
  });

  $('#wl-table', el).addEventListener('click', async e => {
    const removeBtn = e.target.closest('[data-remove]');
    if (!removeBtn) return;
    const u = removeBtn.dataset.remove;
    try {
      await post('/api/whitelist/remove', { username: u });
      accounts = accounts.filter(x => x !== u);
      if (store.data) store.data.whitelist = accounts;
      renderList();
      toast(`@${u} removed from whitelist`, 'ok');
      await hooks.refresh();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  $('#wl-clear-all', el).addEventListener('click', async () => {
    if (!accounts.length) return toast('Whitelist is already empty', 'warn');
    const ok = await confirmModal({
      title: 'Clear Entire Whitelist?',
      body: `<p>Are you sure you want to remove all <b>${fmtNum(accounts.length)}</b> accounts from the Protected Whitelist?</p><p>These accounts will no longer be protected from bulk unfollow or cancel operations.</p>`,
      confirmText: 'Clear Whitelist',
      danger: true
    });
    if (!ok) return;
    try {
      await post('/api/whitelist/clear');
      accounts = [];
      if (store.data) store.data.whitelist = [];
      renderList();
      toast('Whitelist cleared', 'ok');
      await hooks.refresh();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  renderList();
  return {
    onData: () => {
      accounts = store.data?.whitelist || accounts;
      renderList();
    }
  };
}

/* ---------------------------------------------------------------- VIP & Influencers */
export function vipInfluencerView(el) {
  const kpis = store.data?.kpis || {};
  const followingCount = kpis.following || 0;
  const followersCount = kpis.followers || 0;

  el.innerHTML = `<h1>VIP &amp; Influencer Finder</h1>
    <p class="sub">Scan your following and followers to automatically detect Blue Tick verified creators, high-authority accounts (ratio &gt; 10x), and accounts with &gt;10K or &gt;50K followers.</p>

    <!-- KPI Grid -->
    <div class="grid kpis" style="margin-bottom:18px">
      ${kpiCard('Scanned Profiles', 0, 'vip-kpi-scanned')}
      ${kpiCard('Verified (Blue Tick)', 0, 'vip-kpi-verified')}
      ${kpiCard('Creators (> 10K)', 0, 'vip-kpi-10k')}
      ${kpiCard('Mega Influencers (> 50K)', 0, 'vip-kpi-50k')}
      ${kpiCard('High Authority (> 10x)', 0, 'vip-kpi-authority')}
    </div>

    <!-- Scanner Control Card -->
    <div class="card" style="margin-bottom:20px">
      <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:10px">
        <div>
          <h2>Profile Scanner Controls</h2>
          <p class="sub" style="margin-bottom:0">Select which list to inspect. The scanner extracts follower counts, authority ratios, and verification badges in the background.</p>
        </div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <span class="chip ok" style="padding:3px 8px;font-size:11px" title="Pre-flights Instagram's user endpoint directly in ~150ms">${icon('sparkles', 12)} ⚡ Direct Web API (150ms)</span>
          <span class="chip" style="padding:3px 8px;font-size:11px" title="Scanner page automatically recycles every 150 accounts to keep memory under 50MB">${icon('shield', 12)} 🛡️ Memory Recycled (150/tab)</span>
        </div>
      </div>

      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:16px 0">
        <label class="field">Source List
          <select id="vip-source">
            <option value="following">Following (${fmtNum(followingCount)} accounts)</option>
            <option value="followers">Followers (${fmtNum(followersCount)} accounts)</option>
            <option value="nonFollowers">Non-Followers (${fmtNum(kpis.nonFollowers || 0)} accounts)</option>
          </select>
        </label>
        <label class="field">Batch Size
          <select id="vip-limit">
            <option value="50">First 50 profiles (Quick Scan)</option>
            <option value="100">First 100 profiles</option>
            <option value="250">First 250 profiles</option>
            <option value="0">All profiles in list</option>
          </select>
        </label>
        <label class="field">Scan Delay (Speed)
          <select id="vip-interval">
            <option value="0.5">⚡⚡ Direct API Hyper (0.5s / ~120/min)</option>
            <option value="1.5">⚡ Turbo (1.5 seconds)</option>
            <option value="3" selected>🚀 Fast (3 seconds - Default)</option>
            <option value="5">Balanced (5 seconds)</option>
            <option value="8">Conservative (8 seconds)</option>
          </select>
        </label>
      </div>

      <div class="row" style="margin:14px 0;align-items:center;gap:18px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer">
          <input type="checkbox" id="vip-skip-scanned" checked>
          <span><b>Skip already-scanned accounts</b> (continue scanning unscanned only)</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer">
          <input type="checkbox" id="vip-auto-wl" checked>
          <span>Auto-add verified and &gt;10K accounts to <b>Protected Whitelist</b></span>
        </label>
      </div>

      <div class="row" style="gap:8px;margin-top:16px;flex-wrap:wrap">
        <button class="btn primary" id="vip-start">${icon('sparkles', 14)} Start VIP Scanner</button>
        <button class="btn danger" id="vip-stop" disabled>${icon('ban', 14)} Stop Scanner</button>
        <button class="btn ghost" id="vip-btn-enqueue" title="Add usernames to the live background scanning queue without interrupting">${icon('plus', 14)} Enqueue Accounts</button>
      </div>

      <!-- Live progress status -->
      <div id="vip-progress-box" style="margin-top:16px;display:none;background:var(--surface-2);padding:12px;border-radius:var(--radius-sm);border:1px solid var(--border)">
        <div class="row" style="justify-content:space-between;margin-bottom:6px">
          <span id="vip-progress-label" style="font-weight:600">Scanning in progress...</span>
          <span class="chip" id="vip-progress-chip">0 / 0</span>
        </div>
        <div style="background:var(--surface-3);border-radius:999px;height:8px;overflow:hidden">
          <div id="vip-progress-bar" style="background:var(--accent);height:100%;width:0%;transition:width 0.3s"></div>
        </div>
      </div>
    </div>

    <!-- 1-Click Mass Actions Card -->
    <div class="card" style="margin-bottom:20px">
      <h2>1-Click Mass Actions</h2>
      <p class="sub">Instantly shield all discovered high-profile accounts without manual selection.</p>
      <div class="row" style="gap:10px;margin-top:12px;flex-wrap:wrap">
        <button class="btn primary-ghost" id="vip-wl-verified">${icon('shield', 14)} ⭐ Whitelist All Verified (Blue Tick)</button>
        <button class="btn primary-ghost" id="vip-wl-10k">${icon('shield', 14)} ⭐ Whitelist All &gt; 10K Followers</button>
        <button class="btn primary-ghost" id="vip-wl-50k">${icon('shield', 14)} ⭐ Whitelist All &gt; 50K Followers</button>
        <button class="btn primary-ghost" id="vip-wl-authority">${icon('shield', 14)} 👑 Whitelist All High Authority (&gt; 10x)</button>
      </div>
    </div>

    <!-- Discovered Accounts Table -->
    <div class="row" style="justify-content:space-between;margin-bottom:12px;gap:12px;flex-wrap:wrap">
      <div class="row" style="gap:8px">
        <input type="search" id="vip-q" placeholder="Search accounts..." style="max-width:240px">
        <select id="vip-filter">
          <option value="all">All Scanned Profiles</option>
          <option value="authority">👑 High Authority (Ratio &gt; 10x)</option>
          <option value="verified">Verified Only (Blue Tick)</option>
          <option value="10k">Followers &gt; 10,000</option>
          <option value="50k">Mega Influencers (&gt; 50,000)</option>
        </select>
      </div>
      <div class="muted" id="vip-count-label" style="align-self:center"></div>
    </div>

    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Account</th>
            <th>Followers</th>
            <th>Authority Ratio</th>
            <th>Verification</th>
            <th>Relationship</th>
            <th>Whitelisted</th>
            <th style="text-align:right">Action</th>
          </tr>
        </thead>
        <tbody id="vip-tbody"></tbody>
      </table>
    </div>`;

  let profiles = [];
  let filter = 'all';
  let searchQuery = '';

  const refreshData = async () => {
    try {
      const res = await api('/api/influencers');
      const sum = res.summary || {};
      const sc = $('#vip-kpi-scanned', el);
      const vc = $('#vip-kpi-verified', el);
      const k10 = $('#vip-kpi-10k', el);
      const k50 = $('#vip-kpi-50k', el);
      const auth = $('#vip-kpi-authority', el);
      if (sc) sc.textContent = fmtNum(sum.totalScanned);
      if (vc) vc.textContent = fmtNum(sum.verifiedCount);
      if (k10) k10.textContent = fmtNum(sum.above10k);
      if (k50) k50.textContent = fmtNum(sum.above50k);
      if (auth) auth.textContent = fmtNum(sum.highAuthorityCount || 0);
      profiles = res.profiles || [];
      renderTable();
    } catch {}
  };

  const renderTable = () => {
    const wl = store.data?.whitelist || [];
    let list = profiles.filter(p => {
      if (searchQuery && !p.username.includes(searchQuery)) return false;
      if (filter === 'authority') return (p.authorityRatio || 0) >= 10;
      if (filter === 'verified') return p.isVerified;
      if (filter === '10k') return (p.followersCount || 0) >= 10000;
      if (filter === '50k') return (p.followersCount || 0) >= 50000;
      return true;
    });

    const cntLbl = $('#vip-count-label', el);
    if (cntLbl) cntLbl.textContent = `${fmtNum(list.length)} accounts`;
    const tbody = $('#vip-tbody', el);
    if (!tbody) return;

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">${profiles.length ? 'No accounts match the selected filter.' : 'No profiles scanned yet. Click "Start VIP Scanner" above to begin scanning.'}</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((p, i) => {
      const isWl = wl.includes(p.username.toLowerCase());
      const fText = p.followersText || (p.followersCount >= 1e6 ? (p.followersCount/1e6).toFixed(1)+'M' : p.followersCount >= 1e3 ? (p.followersCount/1e3).toFixed(1)+'K' : (p.followersCount != null ? String(p.followersCount) : '—'));
      const starBtn = `<button class="star-btn ${isWl ? 'active' : ''}" data-star="${esc(p.username)}" title="${isWl ? 'Protected in Whitelist - Click to unprotect' : 'Click to add to Protected Whitelist'}" aria-label="Toggle Whitelist">${icon('star', 15)}</button>`;

      let authBadge = '<span class="muted">—</span>';
      if (p.authorityRatio != null && p.authorityRatio > 0) {
        const ratioVal = p.authorityRatio.toFixed(1);
        if (p.authorityRatio >= 10) {
          authBadge = `<span class="chip ok" style="font-weight:700;border-color:gold;padding:1px 6px;font-size:11px" title="${ratioVal}x (${fmtNum(p.followersCount)} followers / ${fmtNum(p.followingCount || 1)} following)">👑 ${ratioVal}x High</span>`;
        } else if (p.authorityRatio >= 1) {
          authBadge = `<span class="chip" style="padding:1px 6px;font-size:11px" title="${ratioVal}x (${fmtNum(p.followersCount)} followers / ${fmtNum(p.followingCount || 1)} following)">⚖️ ${ratioVal}x</span>`;
        } else {
          authBadge = `<span class="chip muted" style="padding:1px 6px;font-size:11px" title="${ratioVal}x (${fmtNum(p.followersCount)} followers / ${fmtNum(p.followingCount || 1)} following)">🔄 ${ratioVal}x</span>`;
        }
      }

      return `
        <tr>
          <td class="muted">${i + 1}</td>
          <td>
            ${starBtn}
            <a href="https://www.instagram.com/${esc(p.username)}/" target="_blank" rel="noopener noreferrer" style="font-weight:600">@${esc(p.username)}</a>
          </td>
          <td><b>${esc(fText)}</b></td>
          <td>${authBadge}</td>
          <td>${p.isVerified ? `<span class="chip" style="color:#0284c7;border-color:rgba(2,132,199,0.3);background:rgba(2,132,199,0.08);padding:1px 6px;font-size:11px">🔵 Verified</span>` : '<span class="muted">—</span>'}</td>
          <td><span class="chip">${esc(p.relationship || 'Following')}</span></td>
          <td>${isWl ? `<span class="chip ok" style="padding:1px 6px;font-size:10px">⭐ Protected</span>` : '<span class="muted">No</span>'}</td>
          <td style="text-align:right">
            <button class="btn sm danger-ghost" data-unfollow="${esc(p.username)}" ${isWl ? 'disabled title="Protected by Whitelist"' : ''}>Unfollow</button>
            <a class="btn sm ghost" href="https://www.instagram.com/${esc(p.username)}/" target="_blank" rel="noopener noreferrer">Open</a>
          </td>
        </tr>
      `;
    }).join('');
  };

  $('#vip-q', el).addEventListener('input', e => { searchQuery = e.target.value.trim().toLowerCase(); renderTable(); });
  $('#vip-filter', el).addEventListener('change', e => { filter = e.target.value; renderTable(); });

  const savedInterval = localStorage.getItem('nf_vip_interval') || '3';
  if ($('#vip-interval', el)) $('#vip-interval', el).value = savedInterval;
  $('#vip-interval', el).addEventListener('change', e => {
    localStorage.setItem('nf_vip_interval', e.target.value);
  });

  $('#vip-start', el).addEventListener('click', async () => {
    const list = $('#vip-source', el).value;
    const limit = +$('#vip-limit', el).value;
    const intervalSec = parseFloat($('#vip-interval', el).value) || 3;
    const skipScanned = $('#vip-skip-scanned', el).checked;
    const autoWhitelistVerified = $('#vip-auto-wl', el).checked;
    const autoWhitelistMin = autoWhitelistVerified ? 10000 : 0;

    try {
      $('#vip-start', el).disabled = true;
      $('#vip-stop', el).disabled = false;
      $('#vip-progress-box', el).style.display = 'block';

      const res = await post('/api/scan/vip/start', {
        list,
        limit,
        intervalSec,
        rescanAll: !skipScanned,
        autoWhitelistVerified,
        autoWhitelistMin
      });

      if (res.total === 0) {
        toast(res.message || 'All accounts in this list are already scanned!', 'ok');
        $('#vip-start', el).disabled = false;
        $('#vip-stop', el).disabled = true;
        $('#vip-progress-box', el).style.display = 'none';
        return;
      }

      toast(`VIP Scanner started: ${fmtNum(res.total)} unscanned accounts (${fmtNum(res.skipped || 0)} skipped)!`, 'ok');
    } catch (e) {
      toast(e.message, 'err');
      $('#vip-start', el).disabled = false;
      $('#vip-stop', el).disabled = true;
    }
  });

  $('#vip-btn-enqueue', el)?.addEventListener('click', async () => {
    const text = prompt('Enter Instagram usernames to add to the background scan queue (separated by commas or spaces):');
    if (!text) return;
    const usernames = text.split(/[\s,]+/).map(s => s.trim().replace(/^@/, '')).filter(Boolean);
    if (!usernames.length) return;
    try {
      const res = await post('/api/scan/vip/queue', { usernames });
      toast(`Enqueued ${fmtNum(res.enqueuedCount || usernames.length)} accounts into background queue (Queue Total: ${fmtNum(res.queueRemaining || 0)})`, 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  });

  $('#vip-stop', el).addEventListener('click', async () => {
    try {
      await post('/api/scan/vip/stop');
      $('#vip-start', el).disabled = false;
      $('#vip-stop', el).disabled = true;
      toast('VIP Scanner stopped.', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  });

  $('#vip-wl-verified', el).addEventListener('click', async () => {
    try {
      const res = await post('/api/whitelist/bulk-by-criteria', { verified: true });
      toast(`⭐ Protected ${fmtNum(res.added || 0)} verified accounts in Whitelist`, 'ok');
      await hooks.refresh();
      await refreshData();
    } catch (e) {
      toast(e.message, 'err');
    }
  });

  $('#vip-wl-10k', el).addEventListener('click', async () => {
    try {
      const res = await post('/api/whitelist/bulk-by-criteria', { minFollowers: 10000 });
      toast(`⭐ Protected ${fmtNum(res.added || 0)} accounts with >10K followers`, 'ok');
      await hooks.refresh();
      await refreshData();
    } catch (e) {
      toast(e.message, 'err');
    }
  });

  $('#vip-wl-50k', el).addEventListener('click', async () => {
    try {
      const res = await post('/api/whitelist/bulk-by-criteria', { minFollowers: 50000 });
      toast(`⭐ Protected ${fmtNum(res.added || 0)} mega accounts with >50K followers`, 'ok');
      await hooks.refresh();
      await refreshData();
    } catch (e) {
      toast(e.message, 'err');
    }
  });

  $('#vip-wl-authority', el).addEventListener('click', async () => {
    try {
      const res = await post('/api/whitelist/bulk-by-criteria', { minRatio: 10 });
      toast(`⭐ Protected ${fmtNum(res.added || 0)} high-authority accounts (ratio > 10x) in Whitelist`, 'ok');
      await hooks.refresh();
      await refreshData();
    } catch (e) {
      toast(e.message, 'err');
    }
  });

  $('#vip-tbody', el).addEventListener('click', async ev => {
    const starBtn = ev.target.closest('[data-star]');
    if (starBtn) {
      const u = starBtn.dataset.star;
      try {
        await post('/api/whitelist/toggle', { username: u });
        await hooks.refresh();
        await refreshData();
      } catch (e) {
        toast(e.message, 'err');
      }
      return;
    }
    const unfollowBtn = ev.target.closest('[data-unfollow]');
    if (unfollowBtn) {
      const u = unfollowBtn.dataset.unfollow;
      if (!await confirmModal({
        title: `Unfollow @${u}?`,
        danger: true,
        confirmText: 'Confirm Unfollow',
        body: `<p>The account <b>@${esc(u)}</b> will be safely unfollowed.</p>`
      })) return;
      try {
        await post('/api/run/start', { mode: 'unfollow', usernames: [u], confirm: true });
        toast(`Unfollowing @${u}`, 'ok');
        await hooks.refresh();
      } catch (e) {
        toast(e.message, 'err');
      }
    }
  });

  const updateScannerState = snap => {
    if (!snap) return;
    const startBtn = $('#vip-start', el);
    const stopBtn = $('#vip-stop', el);
    const box = $('#vip-progress-box', el);
    const lbl = $('#vip-progress-label', el);
    const chip = $('#vip-progress-chip', el);
    const bar = $('#vip-progress-bar', el);

    if (snap.active) {
      if (startBtn) startBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;
      if (box) box.style.display = 'block';
      const queueSuffix = snap.queueRemaining != null ? ` (${fmtNum(snap.queueRemaining)} in queue)` : '';
      if (lbl) lbl.textContent = snap.current ? `Scanning @${snap.current}...${queueSuffix}` : `Scanning in progress...${queueSuffix}`;
      if (chip) chip.textContent = `${fmtNum(snap.processed)} / ${fmtNum(snap.total)}`;
      const pct = snap.total > 0 ? Math.round((snap.processed / snap.total) * 100) : 0;
      if (bar) bar.style.width = `${pct}%`;
    } else {
      if (startBtn) startBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
      if (snap.processed > 0 && box) {
        if (lbl) lbl.textContent = `Completed scan: ${fmtNum(snap.processed)} profiles checked.`;
        if (bar) bar.style.width = '100%';
      }
    }
  };

  const autoPoll = setInterval(() => {
    if (store.data?.vipScanner?.active) {
      refreshData();
    }
  }, 2500);

  refreshData();
  updateScannerState(store.data?.vipScanner);

  return {
    onVipScanner: snap => {
      updateScannerState(snap);
    },
    onVipAccount: acc => {
      // Live increment the 5 KPI metric cards immediately
      const sc = $('#vip-kpi-scanned', el);
      if (sc) {
        const cur = parseInt((sc.textContent || '0').replace(/,/g, ''), 10) || 0;
        sc.textContent = fmtNum(cur + 1);
      }
      if (acc.isVerified) {
        const vc = $('#vip-kpi-verified', el);
        if (vc) {
          const cur = parseInt((vc.textContent || '0').replace(/,/g, ''), 10) || 0;
          vc.textContent = fmtNum(cur + 1);
        }
      }
      if ((acc.followersCount || 0) >= 10000) {
        const k10 = $('#vip-kpi-10k', el);
        if (k10) {
          const cur = parseInt((k10.textContent || '0').replace(/,/g, ''), 10) || 0;
          k10.textContent = fmtNum(cur + 1);
        }
      }
      if ((acc.followersCount || 0) >= 50000) {
        const k50 = $('#vip-kpi-50k', el);
        if (k50) {
          const cur = parseInt((k50.textContent || '0').replace(/,/g, ''), 10) || 0;
          k50.textContent = fmtNum(cur + 1);
        }
      }
      if ((acc.authorityRatio || 0) >= 10) {
        const auth = $('#vip-kpi-authority', el);
        if (auth) {
          const cur = parseInt((auth.textContent || '0').replace(/,/g, ''), 10) || 0;
          auth.textContent = fmtNum(cur + 1);
        }
      }
      const lbl = $('#vip-progress-label', el);
      if (lbl && acc.username) lbl.textContent = `Scanning @${acc.username}...`;
    },
    onVipScanned: async () => {
      await refreshData();
    },
    onData: () => {
      refreshData();
      updateScannerState(store.data?.vipScanner);
    },
    onDestroy: () => {
      clearInterval(autoPoll);
    }
  };
}


