// End-to-end UI + API test: real server, real browser, FAKE Instagram session (nothing here automates instagram.com).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { chromium } from 'playwright-core';
import { createApp } from '../src/server.mjs';
import { html, followersHtml, tableHtml } from './fixtures/pages.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-ui-'));
const u = (p, a, b) => Array.from({ length: b - a + 1 }, (_, i) => `${p}${String(a + i).padStart(3, '0')}`);
const following = u('user', 1, 130);                       // user101..user130 are the 30 non-followers
const followers = [...u('user', 1, 100), ...u('fan', 1, 5)];
const pending = [...u('pend', 1, 17), 'pendacc', 'pendgone', 'pendsame'];          // 20 outgoing requests
const incoming = u('incoming', 1, 5);
const w = (f, body) => { fs.writeFileSync(path.join(dir, f), body); return path.join(dir, f); };
const urls = l => l.map(x => `https://www.instagram.com/${x}`);
const files = [
  w('following.html', html(following, 'Jan 05, 2018 1:00 pm')), w('followers_1.html', followersHtml(followers, 'Feb 05, 2018 1:00 pm')),
  w('pending_follow_requests.html', tableHtml(urls(pending))), w("follow_requests_you've_received.html", tableHtml(urls(incoming))),
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const calls = []; const manual = [];
const fakeIg = {
  open: true, sessionState: 'AUTHENTICATED',
  async ensureBrowser() {}, async openLogin() {}, async close() {}, async screenshot() { return null; },
  async loggedIn() { return fakeIg.sessionState === 'AUTHENTICATED'; },
  async verifySession() { return { state: fakeIg.sessionState, account: 'tester', reason: fakeIg.sessionState === 'AUTHENTICATED' ? null : 'Instagram shows the login page.' }; },
  async health() { return { open: true, browser: 'connected', tabs: [{ id: 't1', role: 'action', url: 'about:blank' }, ...manual.map((m, i) => ({ id: `t${i + 2}`, role: 'manual', url: m }))], session: { state: fakeIg.sessionState, account: 'tester', verifiedAt: new Date().toISOString() }, profileLockedBy: null }; },
  async openManualTab(url) { const dup = manual.includes(url); if (!dup) manual.push(url); return { id: 't2', reused: dup, url }; },
  async inspect(name) {
    calls.push(name); await sleep(80);
    if (name.startsWith('pend')) return { state: name === 'pendacc' ? 'FOLLOWING' : name === 'pendgone' ? 'UNAVAILABLE' : name === 'pendsame' ? 'NOT_FOLLOWING' : 'REQUESTED' };
    return { state: 'FOLLOWING' };
  },
  async unfollow() { await sleep(40); return { state: 'NOT_FOLLOWING' }; },
  async cancelRequest() { await sleep(40); return { state: 'NOT_FOLLOWING' }; },
};

let app, base, browser, page, ok = false, shutdownCalled = 0;
const errors = [];

before(async () => {
  app = createApp({ dataDir: path.join(dir, 'data'), logsDir: path.join(dir, 'logs'), ig: fakeIg, testSettings: { actionIntervalSec: 0.2 }, onShutdown: () => { shutdownCalled++; } });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
    page = await browser.newPage();
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text()}`); });
    ok = true;
  } catch (e) { console.log('# browser not available, skipping:', e.message.split('\n')[0]); }
});
after(async () => { await browser?.close(); app.server.closeAllConnections?.(); app.server.close(); });
const guard = fn => async t => { if (!ok) return t.skip('no browser available'); await fn(t); };
const chip = n => page.waitForFunction(x => document.querySelector('#selc')?.textContent === `${x} selected`, n);
const kpi = name => page.locator('.kpi', { hasText: name }).locator('.value').first().innerText();
const engineChip = re => page.waitForFunction(r => new RegExp(r, 'i').test(document.querySelector('#e-chip')?.textContent || ''), re.source, { timeout: 60000 });
const nav = async id => { await page.click(`a[data-id="${id}"]`); await page.waitForFunction(i => location.hash === `#/${i}`, id); };

test('empty state before any import', guard(async () => {
  await page.goto(base);
  await page.waitForSelector('.kpi');
  assert.equal(await kpi("Don't follow back"), '0');
  assert.ok(await page.locator('text=No data imported yet').first().isVisible());
}));

test('navigation: every sidebar page opens without errors', guard(async () => {
  for (const id of ['non-followers', 'followers', 'following', 'mutual-followers', 'pending-requests', 'recently-unfollowed', 'blocked-profiles', 'execution-history', 'import-data', 'settings', 'dashboard']) {
    await nav(id);
    assert.ok((await page.locator('h1').first().innerText()).length > 0, id);
  }
}));

test('import multiple files (HTML, incl. sent and received requests): totals correct, no warning', guard(async () => {
  await nav('import-data');
  await page.setInputFiles('#files', files);
  await page.click('#go');
  await page.waitForSelector('text=Review non-followers');
  assert.ok(await page.locator('text=Export looks complete.').isVisible());
  await nav('dashboard');
  await page.waitForSelector('.kpi');
  assert.equal(await kpi('Total following'), '130');
  assert.equal(await kpi('Total followers'), '105');
  assert.equal(await kpi("Don't follow back"), '30');
  assert.equal(await kpi('Mutual followers'), '100');
}));

test('dashboard shows browser health: browser, verified Instagram login, account, tabs and current work', guard(async () => {
  await nav('dashboard');
  await page.waitForSelector('#h-rows');
  const text = await page.locator('#health').innerText();
  assert.match(text, /Connected/); assert.match(text, /Authenticated/i); assert.match(text, /@tester/); assert.match(text, /Automation tab/i); assert.match(text, /Healthy/);
  assert.match(await page.locator('#chip-ig').innerText(), /Instagram verified \(@tester\)/);
  assert.match(await page.locator('#chip-browser').innerText(), /Browser connected/);
}));

test('browser panel: separate inspection tabs are opened without duplicates; login verification works', guard(async () => {
  await page.fill('#h-user', 'someone');
  await page.click('[data-h=inspect]');
  await page.waitForSelector('.toast:has-text("separate tab")');
  await page.click('[data-h=inspect]');
  await page.waitForSelector('.toast:has-text("already open")');
  assert.equal(manual.length, 1);
  await page.waitForFunction(() => document.querySelector('#h-tabs')?.textContent.includes('manual'));
  await page.click('[data-h=verify]');
  await page.waitForSelector('.toast:has-text("Instagram verified")');
}));

test('table: search, status filter, sorting, pagination', guard(async () => {
  await nav('non-followers');
  await page.waitForSelector('tbody tr td a');
  assert.equal(await page.locator('tbody tr').count(), 30);
  await page.fill('#q', 'user11');
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 10);
  await page.fill('#q', '');
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 30);
  await page.selectOption('#st', 'UNFOLLOWED');
  await page.waitForSelector('text=No accounts match');
  await page.selectOption('#st', '');
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 30);
  await page.click('th[data-sort=username]');
  await page.waitForFunction(() => document.querySelector('tbody tr a')?.textContent === '@user130');
  await page.selectOption('#sz', '25');
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 25);
  assert.ok(/Page 1 of 2/.test(await page.locator('#pg').innerText()));
  await page.click('[data-p="1"]');
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 5);
  await page.selectOption('#sz', '50');
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 30);
}));

