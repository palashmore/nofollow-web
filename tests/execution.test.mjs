import test from 'node:test';
import assert from 'node:assert/strict';
import { CheckpointService } from '../src/services/checkpoint-service.mjs';
import { AutomationController } from '../src/automation/automation-controller.mjs';
import { Logger } from '../src/services/logger-service.mjs';
import { AutomationError, ERR } from '../src/automation/errors.mjs';
import { TRANSITIONS, ENGINE } from '../src/utils/constants.mjs';
import { SETTINGS, sleep, fake, setup, untilIdle, untilStatus } from './fixtures/engine-helpers.mjs';

test('state machine: normal run goes STARTING > CHECKING_SESSION > RUNNING > COMPLETED', async () => {
  const { engine } = setup({ a: 'FOLLOWING' });
  await engine.start(['a']); await untilIdle(engine);
  assert.deepEqual(engine.history, ['STARTING', 'CHECKING_SESSION', 'RUNNING', 'COMPLETED']);
});

test('state machine table: no waiting state can go straight to RUNNING; each goes through CHECKING_SESSION', () => {
  for (const s of ['PAUSED', 'LOGIN_REQUIRED', 'RECOVERING', 'SAFETY_PAUSED']) {
    assert.ok(!TRANSITIONS[s].includes(ENGINE.RUNNING), `${s} -> RUNNING must be impossible`);
    assert.ok(TRANSITIONS[s].includes(ENGINE.CHECKING_SESSION), `${s} -> CHECKING_SESSION`);
  }
  assert.ok(!TRANSITIONS.IDLE.includes('RUNNING'));
  assert.ok(!TRANSITIONS.COMPLETED.includes('RUNNING'));
});

test('followed account: unfollowed only after the page confirms it', async () => {
  const { engine, checkpoint, ig } = setup({ a: 'FOLLOWING' });
  await engine.start(['a']); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('a'), 'UNFOLLOWED');
  assert.equal(ig.calls.unfollow, 1);
  assert.equal(checkpoint.get('a').result, 'UNFOLLOWED');
});

test('click that is NOT confirmed is never reported as success (retried, then FAILED with a reason)', async () => {
  const { engine, checkpoint } = setup({ a: 'FOLLOWING' }, { unfollowResult: 'FOLLOWING' });
  await engine.start(['a']); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('a'), 'FAILED');
  assert.match(checkpoint.get('a').reason, /not confirmed/);
});

test('already unfollowed: no action, not counted as failure', async () => {
  const { engine, checkpoint, ig } = setup({ a: 'NOT_FOLLOWING' });
  await engine.start(['a']); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('a'), 'ALREADY_UNFOLLOWED');
  assert.equal(ig.calls.unfollow, 0);
  assert.equal(engine.snapshot().failed, 0);
});

test('unavailable profile and pending request are recorded and the batch continues', async () => {
  const { engine, checkpoint } = setup({ gone: 'UNAVAILABLE', req: 'REQUESTED', ok: 'FOLLOWING' });
  await engine.start(['gone', 'req', 'ok']); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('gone'), 'PROFILE_UNAVAILABLE');
  assert.equal(checkpoint.statusOf('req'), 'SKIPPED');
  assert.equal(checkpoint.statusOf('ok'), 'UNFOLLOWED');
});

test('ambiguous page: no click is made, account goes to NEEDS_REVIEW', async () => {
  const { engine, checkpoint, ig } = setup({ a: 'AMBIGUOUS', b: 'FOLLOWING' });
  await engine.start(['a', 'b']); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('a'), 'NEEDS_REVIEW');
  assert.equal(checkpoint.get('a').errorCode, 'RELATIONSHIP_AMBIGUOUS');
  assert.equal(ig.calls.unfollow, 1);
  assert.equal(checkpoint.statusOf('b'), 'UNFOLLOWED');
});

test('locator timeout is classified, not retried blindly, and does not stop the batch', async () => {
  const timeout = new Error('locator.click: Timeout 8000ms exceeded.\nCall log:\n  - waiting for getByRole(button)');
  let n = 0;
  const { engine, checkpoint, ig } = setup({ a: 'FOLLOWING', b: 'FOLLOWING' }, { unfollowResult: () => (n++ === 0 ? timeout : 'NOT_FOLLOWING') });
  await engine.start(['a', 'b']); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('a'), 'NEEDS_REVIEW');
  assert.equal(checkpoint.get('a').errorCode, ERR.ELEMENT_NOT_FOUND);
  assert.equal(ig.calls.unfollow, 2, 'a was clicked once (no blind retry loop), b once');
  assert.equal(checkpoint.statusOf('b'), 'UNFOLLOWED');
});

