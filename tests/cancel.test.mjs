// Pending-request cancellation job: engine scenarios with a scripted fake session. No Instagram traffic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomationError, ERR } from '../src/automation/errors.mjs';
import { CheckpointService } from '../src/services/checkpoint-service.mjs';
import { AutomationController } from '../src/automation/automation-controller.mjs';
import { Logger } from '../src/services/logger-service.mjs';
import { setup, untilIdle, untilStatus, fake, SETTINGS } from './fixtures/engine-helpers.mjs';

const cancel = (script, opts, settings) => setup(script, opts, settings, 'cancel');

test('cancel one pending request: verified from the page, recorded as CANCELLED, with history fields', async () => {
  const { engine, checkpoint, ig } = cancel({ a: 'REQUESTED' });
  await engine.start(['a']); await untilIdle(engine);
  const r = checkpoint.get('a');
  assert.equal(r.status, 'CANCELLED');
  assert.equal(ig.calls.cancel, 1);
  assert.equal(ig.calls.unfollow, 0, 'never uses the unfollow action');
  assert.equal(r.attempts, 1); assert.ok(r.lastAttemptAt); assert.equal(r.result, 'CANCELLED'); assert.equal(r.previousStatus, 'PENDING');
  assert.equal(checkpoint.state.runs[0].job, 'cancel');
});

test('cancel selected requests / cancel all: every account ends with an accounted status and counts add up', async () => {
  const { engine, checkpoint } = cancel({ a: 'REQUESTED', b: 'REQUESTED', c: 'NOT_FOLLOWING', d: 'FOLLOWING', e: 'UNAVAILABLE', f: 'AMBIGUOUS', g: new Error('x') });
  const sel = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  await engine.start(sel); await untilIdle(engine);
  assert.deepEqual(sel.map(u => checkpoint.statusOf(u)), ['CANCELLED', 'CANCELLED', 'ALREADY_CANCELLED', 'ACCEPTED', 'PROFILE_UNAVAILABLE', 'NEEDS_REVIEW', 'FAILED']);
  const s = engine.snapshot();
  assert.equal(s.processed, 7);
  assert.equal(s.unfollowed + s.alreadyUnfollowed + s.accepted + s.unavailable + s.needsReview + s.failed, 7);
});

test('already cancelled: nothing is clicked and the batch continues', async () => {
  const { engine, checkpoint, ig } = cancel({ a: 'NOT_FOLLOWING', b: 'REQUESTED' });
  await engine.start(['a', 'b']); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('a'), 'ALREADY_CANCELLED');
  assert.equal(ig.calls.cancel, 1);
  assert.equal(checkpoint.statusOf('b'), 'CANCELLED');
});

test('accepted request: the account is followed now, so cancellation is NOT attempted (an accepted follow is never undone)', async () => {
  const { engine, checkpoint, ig } = cancel({ a: 'FOLLOWING' });
  await engine.start(['a']); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('a'), 'ACCEPTED');
  assert.equal(ig.calls.cancel, 0);
  assert.equal(ig.calls.unfollow, 0);
});

test('unfollow job leaves a pending request alone, and cancel job leaves a followed account alone', async () => {
  const u = setup({ a: 'REQUESTED' });
  await u.engine.start(['a']); await untilIdle(u.engine);
  assert.equal(u.checkpoint.statusOf('a'), 'SKIPPED');
  assert.equal(u.ig.calls.cancel + u.ig.calls.unfollow, 0);
});

test('missing cancellation option: classified, sent to review, no blind retry, batch continues', async () => {
  let n = 0;
  const { engine, checkpoint, ig } = cancel({ a: 'REQUESTED', b: 'REQUESTED' }, { unfollowResult: () => (n++ === 0 ? new AutomationError(ERR.ELEMENT_NOT_FOUND, 'The confirmation option did not appear after opening the menu.') : 'NOT_FOLLOWING') });
  await engine.start(['a', 'b']); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('a'), 'NEEDS_REVIEW');
  assert.equal(checkpoint.get('a').errorCode, ERR.ELEMENT_NOT_FOUND);
  assert.equal(ig.calls.cancel, 2);
  assert.equal(checkpoint.statusOf('b'), 'CANCELLED');
});

