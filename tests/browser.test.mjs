// Drives the REAL session manager / tab manager / detector / executor / engine in a real (headless) browser against local mock pages.
// Every request to instagram.com is intercepted and answered from tests/fixtures/pages.mjs; all other traffic is blocked.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { BrowserSessionManager } from '../src/automation/browser-session-manager.mjs';
import { pickButton } from '../src/automation/action-executor.mjs';
import { FOLLOWING_BTN } from '../src/automation/relationship-detector.mjs';
import { AutomationController } from '../src/automation/automation-controller.mjs';
import { CheckpointService } from '../src/services/checkpoint-service.mjs';
import { Logger } from '../src/services/logger-service.mjs';
import { rel, homePage } from './fixtures/pages.mjs';
import { ERR } from '../src/automation/errors.mjs';

process.env.NF_HEADLESS = '1';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-br-'));
const logger = new Logger(dir);
const mk = (extra = {}) => new BrowserSessionManager({ logger, profileDir: path.join(dir, 'profile'), lockFile: path.join(dir, 'lock'), stateTimeout: 2500, ...extra });
const session = mk();
const KIND = { f1: 'following', f2: 'following', n1: 'notFollowing', gone: 'unavailable', blk: 'blocked', cap: 'captcha', req: 'requested', blank: 'blank', bio: 'bioWords', out: 'login', rq1: 'requestedMenu', rq2: 'requestedMenu', rq3: 'requestedMenu', acc: 'following' };
const unfollowed = new Set();
const mode = { home: 'in' };
let ok = false;
const COOKIE = { name: 'sessionid', value: 'fixture-only', domain: '.instagram.com', path: '/', expires: Math.floor(Date.now() / 1000) + 86400 };