test('missing Following button / not visible / not enabled / ambiguous are classified and sent to review', async () => {
  for (const code of [ERR.ELEMENT_NOT_FOUND, ERR.ELEMENT_NOT_VISIBLE, ERR.ELEMENT_NOT_ENABLED, ERR.RELATIONSHIP_AMBIGUOUS]) {
    const { engine, checkpoint } = setup({ a: 'FOLLOWING' }, { unfollowResult: new AutomationError(code, `x ${code}`) });
    await engine.start(['a']); await untilIdle(engine);
    assert.equal(checkpoint.statusOf('a'), 'NEEDS_REVIEW', code);
    assert.equal(checkpoint.get('a').errorCode, code);
  }
});

test('one failing account does not stop the batch; navigation errors are retried a bounded number of times', async () => {
  const boom = new Error('page.goto: Timeout 30000ms exceeded');
  const { engine, checkpoint, ig } = setup({ bad: boom, ok: 'FOLLOWING' });
  await engine.start(['bad', 'ok']); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('bad'), 'FAILED');
  assert.equal(checkpoint.get('bad').errorCode, ERR.NAVIGATION_TIMEOUT);
  assert.equal(ig.calls.inspect.filter(u => u === 'bad').length, 2);
  assert.equal(checkpoint.statusOf('ok'), 'UNFOLLOWED');
});

test('transient error then success on retry', async () => {
  const { engine, checkpoint } = setup({ a: [new Error('net::ERR_TIMED_OUT'), 'FOLLOWING'] });
  await engine.start(['a']); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('a'), 'UNFOLLOWED');
});

test('failure streak triggers a safety pause, resume (with a verified session) continues', async () => {
  const boom = new Error('boom');
  const { engine, checkpoint } = setup({ f1: boom, f2: boom, f3: boom, ok: 'FOLLOWING' });
  await engine.start(['f1', 'f2', 'f3', 'ok']);
  await untilStatus(engine, 'SAFETY_PAUSED');
  assert.match(engine.pauseReason, /consecutive failures/);
  assert.equal(checkpoint.statusOf('ok'), 'PENDING');
  await engine.resume(); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('ok'), 'UNFOLLOWED');
});

for (const [name, st] of [['action blocked', 'ACTION_BLOCKED'], ['captcha', 'CAPTCHA']]) {
  test(`${name}: pauses immediately without retrying, keeps progress, resume re-checks the same account`, async () => {
    const { engine, checkpoint, ig } = setup({ a: 'FOLLOWING', b: [st, 'FOLLOWING'], c: 'FOLLOWING' });
    await engine.start(['a', 'b', 'c']);
    await untilStatus(engine, 'SAFETY_PAUSED');
    assert.equal(checkpoint.statusOf('a'), 'UNFOLLOWED');
    assert.equal(checkpoint.statusOf('b'), 'ACTION_BLOCKED');
    assert.equal(ig.calls.inspect.filter(u => u === 'b').length, 1);
    assert.equal(checkpoint.statusOf('c'), 'PENDING');
    await engine.resume(); await untilIdle(engine);
    assert.deepEqual(['a', 'b', 'c'].map(u => checkpoint.statusOf(u)), ['UNFOLLOWED', 'UNFOLLOWED', 'UNFOLLOWED']);
  });
}

test('login expired mid-run: LOGIN_REQUIRED; Resume WITHOUT logging in stays LOGIN_REQUIRED; after login it continues', async () => {
  let loggedIn = true;
  const { engine, checkpoint, ig } = setup({ a: 'FOLLOWING', b: 'FOLLOWING' }, { loggedIn: () => loggedIn }, { actionIntervalSec: 0.3 });
  await engine.start(['a', 'b']);
  await sleep(100); loggedIn = false; ig.session = { state: 'LOGIN_REQUIRED', reason: 'Instagram shows the login page.' };
  await untilStatus(engine, 'LOGIN_REQUIRED');
  assert.ok(!checkpoint.isFinal('b'));
  const verifies = ig.calls.verify;
  await engine.resume();                                                  // clicked Resume, but nobody logged in
  assert.equal(engine.status, 'LOGIN_REQUIRED');
  assert.ok(ig.calls.verify > verifies, 'resume must re-verify the session');
  assert.match(engine.pauseReason, /login page/i);
  loggedIn = true; ig.session = { state: 'AUTHENTICATED', account: 'tester' };   // user logs in manually
  await engine.resume(); assert.equal(engine.status, 'RUNNING');
  await untilIdle(engine);
  assert.equal(checkpoint.statusOf('b'), 'UNFOLLOWED');
});