test('individual cancellation failure (not confirmed): FAILED with a reason, retried a bounded number of times, then next account', async () => {
  const { engine, checkpoint, ig } = cancel({ a: 'REQUESTED', b: 'REQUESTED' }, { unfollowResult: () => (ig.calls.cancel <= 2 ? 'REQUESTED' : 'NOT_FOLLOWING') });
  await engine.start(['a', 'b']); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('a'), 'FAILED');
  assert.match(checkpoint.get('a').reason, /not confirmed/);
  assert.equal(checkpoint.statusOf('b'), 'CANCELLED');
});

test('browser interruption during cancellation: RECOVERING, resume verifies and continues the same request', async () => {
  const closed = new Error('locator.click: Target page, context or browser has been closed');
  let n = 0;
  const { engine, checkpoint, ig } = cancel({ a: 'REQUESTED', b: 'REQUESTED' }, { unfollowResult: () => (n++ === 0 ? closed : 'NOT_FOLLOWING') });
  await engine.start(['a', 'b']);
  await untilStatus(engine, 'RECOVERING');
  assert.ok(!checkpoint.isFinal('a'));
  await engine.resume(); await untilIdle(engine);
  assert.deepEqual(['a', 'b'].map(u => checkpoint.statusOf(u)), ['CANCELLED', 'CANCELLED']);
  assert.ok(ig.calls.verify >= 2);
});

test('Instagram action block while cancelling: SAFETY_PAUSED, not retried, remaining requests stay pending, resume continues', async () => {
  const { engine, checkpoint, ig } = cancel({ a: 'REQUESTED', b: ['ACTION_BLOCKED', 'REQUESTED'], c: 'REQUESTED' });
  await engine.start(['a', 'b', 'c']);
  await untilStatus(engine, 'SAFETY_PAUSED');
  assert.equal(checkpoint.statusOf('a'), 'CANCELLED');
  assert.equal(checkpoint.statusOf('b'), 'ACTION_BLOCKED');
  assert.equal(checkpoint.statusOf('c'), 'PENDING');
  assert.equal(ig.calls.inspect.filter(u => u === 'b').length, 1);
  await engine.resume(); await untilIdle(engine);
  assert.deepEqual(['a', 'b', 'c'].map(u => checkpoint.statusOf(u)), ['CANCELLED', 'CANCELLED', 'CANCELLED']);
});

test('resume unfinished cancellation after an application restart; finished ones are not repeated', async () => {
  const first = cancel({ a: 'REQUESTED', b: 'REQUESTED', c: 'REQUESTED' });
  await first.engine.start(['a']); await untilIdle(first.engine);
  first.checkpoint.set('b', { status: 'IN_PROGRESS' });                    // crash while b was being processed
  const cp = new CheckpointService(first.checkpoint.file);
  assert.equal(cp.recoverInterrupted(), 1);
  const ig = fake({ a: 'REQUESTED', b: 'REQUESTED', c: 'REQUESTED' });
  const engine = new AutomationController({ ig, checkpoint: cp, logger: new Logger(first.dir), getSettings: () => SETTINGS, job: 'cancel' });
  await engine.start(['a', 'b', 'c']); await untilIdle(engine);
  assert.deepEqual(ig.calls.inspect, ['b', 'c'], 'a (already cancelled) is not opened again');
  assert.deepEqual(['a', 'b', 'c'].map(u => cp.statusOf(u)), ['CANCELLED', 'CANCELLED', 'CANCELLED']);
});

test('duplicate cancellation prevention: finished requests are skipped; a second run while one is active is refused', async () => {
  const { engine, checkpoint, ig } = cancel({ a: 'REQUESTED', b: 'REQUESTED' }, {}, { actionIntervalSec: 1 });
  await engine.start(['a', 'b']);
  await assert.rejects(() => engine.start(['a', 'b']), /already/);
  await untilIdle(engine, 8000);
  await assert.rejects(() => engine.start(['a', 'b']), /Nothing to do/);
  assert.equal(ig.calls.cancel, 2, 'each request cancelled exactly once');
  assert.equal(checkpoint.counts().CANCELLED, 2);
});

test('remaining counts stay accurate while the run is going', async () => {
  const { engine } = cancel({ a: 'REQUESTED', b: 'REQUESTED', c: 'REQUESTED' }, {}, { actionIntervalSec: 0.2 });
  const seen = [];
  engine.on('state', s => seen.push([s.processed, s.remaining, s.selected]));
  await engine.start(['a', 'b', 'c']); await untilIdle(engine);
  assert.ok(seen.every(([p, r, s]) => p + r === s));
  assert.deepEqual(seen.at(-1), [3, 0, 3]);
});