async function wire(s) {
  await s.ctx.route('**/*', route => route.abort());   // hermetic: nothing may reach the real network
  await s.ctx.route('https://www.instagram.com/**', route => {
    const url = new URL(route.request().url());
    const seg = url.pathname.split('/').filter(Boolean);
    const page = body => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html>${body}</html>` });
    if (seg[0] === '__unfollowed') { unfollowed.add(seg[1]); return route.fulfill({ body: 'ok' }); }
    if (!seg.length) return page(homePage(mode.home));
    if (seg[0] === 'accounts') return page(homePage('login'));
    if (seg[0] === 'challenge') return page(homePage('security'));
    const name = seg[0]; let kind = KIND[name];
    if (unfollowed.has(name)) kind = 'notFollowing';
    return page(`<body>${rel(name, kind || 'blank')}</body>`);
  });
}

before(async () => {
  try { await session.ensureBrowser(); await session.ctx.addCookies([COOKIE]); await wire(session); ok = true; }
  catch (e) { console.log('# browser not available, skipping:', e.message.split('\n')[0]); }
});
after(async () => { await session.close(); });
const guard = fn => async t => { if (!ok) return t.skip('no browser available'); await fn(t); };
const settle = async (engine, ms = 60000) => { const end = Date.now() + ms; while (engine.active && Date.now() < end) await new Promise(r => setTimeout(r, 80)); };
const engineFor = (cp, job = 'unfollow', cfg = {}) => new AutomationController({ ig: session, checkpoint: cp, logger, job, getSettings: () => ({ actionIntervalSec: 0, navigationTimeoutSec: 20, elementTimeoutSec: 3, maxAttempts: 2, maxPerRun: 99, errorThreshold: 5, ...cfg }) });

test('following -> unfollow is verified from the page (button name has an icon label), and a revisit shows not following', guard(async () => {
  assert.equal((await session.inspect('f1')).state, 'FOLLOWING');
  assert.equal((await session.unfollow()).state, 'NOT_FOLLOWING');
  assert.ok(unfollowed.has('f1'));
  assert.equal((await session.inspect('f1')).state, 'NOT_FOLLOWING');
}));

test('every page type is classified correctly', guard(async () => {
  const want = { n1: 'NOT_FOLLOWING', gone: 'UNAVAILABLE', blk: 'ACTION_BLOCKED', cap: 'CAPTCHA', req: 'REQUESTED', out: 'LOGIN_REQUIRED', bio: 'FOLLOWING', blank: 'AMBIGUOUS', rq1: 'REQUESTED' };
  for (const [u, state] of Object.entries(want)) assert.equal((await session.inspect(u)).state, state, u);
  assert.equal((await session.inspect('n1')).followsYou, true);
}));

test('locator guard: not found / hidden / two matches / disabled are classified BEFORE any click (no 8 s timeout)', guard(async () => {
  const page = await session.tabs.action();
  const t0 = Date.now();
  const cases = [
    ['<header><button>Message</button></header>', ERR.ELEMENT_NOT_FOUND],
    ['<header><button style="display:none">Following</button></header>', ERR.ELEMENT_NOT_VISIBLE],
    ['<header><button>Following</button><button>Following</button></header>', ERR.RELATIONSHIP_AMBIGUOUS],
    ['<header><button disabled>Following</button></header>', ERR.ELEMENT_NOT_ENABLED],
  ];
  for (const [html, code] of cases) {
    await page.setContent(html);
    await assert.rejects(() => pickButton(page, FOLLOWING_BTN, 800), e => e.code === code, code);
  }
  await page.setContent('<header><button>Following<svg aria-label="Down chevron icon"><title>Down chevron icon</title></svg></button></header>');
  assert.ok(await pickButton(page, FOLLOWING_BTN, 800), 'a single visible enabled button is accepted');
  assert.ok(Date.now() - t0 < 6000, 'classification is fast, not an 8 s timeout');
}));

test('verifySession: logged-in home page is AUTHENTICATED and names the account', guard(async () => {
  mode.home = 'in';
  const r = await session.verifySession({ navTimeout: 8000, elementTimeout: 3000 });
  assert.equal(r.state, 'AUTHENTICATED'); assert.equal(r.account, 'tester');
  assert.equal(session.sessionInfo.state, 'AUTHENTICATED'); assert.ok(session.sessionInfo.verifiedAt);
}));

test('verifySession: login page, cookie-but-expired, and security verification are told apart', guard(async () => {
  mode.home = 'login';
  assert.equal((await session.verifySession({ navTimeout: 8000, elementTimeout: 2000 })).state, 'LOGIN_REQUIRED', 'login page (cookie present = expired server-side)');
  assert.equal(session.sessionInfo.state, 'LOGIN_REQUIRED', 'never reported as logged in');
  mode.home = 'security';
  assert.equal((await session.verifySession({ navTimeout: 8000, elementTimeout: 2000 })).state, 'SECURITY');
  mode.home = 'blank';
  assert.equal((await session.verifySession({ navTimeout: 8000, elementTimeout: 1500 })).state, 'UNKNOWN', 'unfinished page is not "logged in"');
  await session.ctx.clearCookies();
  mode.home = 'in';
  assert.equal((await session.verifySession({ navTimeout: 8000, elementTimeout: 2000 })).state, 'LOGIN_REQUIRED', 'no cookie = not logged in even if the page renders');
  await session.ctx.addCookies([COOKIE]);                  // manual login done
  assert.equal((await session.verifySession({ navTimeout: 8000, elementTimeout: 2000 })).state, 'AUTHENTICATED');
}));

test('multiple manual tabs: tracked by id, never duplicated, closed tabs detected, action tab unaffected', guard(async () => {
  mode.home = 'in';
  const action = await session.tabs.action();
  const a = await session.openManualTab('https://www.instagram.com/n1/');
  const b = await session.openManualTab('https://www.instagram.com/bio/');
  const again = await session.openManualTab('https://www.instagram.com/n1/');
  assert.equal(again.reused, true); assert.equal(again.id, a.id, 'same profile is focused, not opened twice');
  const list = (await session.health()).tabs;
  assert.equal(list.filter(t => t.role === 'manual').length >= 2, true);
  assert.equal(list.filter(t => t.role === 'action').length, 1);
  assert.equal(new Set(list.map(t => t.id)).size, list.length, 'unique tab ids');
  const manual = [...session.tabs.tabs.values()].find(t => t.id === b.id);
  await manual.page.close();
  assert.equal((await session.health()).tabs.some(t => t.id === b.id), false, 'closed tab is no longer listed');
  assert.equal(await session.tabs.action(), action, 'the engine tab was not touched');
}));

test('closed action tab is detected and replaced; inspection keeps working', guard(async () => {
  const before = await session.tabs.action();
  await before.close();
  assert.equal(session.tabs.actionId, null);
  assert.equal((await session.inspect('n1')).state, 'NOT_FOLLOWING');
  assert.notEqual(await session.tabs.action(), before);
}));

test('browser closed: detected, reported as closed, reopened on the same profile; login must be re-verified (never assumed)', guard(async () => {
  await session.verifySession({ navTimeout: 8000, elementTimeout: 3000 });
  assert.equal(session.sessionInfo.state, 'AUTHENTICATED');
  await session.ctx.close();
  assert.equal(session.open, false);
  assert.equal((await session.health()).browser, 'closed');
  assert.equal(session.sessionInfo.state, 'UNVERIFIED', 'after a close the login is unverified until checked again');
  await session.ensureBrowser(); await wire(session);
  assert.equal(session.open, true);
  assert.equal(session.sessionInfo.state, 'UNVERIFIED');
  assert.equal(await session.loggedIn(), true, 'same profile: the saved login survived the restart');
  assert.equal((await session.verifySession({ navTimeout: 8000, elementTimeout: 3000 })).state, 'AUTHENTICATED');
}));

test('duplicate browser profile: a second manager on the same profile is refused with a clear message, not a silent new browser', guard(async () => {
  const dup = mk({ lockFile: path.join(dir, 'lock-b') });
  await assert.rejects(() => dup.ensureBrowser(), e => e.code === 'BROWSER_LAUNCH' && /already open|already uses/.test(e.message));
  assert.equal(dup.open, false);
}));

test('profile lock held by another live process is refused; a stale one is replaced', guard(async () => {
  const lockFile = path.join(dir, 'lock-c');
  fs.writeFileSync(lockFile, String(process.ppid));
  const m = mk({ profileDir: path.join(dir, 'profile-c'), lockFile });
  await assert.rejects(() => m.ensureBrowser(), e => e.code === 'BROWSER_LAUNCH' && /Another NoFollow Web process/.test(e.message));
  fs.writeFileSync(lockFile, '99999999');
  await m.ensureBrowser();
  assert.equal(m.open, true);
  await m.close();
}));

test('engine over the real session: login, mixed batch, block pause and Resume re-verification', guard(async () => {
  mode.home = 'in';
  const cp = new CheckpointService(path.join(dir, 'state.json'));
  const engine = engineFor(cp);
  await engine.start(['f2', 'gone', 'n1x', 'blank', 'blk', 'bio']);
  const end = Date.now() + 60000;
  while (engine.status !== 'SAFETY_PAUSED' && Date.now() < end) await new Promise(r => setTimeout(r, 100));
  assert.equal(engine.status, 'SAFETY_PAUSED');
  assert.equal(session.open, true, 'browser stays open on a safety pause');
  const st = u => cp.statusOf(u);
  assert.deepEqual(['f2', 'gone', 'n1x', 'blank', 'blk', 'bio'].map(st), ['UNFOLLOWED', 'PROFILE_UNAVAILABLE', 'NEEDS_REVIEW', 'NEEDS_REVIEW', 'ACTION_BLOCKED', 'PENDING']);
  mode.home = 'login';                                   // user presses Resume but the login is gone
  await engine.resume();
  assert.equal(engine.status, 'LOGIN_REQUIRED');
  mode.home = 'in'; KIND.blk = 'following';              // user logs in again; Instagram no longer blocks
  await engine.resume(); await settle(engine);
  assert.equal(st('blk'), 'UNFOLLOWED'); assert.equal(st('bio'), 'UNFOLLOWED');
  assert.equal(session.open, true);
}));

test('active automation during manual inspection: the run finishes and the manual tab is left alone', guard(async () => {
  mode.home = 'in';
  Object.assign(KIND, { m1: 'following', m2: 'following', m3: 'following', insp: 'notFollowing' });
  const cp = new CheckpointService(path.join(dir, 'state-m.json'));
  const engine = engineFor(cp, 'unfollow', { actionIntervalSec: 1 });
  await engine.start(['m1', 'm2', 'm3']);
  while (engine.status !== 'RUNNING') await new Promise(r => setTimeout(r, 50));
  const tab = await session.openManualTab('https://www.instagram.com/insp/');       // user inspects another account meanwhile
  await new Promise(r => setTimeout(r, 400));
  const manual = [...session.tabs.tabs.values()].find(t => t.id === tab.id).page;
  await settle(engine, 60000);
  assert.deepEqual(['m1', 'm2', 'm3'].map(u => cp.statusOf(u)), ['UNFOLLOWED', 'UNFOLLOWED', 'UNFOLLOWED']);
  assert.match(manual.url(), /\/insp\//, 'the inspection tab still shows the account the user opened');
  assert.equal(manual.isClosed(), false);
  assert.equal(cp.statusOf('insp'), 'PENDING', 'the engine never touched the manually inspected account');
}));

test('cancel pending request over the real session: Requested menu -> verified Follow; accepted and already-cancelled are not clicked', guard(async () => {
  mode.home = 'in';
  const cp = new CheckpointService(path.join(dir, 'state-c.json'));
  const engine = engineFor(cp, 'cancel');
  await engine.start(['rq1', 'rq2', 'acc', 'n1']);
  await settle(engine);
  assert.deepEqual(['rq1', 'rq2', 'acc', 'n1'].map(u => cp.statusOf(u)), ['CANCELLED', 'CANCELLED', 'ACCEPTED', 'ALREADY_CANCELLED']);
  assert.ok(unfollowed.has('rq1') && unfollowed.has('rq2'));
  assert.equal(unfollowed.has('acc'), false, 'an accepted follow was NOT undone');
}));
