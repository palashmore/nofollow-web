import { api, post } from './api.js';
import { $, esc, fmtNum, fmtDate, fmtDuration, toast, confirmModal } from './ui.js';
import { store, hooks } from './state.js';

export const PROFILES = {
  safe: { name: 'Safe', intervalSec: 30, note: 'Lowest chance of restrictions' },
  balanced: { name: 'Balanced', intervalSec: 15, note: 'Moderate' },
  fast: { name: 'Fast', intervalSec: 8, note: 'Higher chance of restrictions' },
};
export const perHour = s => Math.round(3600 / (s.actionIntervalSec + 6));   // ~6 s of page loading and clicking per account
export const label = s => String(s).replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
const ACTIVE = new Set(['STARTING', 'CHECKING_SESSION', 'RUNNING', 'PAUSED', 'LOGIN_REQUIRED', 'RECOVERING', 'SAFETY_PAUSED', 'STOPPING']);
const WAITING = new Set(['PAUSED', 'LOGIN_REQUIRED', 'RECOVERING', 'SAFETY_PAUSED']);
const BAD = new Set(['SAFETY_PAUSED', 'FAILED']);

const WORDS = {
  unfollow: { done: 'Unfollowed', already: 'Already unfollowed', noun: 'accounts', idle: 'Select accounts on the Non-Followers page and press Start.' },
  cancel: { done: 'Cancelled', already: 'Already cancelled', noun: 'requests', idle: 'Select outgoing requests below, or press Cancel All Pending.' },
  follow: { done: 'Followed', already: 'Already following', noun: 'accounts', idle: 'Input or select accounts to follow and press Start.' },
};
export const engineOf = mode => store.data?.engines?.[mode] || store.data?.engine;
export const anyActive = () => Object.values(store.data?.engines || {}).some(e => ACTIVE.has(e.status));