test('session invalid at start: run waits in LOGIN_REQUIRED, never RUNNING, and nothing is clicked', async () => {
  const { engine, ig, checkpoint } = setup({ a: 'FOLLOWING' });
  ig.session = { state: 'LOGIN_REQUIRED' };
  await engine.start(['a']);
  await untilStatus(engine, 'LOGIN_REQUIRED');
  await sleep(300);
  assert.equal(ig.calls.inspect.length, 0);
  assert.equal(engine.history.includes('RUNNING'), false);
  ig.session = { state: 'AUTHENTICATED' };
  await engine.resume(); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('a'), 'UNFOLLOWED');
});

test('security verification at session check pauses as SAFETY_PAUSED', async () => {
  const { engine, ig } = setup({ a: 'FOLLOWING' });
  ig.session = { state: 'SECURITY', reason: 'Instagram is asking for a security verification.' };
  await engine.start(['a']);
  await untilStatus(engine, 'SAFETY_PAUSED');
  assert.match(engine.pauseReason, /security verification/);
  engine.stop(); await untilIdle(engine);
});

test('closed browser during a run: RECOVERING, Resume reopens and re-verifies, same account continues', async () => {
  const closed = new Error('page.goto: Target page, context or browser has been closed');
  const { engine, checkpoint, ig } = setup({ a: [closed, 'FOLLOWING'] });
  await engine.start(['a']);
  await untilStatus(engine, 'RECOVERING');
  const v = ig.calls.verify;
  await engine.resume(); await untilIdle(engine);
  assert.ok(ig.calls.verify > v);
  assert.equal(checkpoint.statusOf('a'), 'UNFOLLOWED');
});

test('browser cannot start / disconnected context: RECOVERING with the real reason, account NOT marked failed', async () => {
  const err = Object.assign(new Error('The browser profile is already open in another window.'), { code: 'BROWSER_LAUNCH' });
  const { engine, checkpoint, ig } = setup({ a: 'FOLLOWING' });
  ig.session = () => { throw err; };
  await engine.start(['a']);
  await untilStatus(engine, 'RECOVERING');
  assert.match(engine.pauseReason, /already open/);
  assert.notEqual(checkpoint.statusOf('a'), 'FAILED');
  ig.session = { state: 'DISCONNECTED', reason: 'The browser connection was lost.' };
  await engine.resume(); assert.equal(engine.status, 'RECOVERING'); assert.match(engine.pauseReason, /connection was lost/);
  ig.session = { state: 'AUTHENTICATED' };
  await engine.resume(); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('a'), 'UNFOLLOWED');
});

test('resume re-checks the history: an account finished while paused is not touched again', async () => {
  const { engine, checkpoint, ig } = setup({ a: ['ACTION_BLOCKED', 'FOLLOWING'], b: 'FOLLOWING' });
  await engine.start(['a', 'b']);
  await untilStatus(engine, 'SAFETY_PAUSED');
  checkpoint.set('a', { status: 'ALREADY_UNFOLLOWED' });                  // e.g. done by hand while the run was paused
  await engine.resume(); await untilIdle(engine);
  assert.equal(ig.calls.inspect.filter(u => u === 'a').length, 1, 'a is not opened a second time');
  assert.equal(ig.calls.unfollow, 1);
  assert.equal(checkpoint.statusOf('b'), 'UNFOLLOWED');
});

test('restart: final accounts are never processed again, interrupted ones are', async () => {
  const first = setup({ a: 'FOLLOWING', b: 'FOLLOWING' });
  await first.engine.start(['a']); await untilIdle(first.engine);
  first.checkpoint.set('b', { status: 'IN_PROGRESS' });
  const cp = new CheckpointService(first.checkpoint.file);
  cp.recoverInterrupted();
  const ig = fake({ a: 'FOLLOWING', b: 'FOLLOWING' });
  const engine = new AutomationController({ ig, checkpoint: cp, logger: new Logger(first.dir), getSettings: () => SETTINGS });
  await engine.start(['a', 'b']); await untilIdle(engine);
  assert.deepEqual(ig.calls.inspect, ['b']);
  assert.equal(cp.statusOf('b'), 'UNFOLLOWED');
});

