import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PendingRequestCancellationEngine } from '../src/automation/pending-request-cancellation.mjs';
import { PendingRequestStateService } from '../src/services/pending-request-state.mjs';
import { Logger } from '../src/services/logger-service.mjs';
import { fake, untilIdle, untilStatus, SETTINGS } from './fixtures/engine-helpers.mjs';

function setupPendingEngine(script, opts = {}, settings = {}, userDates = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-eng-'));
  const checkpoint = new PendingRequestStateService(path.join(dir, 'pending-request-state.json'));
  const ig = fake(script, opts);
  const cfg = { ...SETTINGS, ...settings };
  const accountService = {
    model: {
      requestDates: userDates,
      displayNames: {}
    }
  };
  const engine = new PendingRequestCancellationEngine({
    ig,
    checkpoint,
    logger: new Logger(dir),
    getSettings: () => cfg,
    accountService
  });
  return { dir, checkpoint, ig, engine, cfg };
}

test('Pending cancellation: strictly processes oldest requests first', async () => {
  const userDates = {
    user_newest_2026: 1794002700000,
    user_oldest_2017: 1485837060000,
    user_middle_2019: 1562347380000
  };

  const { engine, checkpoint, ig, dir } = setupPendingEngine(
    {
      user_newest_2026: 'REQUESTED',
      user_oldest_2017: 'REQUESTED',
      user_middle_2019: 'REQUESTED'
    },
    {},
    {},
    userDates
  );

  // Pass usernames intentionally out-of-order
  await engine.start(['user_newest_2026', 'user_oldest_2017', 'user_middle_2019']);
  await untilIdle(engine);

  // Verify inspection order was strictly oldest-first
  assert.deepEqual(ig.calls.inspect, ['user_oldest_2017', 'user_middle_2019', 'user_newest_2026']);
  assert.equal(checkpoint.statusOf('user_oldest_2017'), 'CANCELLED');
  assert.equal(checkpoint.statusOf('user_middle_2019'), 'CANCELLED');
  assert.equal(checkpoint.statusOf('user_newest_2026'), 'CANCELLED');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('Pending cancellation: processes newest requests first when order is newest', async () => {
  const userDates = {
    user_newest_2026: 1794002700000,
    user_oldest_2017: 1485837060000,
    user_middle_2019: 1562347380000
  };

  const { engine, ig, dir } = setupPendingEngine(
    {
      user_newest_2026: 'REQUESTED',
      user_oldest_2017: 'REQUESTED',
      user_middle_2019: 'REQUESTED'
    },
    {},
    {},
    userDates
  );

  await engine.start(['user_oldest_2017', 'user_newest_2026', 'user_middle_2019'], { order: 'newest' });
  await untilIdle(engine);

  assert.deepEqual(ig.calls.inspect, ['user_newest_2026', 'user_middle_2019', 'user_oldest_2017']);
  assert.equal(engine.snapshot().processingOrder, 'NEWEST_FIRST');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Pending cancellation: still pending request is cancelled and confirmed', async () => {
  const { engine, checkpoint, ig, dir } = setupPendingEngine({ target_user: 'REQUESTED' });
  await engine.start(['target_user']);
  await untilIdle(engine);

  assert.equal(checkpoint.statusOf('target_user'), 'CANCELLED');
  assert.equal(ig.calls.cancel, 1);
  assert.equal(ig.calls.unfollow, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('Pending cancellation: already cancelled request is verified without clicking', async () => {
  const { engine, checkpoint, ig, dir } = setupPendingEngine({ already_user: 'NOT_FOLLOWING' });
  await engine.start(['already_user']);
  await untilIdle(engine);

  assert.equal(checkpoint.statusOf('already_user'), 'ALREADY_CANCELLED');
  assert.equal(ig.calls.cancel, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('Pending cancellation: accepted request is classified as ACCEPTED without clicking', async () => {
  const { engine, checkpoint, ig, dir } = setupPendingEngine({ accepted_user: 'FOLLOWING' });
  await engine.start(['accepted_user']);
  await untilIdle(engine);

  assert.equal(checkpoint.statusOf('accepted_user'), 'ACCEPTED');
  assert.equal(ig.calls.cancel, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('Pending cancellation: unavailable profile is recorded as PROFILE_UNAVAILABLE', async () => {
  const { engine, checkpoint, ig, dir } = setupPendingEngine({ gone_user: 'UNAVAILABLE' });
  await engine.start(['gone_user']);
  await untilIdle(engine);

  assert.equal(checkpoint.statusOf('gone_user'), 'PROFILE_UNAVAILABLE');
  assert.equal(ig.calls.cancel, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('Pending cancellation: ambiguous relationship state goes to NEEDS_REVIEW', async () => {
  const { engine, checkpoint, ig, dir } = setupPendingEngine({ strange_user: 'AMBIGUOUS' });
  await engine.start(['strange_user']);
  await untilIdle(engine);

  assert.equal(checkpoint.statusOf('strange_user'), 'NEEDS_REVIEW');
  assert.equal(ig.calls.cancel, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('Pending cancellation: Instagram action block pauses run for safety', async () => {
  const { engine, checkpoint, ig, dir } = setupPendingEngine({ blocked_user: 'ACTION_BLOCKED' });
  await engine.start(['blocked_user']);
  await untilStatus(engine, 'SAFETY_PAUSED');

  assert.equal(checkpoint.statusOf('blocked_user'), 'ACTION_BLOCKED');
  assert.equal(engine.status, 'SAFETY_PAUSED');
  assert.equal(ig.calls.cancel, 0);

  engine.stop();
  await untilIdle(engine);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Pending cancellation: retention policy filters requests olderThanDays', async () => {
  const now = Date.now();
  const dayMs = 86400 * 1000;
  const userDates = {
    user_recent_5d: now - (5 * dayMs),
    user_old_100d: now - (100 * dayMs),
    user_ancient_400d: now - (400 * dayMs)
  };

  const { engine, ig, dir } = setupPendingEngine(
    {
      user_recent_5d: 'REQUESTED',
      user_old_100d: 'REQUESTED',
      user_ancient_400d: 'REQUESTED'
    },
    {},
    {},
    userDates
  );

  // Filter with olderThanDays = 90
  const eligible = engine.eligible(['user_recent_5d', 'user_old_100d', 'user_ancient_400d'], { olderThanDays: 90 });
  assert.deepEqual(eligible, ['user_ancient_400d', 'user_old_100d'], 'only requests >90 days old should be eligible, sorted oldest first');

  // Start with olderThanDays = 90
  await engine.start(['user_recent_5d', 'user_old_100d', 'user_ancient_400d'], { olderThanDays: 90 });
  await untilIdle(engine);

  assert.deepEqual(ig.calls.inspect, ['user_ancient_400d', 'user_old_100d']);
  assert.equal(ig.calls.inspect.includes('user_recent_5d'), false, 'recent request was skipped by retention rule');

  fs.rmSync(dir, { recursive: true, force: true });
});