test('bulk selection: nothing preselected, select page / filtered / pending / clear', guard(async () => {
  await nav('followers');
  await page.waitForSelector('tbody tr td a');
  await page.click('[data-list=fans]');
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 5);
  await nav('non-followers');
  await page.waitForSelector('#selc');
  assert.equal(await page.locator('#selc').innerText(), '0 selected');
  assert.ok(await page.locator('[data-a=start]').isDisabled());
  await page.click('[data-s=page]'); await chip(30);
  await page.click('[data-s=clear]'); await chip(0);
  await page.fill('#q', 'user12');
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 10);
  await page.click('[data-s=filtered]'); await chip(10);
  await page.fill('#q', '');
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 30);
  await page.click('[data-s=pending]'); await chip(30);
}));

test('run: confirm, live progress, pause, Resume re-verifies the login (blocked until really logged in), results persisted', guard(async () => {
  await page.click('[data-a=start]');
  await page.waitForSelector('.modal');
  await page.click('.modal [data-r="0"]');                // cancel: nothing starts
  assert.equal(calls.length, 0);
  await page.click('[data-a=start]');
  await page.click('.modal [data-r="1"]');
  await engineChip(/running/);
  await page.waitForFunction(() => parseFloat(document.querySelector('#e-bar')?.style.width) > 0);
  await page.click('[data-a=pause]');
  await engineChip(/paused/);
  const mid = await page.locator('#e-bar').evaluate(e => parseFloat(e.style.width));
  assert.ok(mid > 0 && mid < 100, `progress should be partial while paused, was ${mid}`);
  fakeIg.sessionState = 'LOGIN_REQUIRED';                 // Resume pressed, but the user is not logged in
  await page.click('[data-a=resume]');
  await engineChip(/login required/);
  assert.match(await page.locator('#e-warn').innerText(), /login/i);
  assert.match(await page.locator('#chip-engine').innerText(), /login required/i);
  fakeIg.sessionState = 'AUTHENTICATED';                  // user logged in manually
  await page.click('[data-a=resume]');
  await engineChip(/completed|idle/);
  assert.equal(await page.locator('#e-bar').evaluate(e => parseFloat(e.style.width)), 100);
  assert.equal(app.checkpoints.unfollow.counts().UNFOLLOWED, 30);
  assert.equal(new Set(calls).size, calls.length, 'no account visited twice');
  await page.waitForFunction(() => document.querySelectorAll('tbody .b-UNFOLLOWED').length === 30);
  await nav('execution-history');
  await page.waitForSelector('#runs tr td');
  assert.ok(/completed/i.test(await page.locator('#runs tr').first().innerText()));
  assert.ok(await page.locator('#log div').count() > 0);
}));

