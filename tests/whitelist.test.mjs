import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { WhitelistService } from '../src/services/whitelist-service.mjs';
import { AutomationController } from '../src/automation/automation-controller.mjs';
import { PendingRequestCancellationEngine } from '../src/automation/pending-request-cancellation.mjs';
import { CheckpointService } from '../src/services/checkpoint-service.mjs';
import { PendingRequestStateService } from '../src/services/pending-request-state.mjs';
import { Logger } from '../src/services/logger-service.mjs';
import { setup, fake, untilIdle } from './fixtures/engine-helpers.mjs';

test('WhitelistService: basic add, remove, has, toggle, addMany, clear', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-wl-'));
  const file = path.join(dir, 'whitelist.json');
  const wl = new WhitelistService(file);

  assert.equal(wl.has('alice'), false);
  wl.add('@Alice');
  assert.equal(wl.has('alice'), true);
  assert.equal(wl.has('@alice'), true);
  assert.deepEqual(wl.list(), ['alice']);

  // Duplicate add should be no-op
  wl.add('alice');
  assert.equal(wl.list().length, 1);

  // Toggle off
  wl.toggle('alice');
  assert.equal(wl.has('alice'), false);

  // Toggle on
  wl.toggle('alice');
  assert.equal(wl.has('alice'), true);

  // addMany
  wl.addMany(['@bob', 'charlie', 'alice', '  ']);
  assert.deepEqual(wl.list().sort(), ['alice', 'bob', 'charlie']);

  // Remove
  wl.remove('bob');
  assert.equal(wl.has('bob'), false);
  assert.equal(wl.has('alice'), true);

  // Persistence reload
  const wl2 = new WhitelistService(file);
  assert.deepEqual(wl2.list().sort(), ['alice', 'charlie']);

  // Clear
  wl2.clear();
  assert.deepEqual(wl2.list(), []);
  assert.equal(wl2.has('alice'), false);

  // Verify file on disk after clear
  const wl3 = new WhitelistService(file);
  assert.deepEqual(wl3.list(), []);
});

test('AutomationController: whitelisted accounts are excluded from eligible() and skipped in unfollow', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-wl-ctrl-'));
  const wl = new WhitelistService(path.join(dir, 'wl.json'));
  wl.add('vip_friend');

  const cp = new CheckpointService(path.join(dir, 's.json'));
  const ig = fake({
    vip_friend: 'FOLLOWING',
    regular: 'FOLLOWING',
    late_add: 'FOLLOWING'
  });
  const origInspect = ig.inspect.bind(ig);
  ig.inspect = async u => {
    if (u === 'late_add') wl.add('late_add');
    return origInspect(u);
  };
  const cfg = { executionProfile: 'custom', actionIntervalSec: 0, navigationTimeoutSec: 30, elementTimeoutSec: 10, maxAttempts: 2, maxPerRun: 1000, errorThreshold: 3 };
  
  const engine = new AutomationController({
    ig,
    checkpoint: cp,
    logger: new Logger(dir),
    getSettings: () => cfg,
    job: 'unfollow',
    whitelist: wl
  });

  // eligible() must exclude vip_friend
  const el = engine.eligible(['vip_friend', 'regular', 'late_add']);
  assert.deepEqual(el, ['regular', 'late_add']);

  // Calling start on exclusively whitelisted accounts throws "Nothing to do"
  await assert.rejects(
    () => engine.start(['vip_friend']),
    /Nothing to do/
  );

  // Runtime shield: late_add gets whitelisted during inspection, decide() must shield and record SKIPPED
  await engine.start(['late_add', 'regular']);
  await untilIdle(engine);

  assert.equal(ig.calls.unfollow, 1); // only regular was unfollowed
  assert.equal(cp.statusOf('regular'), 'UNFOLLOWED');
  assert.equal(cp.statusOf('late_add'), 'SKIPPED');
});

test('PendingRequestCancellationEngine: whitelisted accounts are excluded from eligible()', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-wl-cancel-'));
  const wl = new WhitelistService(path.join(dir, 'wl.json'));
  wl.add('vip_private');

  const cp = new PendingRequestStateService(path.join(dir, 's.json'));
  const ig = fake({ vip_private: 'REQUESTED', regular: 'REQUESTED' });
  const cfg = { executionProfile: 'custom', actionIntervalSec: 0, navigationTimeoutSec: 30, elementTimeoutSec: 10, maxAttempts: 2, maxPerRun: 1000, errorThreshold: 3 };

  const engine = new PendingRequestCancellationEngine({
    ig,
    checkpoint: cp,
    logger: new Logger(dir),
    getSettings: () => cfg,
    accountService: { sets: { pendingRequests: ['regular', 'vip_private'] } },
    whitelist: wl
  });

  const el = engine.eligible(['vip_private', 'regular']);
  assert.deepEqual(el, ['regular']);
});

test('Hourly action limit and cooldown tracking in AutomationController snapshot', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-hourly-'));
  const cp = new CheckpointService(path.join(dir, 's.json'));
  const ig = fake({ a: 'FOLLOWING' }, { unfollowResult: 'NOT_FOLLOWING' });
  const cfg = { executionProfile: 'custom', actionIntervalSec: 0, navigationTimeoutSec: 30, elementTimeoutSec: 10, maxAttempts: 2, maxPerRun: 1000, errorThreshold: 3, hourlyLimit: 50, cooldownMinutes: 15 };

  const engine = new AutomationController({
    ig,
    checkpoint: cp,
    logger: new Logger(dir),
    getSettings: () => cfg,
    job: 'unfollow'
  });

  const snap1 = engine.snapshot();
  assert.equal(snap1.hourlyActions, 0);
  assert.equal(snap1.hourlyLimit, 50);
  assert.equal(snap1.cooldownMinutes, 15);

  await engine.start(['a']);
  await untilIdle(engine);

  const snap2 = engine.snapshot();
  assert.equal(snap2.hourlyActions, 1);
  assert.equal(engine.actionTimestamps.length, 1);
});