/** Automation control panel for one job ('unfollow' | 'cancel' | 'follow'). */
export function enginePanel(host, mode = 'unfollow') {
  const W = WORDS[mode] || WORDS.unfollow;
  host.innerHTML = `
    <div class="row" style="justify-content:space-between"><h2 style="margin:0">${mode === 'cancel' ? 'Cancellation' : mode === 'follow' ? 'Follow Automation' : 'Automation'}</h2><span class="chip" id="e-chip"></span></div>
    <div id="e-warn"></div>
    <div class="progress" style="margin:14px 0 8px"><i id="e-bar" style="width:0%"></i></div>
    <div class="sub" style="margin:0" id="e-now"></div>
    <div class="stats" id="e-stats"></div>
    <div class="row" id="speed" style="margin-top:14px">
      <label class="field" style="grid-template-columns:auto auto;align-items:center;gap:8px">Execution profile
        <select id="sp-preset" aria-label="Execution profile">${Object.entries(PROFILES).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('')}<option value="custom">Custom</option></select></label>
      <label class="field" style="grid-template-columns:auto 72px auto;align-items:center;gap:6px">Interval
        <input type="number" id="sp-interval" min="2" max="600" step="1" aria-label="Seconds between actions"> s</label>
      ${mode === 'cancel' ? `
      <label class="field" style="grid-template-columns:auto auto;align-items:center;gap:8px">Order
        <select id="cancel-order-select" aria-label="Processing order">
          <option value="oldest" selected>Oldest First (2017+)</option>
          <option value="newest">Newest First (Recent)</option>
        </select>
      </label>` : ''}
      <span class="chip" id="sp-est"></span>
    </div>
    <div class="sub" style="margin:8px 0 0;font-size:12px" id="e-cfg"></div>
    <div class="row" style="margin-top:16px">
      ${mode === 'cancel'
        ? '<button class="btn primary" data-a="start">Cancel Selected</button><button class="btn" data-a="all">Cancel All Pending</button>'
        : '<button class="btn primary" data-a="start">Start selected</button>'}
      <button class="btn" data-a="pause">Pause</button><button class="btn" data-a="resume">Resume</button>
      <button class="btn danger" data-a="stop">Stop</button>
      <button class="btn ghost" data-a="retry">Retry failed</button>
      <button class="btn ghost" data-a="reset">Reset history</button>
      <a class="btn ghost" href="#/execution-history">View logs</a>
    </div>`;
  const stat = (v, l) => `<div class="stat"><b>${fmtNum(v)}</b><span>${l}</span></div>`;
  const sel = () => (mode === 'cancel' ? store.reqSelection : mode === 'follow' ? (store.followSelection || store.selection) : store.selection);

  function update() {
    const e = engineOf(mode); if (!e) return;
    const k = store.data.kpis, c = k.cancel || {}, st = store.data.settings;
    const mine = e.job === mode ? e : { ...e, status: 'IDLE', pauseReason: null, selected: 0, processed: 0, unfollowed: 0, followed: 0, alreadyUnfollowed: 0, alreadyFollowed: 0, accepted: 0, skipped: 0, unavailable: 0, needsReview: 0, failed: 0, remaining: 0, current: null, operation: null, lastSuccess: null };
    $('#e-chip', host).innerHTML = `<span class="dot ${mine.status === 'RUNNING' ? 'ok' : BAD.has(mine.status) ? 'bad' : ACTIVE.has(mine.status) ? 'warn' : ''}"></span>${esc(label(mine.status))}`;
    $('#e-bar', host).style.width = `${mine.selected ? Math.round((mine.processed / mine.selected) * 100) : 0}%`;
    $('#e-now', host).textContent = mine.current ? `${mine.operation || 'Working'}: @${mine.current}` : (mine.operation || (!ACTIVE.has(mine.status) ? W.idle : ''));
    $('#e-warn', host).innerHTML = mine.pauseReason ? `<div class="notice ${BAD.has(mine.status) ? 'bad' : ''}">${esc(mine.pauseReason)}</div>` : '';
    $('#e-stats', host).innerHTML = stat(mine.selected, 'Selected') + stat(mine.processed, 'Processed') + stat(mine.unfollowed + (mine.followed || 0), W.done) + stat(mine.alreadyUnfollowed + (mine.alreadyFollowed || 0), W.already)
      + (mode === 'cancel' ? stat(mine.accepted, 'Accepted') : '') + stat(mine.skipped + mine.unavailable, 'Skipped / unavailable') + stat(mine.needsReview, 'Needs review') + stat(mine.failed, 'Failed') + stat(mine.remaining, 'Remaining')
      + `<div class="stat"><b>${mine.lastSuccess ? '@' + esc(mine.lastSuccess) : '—'}</b><span>Last success</span></div>`;
    const prof = PROFILES[st.executionProfile]?.name || 'Custom';
    $('#e-cfg', host).textContent = `Configuration in use: ${prof} · interval ${st.actionIntervalSec} s · navigation timeout ${st.navigationTimeoutSec} s · element timeout ${st.elementTimeoutSec} s · retries ${st.maxAttempts} · one action at a time`;
    if (document.activeElement?.closest?.('#speed') == null) { $('#sp-preset', host).value = st.executionProfile; $('#sp-interval', host).value = st.actionIntervalSec; }
    $('#sp-est', host).textContent = `≈ ${fmtNum(perHour(st))} accounts / hour${PROFILES[st.executionProfile] ? ` · ${PROFILES[st.executionProfile].note}` : ''}`;
    const active = ACTIVE.has(mine.status), busy = anyActive(), b = n => $(`[data-a=${n}]`, host);
    const n = sel().size;
    b('start').disabled = busy || !n; b('start').textContent = mode === 'cancel' ? `Cancel Selected (${n})` : mode === 'follow' ? `Follow Selected (${n})` : `Start selected (${n})`;
    if (mode === 'cancel') { b('all').disabled = busy || !store.data.summary || !(c.remaining > 0); b('all').textContent = `Cancel All Pending (${fmtNum(c.remaining || 0)})`; }
    b('pause').disabled = mine.status !== 'RUNNING'; b('resume').disabled = !WAITING.has(mine.status); b('stop').disabled = !active || mine.status === 'STOPPING';
    const bad = mode === 'cancel' ? (c.failed || 0) + (c.review || 0) : k.failed + k.pendingReview;
    b('retry').disabled = busy || !bad; b('reset').disabled = busy;
  }

  const confirmStart = async (title, body, confirmText) => confirmModal({ title, body, confirmText, danger: true });
  const interval = () => store.data.settings.actionIntervalSec;

  host.addEventListener('click', async ev => {
    const a = ev.target.closest('[data-a]')?.dataset.a; if (!a) return;
    try {
      if (a === 'start' && mode === 'unfollow') {
        const n = store.selection.size, ps = perHour(store.data.settings);
        if (!await confirmStart(`Unfollow ${fmtNum(n)} accounts?`, `<p>One account at a time, ${interval()} s between actions: about <b>${fmtNum(ps)} accounts per hour</b> (roughly ${fmtDuration((n / ps) * 3600)} in total). Accounts that already have a final result are skipped.</p>
          <p>The run pauses by itself on any Instagram warning or login problem. Unfollowing many accounts can still lead to action blocks. You can stop at any time.</p>`, 'Start unfollowing')) return;
        await post('/api/run/start', { usernames: [...store.selection], confirm: true });
        toast('Run started', 'ok');
      } else if (a === 'start' && mode === 'cancel') {
        const n = store.reqSelection.size;
        const order = $('#cancel-order-select', host)?.value || 'oldest';
        const isNewest = order === 'newest';
        if (!await confirmStart('Cancel selected follow requests?', `<p>You are about to process <b>${fmtNum(n)}</b> outgoing pending follow requests, one at a time, ${interval()} s apart (${isNewest ? 'Newest First' : 'Oldest First'}). Requests that were accepted are never undone.</p>`, 'Confirm Cancellation')) return;
        await post('/api/run/start', { mode: 'cancel', usernames: [...store.reqSelection], confirm: true, order });
        toast(`Cancellation started (${isNewest ? 'Newest First' : 'Oldest First'})`, 'ok');
      } else if (a === 'start' && mode === 'follow') {
        const list = store.followSelection ? [...store.followSelection] : [...store.selection];
        const n = list.length, ps = perHour(store.data.settings);
        if (!await confirmStart(`Follow ${fmtNum(n)} accounts?`, `<p>One account at a time, ${interval()} s between actions: about <b>${fmtNum(ps)} accounts per hour</b>. Each profile is verified live on Instagram before following.</p>`, 'Start Following')) return;
        await post('/api/run/start', { mode: 'follow', usernames: list, confirm: true, custom: true });
        toast('Follow automation started', 'ok');
      } else if (a === 'all') {
        const p = await api('/api/cancel/preview');
        const order = $('#cancel-order-select', host)?.value || 'oldest';
        const isNewest = order === 'newest';
        const modalHtml = `
          <div style="font-size:14px;line-height:1.5">
            <p>You are about to process <b>${fmtNum(p.eligible)}</b> outgoing pending follow requests.</p>
            <p>This operation will attempt to cancel each eligible request individually, one at a time. ${fmtNum(p.alreadyDone)} request(s) that already have a result are excluded. Each request is re-checked on Instagram first; accepted requests are skipped.</p>
            <div style="background:var(--bg-2);border-radius:8px;padding:12px;margin:12px 0">
              <table style="width:100%;font-size:13px;border-collapse:collapse">
                <tr><td style="padding:4px 0;color:var(--muted)">Total imported:</td><td style="text-align:right;font-weight:600">${fmtNum(p.imported || p.total)}</td></tr>
                <tr><td style="padding:4px 0;color:var(--muted)">Eligible pending:</td><td style="text-align:right;font-weight:600;color:var(--accent)">${fmtNum(p.eligible)}</td></tr>
                <tr><td style="padding:4px 0;color:var(--muted)">Already cancelled:</td><td style="text-align:right;font-weight:600">${fmtNum(p.alreadyCancelled || p.alreadyDone || 0)}</td></tr>
                <tr><td style="padding:4px 0;color:var(--muted)">Accepted:</td><td style="text-align:right;font-weight:600">${fmtNum(p.accepted || 0)}</td></tr>
                <tr><td style="padding:4px 0;color:var(--muted)">Unavailable:</td><td style="text-align:right;font-weight:600">${fmtNum(p.unavailable || 0)}</td></tr>
                <tr><td style="padding:4px 0;color:var(--muted)">Needs review:</td><td style="text-align:right;font-weight:600">${fmtNum(p.needsReview || 0)}</td></tr>
                <tr style="border-top:1px solid var(--border)"><td style="padding:6px 0 2px;color:var(--muted)">Processing order:</td><td style="text-align:right;font-weight:700;color:var(--ok)">${isNewest ? 'Newest First (Most Recent)' : 'Oldest First'}</td></tr>
              </table>
            </div>
            <p style="margin:0;font-size:12px;color:var(--muted)">${isNewest ? 'Most recent requests sent in 2026 are processed first.' : 'Oldest requests from 2017+ are processed first.'} Each request is verified on Instagram before clicking; accepted requests are kept.</p>
          </div>
        `;
        if (!await confirmStart('Cancel All Pending Follow Requests?', modalHtml, 'Confirm Cancellation')) return;
        await post('/api/run/start', { mode: 'cancel', all: true, confirm: true, order });
        toast(`Cancellation started (${isNewest ? 'Newest First' : 'Oldest First'})`, 'ok');
      } else if (a === 'pause') await post('/api/run/pause');
      else if (a === 'resume') { const r = await post('/api/run/resume'); if (WAITING.has(r.status) && r.pauseReason) toast(r.pauseReason, 'warn'); }
      else if (a === 'stop') { if (await confirmModal({ title: 'Stop the run?', body: '<p>Progress is saved. The browser stays open. You can start again later.</p>', confirmText: 'Stop' })) await post('/api/run/stop'); }
      else if (a === 'retry') { await post('/api/run/retry-failed', { mode }); toast('Retrying failed and review items', 'ok'); }
      else if (a === 'reset') {
        if (await confirmModal({ title: 'Reset history?', danger: true, confirmText: 'Reset', body: '<p>All per-account results for this job are cleared, so finished accounts will be checked again (a backup file is written first). Run history stays.</p>' })) { await post('/api/run/reset', { mode }); toast('History reset', 'ok'); }
      }
      await hooks.refresh();
    } catch (e) { toast(e.message, 'err'); }
  });
  host.addEventListener('change', async ev => {
    const id = ev.target.id; if (id !== 'sp-preset' && id !== 'sp-interval') return;
    try {
      await post('/api/settings', id === 'sp-preset' ? { executionProfile: ev.target.value } : { actionIntervalSec: +ev.target.value });
    } catch (e) { toast(e.message, 'err'); }
    await hooks.refresh();
  });
  update();
  return { update };
}