test('pending requests: sent and received are separated; received can never be selected or cancelled', guard(async () => {
  await nav('pending-requests');
  await page.waitForSelector('#rq-kpis .kpi');
  assert.equal(await kpi('Total pending requests'), '20');
  assert.equal(await kpi('Remaining'), '20');
  assert.equal(await kpi('Received requests (info)'), '5');
  assert.match(await page.locator('.notice').first().innerText(), /Sent requests/);
  await page.waitForFunction(() => document.querySelectorAll('#tb tr').length === 20);
  assert.equal(await page.locator('#tb input[type=checkbox]').count(), 20);
  assert.equal(await page.locator('[data-c]').count(), 20);
  await page.click('[data-list=incoming]');
  await page.waitForFunction(() => document.querySelectorAll('#tb tr').length === 5);
  assert.equal(await page.locator('#tb input[type=checkbox]').count(), 0, 'incoming requests have no checkboxes');
  assert.equal(await page.locator('[data-c]').count(), 0, 'incoming requests have no cancel button');
  assert.match(await page.locator('.notice').nth(0).innerText(), /Received requests/);
  assert.equal(await page.locator('[data-a=all]').count(), 1);
  await page.click('[data-list=pending]');
  await page.waitForFunction(() => document.querySelectorAll('#tb tr').length === 20);
}));

test('pending requests: search, select all pending / filtered / clear, cancel one request', guard(async () => {
  await page.fill('#q', 'pend01');
  await page.waitForFunction(() => document.querySelectorAll('#tb tr').length === 8);
  await page.click('[data-s=filtered]');
  await page.waitForFunction(() => document.querySelector('#selc')?.textContent === '8 selected');
  assert.equal(await kpi('Selected'), '8');
  await page.click('[data-s=clear]'); await chip(0);
  await page.fill('#q', '');
  await page.waitForFunction(() => document.querySelectorAll('#tb tr').length === 20);
  await page.click('[data-s=pending]'); await chip(20);
  await page.click('[data-s=clear]'); await chip(0);
  await page.click('[data-c=pend001]');
  await page.waitForSelector('.modal');
  await page.click('.modal [data-r="0"]');
  assert.equal(app.checkpoints.cancel.statusOf('pend001'), 'PENDING', 'declined confirmation cancels nothing');
  await page.click('[data-c=pend001]');
  await page.click('.modal [data-r="1"]');
  await engineChip(/completed|idle/);
  assert.equal(app.checkpoints.cancel.statusOf('pend001'), 'CANCELLED');
  await page.waitForFunction(() => document.querySelector('[data-c=pend001]')?.disabled === true);
  assert.equal(await kpi('Successfully cancelled'), '1');
  assert.equal(await kpi('Remaining'), '19');
}));