test('a second run cannot start while one is active; nothing-to-do is explained; a finished run can be followed by a new one', async () => {
  const { engine } = setup({ a: 'FOLLOWING', b: 'FOLLOWING' }, {}, { actionIntervalSec: 1 });
  await engine.start(['a', 'b']);
  await assert.rejects(() => engine.start(['a']), /already/);
  engine.stop(); await untilIdle(engine);
  assert.equal(engine.status, 'IDLE');
  const s2 = setup({ a: 'NOT_FOLLOWING', z: 'FOLLOWING' });
  await s2.engine.start(['a']); await untilIdle(s2.engine);
  assert.equal(s2.engine.status, 'COMPLETED');
  await assert.rejects(() => s2.engine.start(['a']), /Nothing to do/);
  await s2.engine.start(['z']); await untilIdle(s2.engine);
  assert.equal(s2.engine.status, 'COMPLETED');
});

test('pause then resume, and stop leaves the rest queued', async () => {
  const { engine, checkpoint } = setup({ a: 'FOLLOWING', b: 'FOLLOWING', c: 'FOLLOWING' }, {}, { actionIntervalSec: 0.3 });
  await engine.start(['a', 'b', 'c']);
  await untilStatus(engine, 'RUNNING');
  engine.pause(); await untilStatus(engine, 'PAUSED');
  await engine.resume(); assert.equal(engine.status, 'RUNNING');
  await sleep(100);
  engine.stop(); await untilIdle(engine);
  assert.ok(['PENDING', 'UNFOLLOWED'].includes(checkpoint.statusOf('c')));
  assert.equal(checkpoint.state.runs[0].status, 'STOPPED');
  assert.ok(engine.history.includes('STOPPING'));
});

test('Pause then Resume pressed quickly does not leave the run stuck paused', async () => {
  const { engine, checkpoint } = setup({ a: 'FOLLOWING', b: 'FOLLOWING', c: 'FOLLOWING' }, {}, { actionIntervalSec: 0.2 });
  await engine.start(['a', 'b', 'c']);
  await untilStatus(engine, 'RUNNING');
  engine.pause(); await engine.resume();
  await untilIdle(engine);
  assert.deepEqual(['a', 'b', 'c'].map(u => checkpoint.statusOf(u)), ['UNFOLLOWED', 'UNFOLLOWED', 'UNFOLLOWED']);
});

test('FAILED / NEEDS_REVIEW wait for an explicit retry', async () => {
  const { engine, checkpoint } = setup({ a: 'FOLLOWING' });
  checkpoint.set('a', { status: 'FAILED' });
  await assert.rejects(() => engine.start(['a']), /Nothing to do/);
  await engine.start(['a'], { includeRetry: true }); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('a'), 'UNFOLLOWED');
});

test('every selected account ends with an accounted status', async () => {
  const { engine, checkpoint } = setup({ a: 'FOLLOWING', b: 'NOT_FOLLOWING', c: 'UNAVAILABLE', d: 'AMBIGUOUS', e: new Error('x'), f: 'REQUESTED' });
  const sel = ['a', 'b', 'c', 'd', 'e', 'f'];
  await engine.start(sel); await untilIdle(engine);
  assert.deepEqual(sel.map(u => checkpoint.statusOf(u)), ['UNFOLLOWED', 'ALREADY_UNFOLLOWED', 'PROFILE_UNAVAILABLE', 'NEEDS_REVIEW', 'FAILED', 'SKIPPED']);
  assert.equal(engine.snapshot().processed, 6);
});

test('execution settings: one account at a time with a FIXED interval (no jitter), read live', async () => {
  const stamps = [];
  const { engine, ig, cfg } = setup({}, {}, { actionIntervalSec: 0.4 });
  ig.inspect = async () => { stamps.push(Date.now()); return { state: 'FOLLOWING' }; };
  await engine.start(['a', 'b', 'c']); await untilIdle(engine, 10000);
  const gaps = [stamps[1] - stamps[0], stamps[2] - stamps[1]];
  assert.ok(gaps.every(g => g >= 380 && g <= 800), `gaps ${gaps}`);
  assert.ok(Math.abs(gaps[0] - gaps[1]) < 250, 'no randomisation between intervals');
  cfg.actionIntervalSec = 60;                          // a long wait ...
  await engine.start(['d', 'e']);
  await sleep(500); cfg.actionIntervalSec = 0;         // ... is shortened while it is in progress
  await untilIdle(engine, 6000);
  assert.equal(engine.snapshot().intervalSec, 0);
});

test('snapshot exposes the configuration the run is using', async () => {
  const { engine } = setup({ a: 'FOLLOWING' }, {}, { executionProfile: 'balanced', actionIntervalSec: 15, navigationTimeoutSec: 40, elementTimeoutSec: 12, maxAttempts: 3 });
  const s = engine.snapshot();
  assert.deepEqual([s.profile, s.intervalSec, s.navigationTimeoutSec, s.elementTimeoutSec, s.maxAttempts], ['balanced', 15, 40, 12, 3]);
});