/** Browser + Instagram session health card with the tabs the app tracks. */
export function healthPanel(host) {
  host.innerHTML = `<div class="row" style="justify-content:space-between"><h2 style="margin:0">Browser health</h2><span class="chip" id="h-chip"></span></div>
    <div class="stats" id="h-rows" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))"></div>
    <div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>Tab</th><th>Role</th><th>Page</th></tr></thead><tbody id="h-tabs"></tbody></table></div>
    <div class="row" style="margin-top:12px">
      <button class="btn sm" data-h="open">Open Instagram</button><button class="btn sm" data-h="verify">Verify login</button>
      <input type="text" id="h-user" placeholder="username" aria-label="Username to inspect" style="width:150px"><button class="btn sm" data-h="inspect">Open in separate tab</button>
    </div>
    <div class="sub" style="margin:8px 0 0;font-size:12px">Inspection tabs are separate from the automation tab and are never touched by a running job.</div>`;
  const row = (v, l, cls = '') => `<div class="stat"><b class="${cls}">${esc(v)}</b><span>${l}</span></div>`;
  function update() {
    const h = store.data?.browser; if (!h) return;
    const s = h.session || {}, e = store.data.engine;
    const ok = h.open && s.state === 'AUTHENTICATED', bad = !h.open || ['LOGIN_REQUIRED', 'SECURITY', 'DISCONNECTED'].includes(s.state);
    $('#h-chip', host).innerHTML = `<span class="dot ${ok ? 'ok' : bad ? 'bad' : 'warn'}"></span>${ok ? 'Healthy' : bad ? 'Needs attention' : 'Not verified'}`;
    const cur = (h.tabs || []).find(t => t.role === 'action');
    $('#h-rows', host).innerHTML = row(h.open ? 'Connected' : 'Closed', 'Browser')
      + row(label(s.state || 'UNVERIFIED'), 'Instagram login', s.state === 'AUTHENTICATED' ? 'ok-t' : '') + row(s.account ? '@' + s.account : '—', 'Account')
      + row(s.verifiedAt ? fmtDate(s.verifiedAt) : 'never', 'Last verified') + row(cur ? cur.id : '—', 'Automation tab') + row(String((h.tabs || []).length), 'Open tabs')
      + row(e.current ? '@' + e.current : '—', 'Current account') + row(e.operation || '—', 'Current operation') + row(h.profileLockedBy ? `pid ${h.profileLockedBy}` : 'free', 'Profile lock');
    $('#h-tabs', host).innerHTML = (h.tabs || []).map(t => `<tr><td>${esc(t.id)}</td><td>${esc(t.role)}</td><td class="muted" style="max-width:420px;overflow:hidden;text-overflow:ellipsis">${esc(t.url)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No tabs open.</td></tr>';
    if (s.reason && s.state !== 'AUTHENTICATED') $('#h-rows', host).insertAdjacentHTML('afterend', '');
  }
  host.addEventListener('click', async ev => {
    const a = ev.target.closest('[data-h]')?.dataset.h; if (!a) return;
    try {
      if (a === 'open') { await post('/api/browser/open'); toast('Instagram window opened. Log in there, then press Verify login.'); }
      if (a === 'verify') { const r = await post('/api/session/verify'); toast(r.state === 'AUTHENTICATED' ? `Instagram verified${r.account ? ' (@' + r.account + ')' : ''}` : (r.reason || 'Login not verified'), r.state === 'AUTHENTICATED' ? 'ok' : 'warn'); }
      if (a === 'inspect') { const u = $('#h-user', host).value.trim(); if (!u) return toast('Enter a username first', 'warn'); const r = await post('/api/tabs/open', { username: u }); toast(r.reused ? 'That profile is already open; focused it.' : 'Opened in a separate tab.', 'ok'); }
      await hooks.refresh();
    } catch (e) { toast(e.message, 'err'); }
  });
  update();
  return { update };
}