test('Cancel All Pending: exact count in the confirmation, sequential run, accurate summary, history, persisted state, exclusivity', guard(async () => {
  await page.click('[data-a=all]');
  await page.waitForSelector('.modal');
  const dlg = await page.locator('.modal').innerText();
  assert.match(dlg, /Cancel All Pending Follow Requests\?/);
  assert.match(dlg, /process\s+19\s+outgoing pending follow requests/);
  assert.match(dlg, /1 request\(s\) that already have a result are excluded/);
  await page.click('.modal [data-r="0"]');
  assert.equal(app.checkpoints.cancel.counts().CANCELLED, 1, 'declined: nothing processed');
  await page.click('[data-a=all]');
  await page.click('.modal [data-r="1"]');
  await engineChip(/running/);
  const other = await fetch(`${base}/api/run/start`, { method: 'POST', headers: { 'X-NoFollow': '1' }, body: JSON.stringify({ usernames: ['user001'], confirm: true }) });
  assert.equal(other.status, 409);
  assert.match((await other.json()).error, /Another automation is already running/);
  await engineChip(/completed|idle/);
  const c = app.checkpoints.cancel.counts();
  assert.deepEqual([c.CANCELLED, c.ACCEPTED, c.PROFILE_UNAVAILABLE, c.ALREADY_CANCELLED, c.FAILED, c.NEEDS_REVIEW], [17, 1, 1, 1, 0, 0]);
  await page.waitForFunction(() => document.querySelector('#k-rem')?.textContent === '0');
  assert.equal(await kpi('Successfully cancelled'), '17');
  assert.equal(await kpi('Accepted'), '1');
  assert.equal(await kpi('Already cancelled'), '1');
  assert.equal(await kpi('Profile unavailable'), '1');
  assert.match(await page.locator('#rhist').innerText(), /completed/i);
  assert.equal(calls.filter(n => n === 'pendacc').length, 1);
  assert.equal(app.checkpoints.unfollow.statusOf('pendacc'), 'PENDING', 'the unfollow history is untouched by cancellation');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'cancellation-state.json'), 'utf8'));
  assert.equal(saved.accounts.pend002.status, 'CANCELLED');
  assert.equal(saved.accounts.pendacc.status, 'ACCEPTED');
  assert.equal(saved.runs[0].job, 'cancel');
  assert.equal(await page.locator('[data-a=all]').isDisabled(), true, 'nothing left to cancel');
}));

test('no incoming request is ever sent to the engine, even through the API', guard(async () => {
  const r = await fetch(`${base}/api/run/start`, { method: 'POST', headers: { 'X-NoFollow': '1' }, body: JSON.stringify({ mode: 'cancel', usernames: incoming, confirm: true }) });
  assert.equal(r.status, 409);                            // none of them is an outgoing request -> nothing to do
  assert.equal(calls.filter(n => n.startsWith('incoming')).length, 0);
}));

test('already finished accounts are skipped on a second run', guard(async () => {
  const before = calls.length;
  const r = await fetch(`${base}/api/run/start`, { method: 'POST', headers: { 'X-NoFollow': '1' }, body: JSON.stringify({ usernames: following.slice(100), confirm: true }) });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /Nothing to do/);
  assert.equal(calls.length, before);
}));

