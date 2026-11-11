import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomationError, ERR } from '../src/automation/errors.mjs';
import { setup, untilIdle, untilStatus, fake } from './fixtures/engine-helpers.mjs';

const follow = (script, opts, settings) => setup(script, opts, settings, 'follow');

test('follow one public account: verified from page, recorded as FOLLOWED', async () => {
  const { engine, checkpoint, ig } = follow({ a: 'NOT_FOLLOWING' }, { followResult: 'FOLLOWING' });
  await engine.start(['a']); await untilIdle(engine);
  const r = checkpoint.get('a');
  assert.equal(r.status, 'FOLLOWED');
  assert.equal(ig.calls.follow, 1);
  assert.equal(ig.calls.unfollow, 0);
  assert.equal(ig.calls.cancel, 0);
  assert.equal(checkpoint.state.runs[0].job, 'follow');
});

test('follow one private account: verified as REQUESTED, recorded as FOLLOWED', async () => {
  const { engine, checkpoint, ig } = follow({ a: 'NOT_FOLLOWING' }, { followResult: 'REQUESTED' });
  await engine.start(['a']); await untilIdle(engine);
  const r = checkpoint.get('a');
  assert.equal(r.status, 'FOLLOWED');
  assert.equal(ig.calls.follow, 1);
});

test('already followed: nothing is clicked, recorded as ALREADY_FOLLOWED', async () => {
  const { engine, checkpoint, ig } = follow({ a: 'FOLLOWING' });
  await engine.start(['a']); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('a'), 'ALREADY_FOLLOWED');
  assert.equal(ig.calls.follow, 0);
});

test('already requested: nothing is clicked, recorded as SKIPPED', async () => {
  const { engine, checkpoint, ig } = follow({ a: 'REQUESTED' });
  await engine.start(['a']); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('a'), 'SKIPPED');
  assert.equal(ig.calls.follow, 0);
});

test('unavailable profile: recorded as PROFILE_UNAVAILABLE', async () => {
  const { engine, checkpoint, ig } = follow({ a: 'UNAVAILABLE' });
  await engine.start(['a']); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('a'), 'PROFILE_UNAVAILABLE');
  assert.equal(ig.calls.follow, 0);
});

test('Instagram action block while following triggers SAFETY_PAUSED', async () => {
  const { engine, checkpoint } = follow({ a: 'NOT_FOLLOWING' }, { followResult: 'ACTION_BLOCKED' });
  await engine.start(['a']);
  await untilStatus(engine, 'SAFETY_PAUSED');
  assert.equal(engine.status, 'SAFETY_PAUSED');
  assert.equal(checkpoint.statusOf('a'), 'ACTION_BLOCKED');
  engine.stop();
  await untilIdle(engine);
});

test('unverified click retries bounded times then marks FAILED', async () => {
  const { engine, checkpoint, ig } = follow({ a: 'NOT_FOLLOWING' }, { followResult: 'NOT_FOLLOWING' });
  await engine.start(['a']); await untilIdle(engine);
  assert.equal(checkpoint.statusOf('a'), 'FAILED');
  assert.equal(ig.calls.follow, 2, 'retried maxAttempts (2) times');
});

test('mixed batch of custom accounts: accounts end with accounted statuses and stats match', async () => {
  const { engine, checkpoint } = follow({
    pub: 'NOT_FOLLOWING',
    priv: 'NOT_FOLLOWING',
    already: 'FOLLOWING',
    req: 'REQUESTED',
    unavail: 'UNAVAILABLE'
  }, {
    followResult: () => 'FOLLOWING'
  });

  const list = ['pub', 'priv', 'already', 'req', 'unavail'];
  await engine.start(list); await untilIdle(engine);
  assert.deepEqual(list.map(u => checkpoint.statusOf(u)), [
    'FOLLOWED', 'FOLLOWED', 'ALREADY_FOLLOWED', 'SKIPPED', 'PROFILE_UNAVAILABLE'
  ]);
  const s = engine.snapshot();
  assert.equal(s.processed, 5);
  assert.equal(s.followed, 2);
  assert.equal(s.alreadyFollowed, 1);
  assert.equal(s.skipped, 1);
  assert.equal(s.unavailable, 1);
});