test('automation settings: profile sets the interval, values persist, invalid values are rejected and nothing changes silently', guard(async () => {
  await nav('settings');
  await page.waitForSelector('#s-actionIntervalSec');
  await page.selectOption('#s-executionProfile', 'safe');
  assert.equal(await page.inputValue('#s-actionIntervalSec'), '30');
  await page.fill('#s-actionIntervalSec', '20');
  assert.equal(await page.inputValue('#s-executionProfile'), 'custom');
  await page.fill('#s-navigationTimeoutSec', '45'); await page.fill('#s-elementTimeoutSec', '12'); await page.fill('#s-maxAttempts', '3');
  await page.click('#save');
  await page.waitForSelector('.toast:has-text("Settings saved")');
  const s = app.getSettings();
  assert.deepEqual([s.actionIntervalSec, s.navigationTimeoutSec, s.elementTimeoutSec, s.maxAttempts, s.executionProfile], [20, 45, 12, 3, 'custom']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'data', 'settings.json'), 'utf8')).actionIntervalSec, 20, 'saved to disk');
  await page.fill('#s-actionIntervalSec', '1');           // below the minimum
  await page.click('#save');
  await page.waitForSelector('.toast.err');
  assert.match(await page.locator('.toast.err').first().innerText(), /between 2 and 600/);
  assert.equal(app.getSettings().actionIntervalSec, 20, 'rejected value did not change anything');
  await page.fill('#s-actionIntervalSec', '20'); await page.fill('#s-maxAttempts', '9');
  await page.click('#save');
  await page.waitForFunction(() => [...document.querySelectorAll('.toast.err')].some(t => /Retries per account/.test(t.textContent)));
  assert.equal(app.getSettings().maxAttempts, 3);
}));

test('dashboard panel shows the configuration in use and can switch profile; the engine reads it', guard(async () => {
  await nav('dashboard');
  await page.waitForSelector('#e-cfg');
  assert.match(await page.locator('#e-cfg').innerText(), /interval 20 s · navigation timeout 45 s · element timeout 12 s · retries 3 · one action at a time/);
  await page.selectOption('#sp-preset', 'balanced');
  await page.waitForFunction(() => /interval 15 s/.test(document.querySelector('#e-cfg')?.textContent || ''));
  assert.equal(app.getSettings().actionIntervalSec, 15);
  assert.equal(app.engine.snapshot().intervalSec, 15, 'the engine uses the saved value');
  await page.fill('#sp-interval', '1'); await page.locator('#sp-interval').blur();
  await page.waitForSelector('.toast.err');
  assert.equal(app.getSettings().actionIntervalSec, 15);
  await page.waitForFunction(() => document.querySelector('#sp-interval')?.value === '15', null, { timeout: 5000 });
}));

test('theme switch and state survives a reload', guard(async () => {
  await page.click('#theme');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  await page.click('#theme');
  await page.reload();
  await page.waitForSelector('h1');
  await nav('dashboard');
  assert.equal(await kpi('Successfully unfollowed'), '30');
}));

test('API safety, duplicate-process ping and clean shutdown endpoint, no JS errors', guard(async () => {
  assert.equal((await fetch(`${base}/api/run/start`, { method: 'POST', body: '{}' })).status, 403);
  const code = await new Promise(res => { const req = http.request(base + '/api/state', { headers: { Host: 'evil.example' } }, r => { r.resume(); res(r.statusCode); }); req.end(); });
  assert.equal(code, 403);
  const r = await fetch(`${base}/api/run/start`, { method: 'POST', headers: { 'X-NoFollow': '1' }, body: JSON.stringify({ usernames: ['stranger_not_followed'], confirm: true }) });
  assert.equal(r.status, 409);
  assert.equal((await fetch(`${base}/src/server.mjs`)).status, 404);
  assert.equal((await (await fetch(`${base}/api/ping`)).json()).app, 'nofollow-web');
  assert.equal((await fetch(`${base}/api/shutdown`, { method: 'POST' })).status, 403, 'shutdown needs the header too');
  assert.equal((await fetch(`${base}/api/shutdown`, { method: 'POST', headers: { 'X-NoFollow': '1' } })).status, 200);
  await sleep(300);
  assert.equal(shutdownCalled, 1);
  assert.deepEqual(errors, []);
}));
