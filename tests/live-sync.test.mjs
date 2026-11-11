import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AccountService } from '../src/services/account-service.mjs';
import { CheckpointService } from '../src/services/checkpoint-service.mjs';
import { WhitelistService } from '../src/services/whitelist-service.mjs';
import { ProfileMetadataService } from '../src/services/profile-metadata-service.mjs';
import { LiveRelationshipSyncEngine } from '../src/automation/live-relationship-sync.mjs';
import { Logger } from '../src/services/logger-service.mjs';
import { createApp } from '../src/server.mjs';

function createMockEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-live-sync-test-'));
  const modelFile = path.join(dir, 'account-model.json');
  const unfollowCp = new CheckpointService(path.join(dir, 'cp-unfollow.json'));
  const cancelCp = new CheckpointService(path.join(dir, 'cp-cancel.json'));
  const wl = new WhitelistService(path.join(dir, 'whitelist.json'));
  const meta = new ProfileMetadataService(path.join(dir, 'meta.json'));
  const logger = new Logger(dir);

  const initialModel = {
    importedAt: '2026-11-01T10:00:00.000Z',
    files: ['followers_1.json', 'following.json'],
    warnings: [],
    duplicates: 0,
    blocking: [],
    displayNames: { alice: 'Alice A' },
    requestDates: { req_1: 1700000000000 },
    lists: {
      followers: ['alice', 'bob', 'charlie'],
      following: ['alice', 'bob', 'dave', 'charlie'],
      pending: ['req_1'],
      recent: [],
      blocked: []
    },
    nonFollowers: ['dave'],
    mutual: ['alice', 'bob', 'charlie'],
    fans: []
  };

  fs.writeFileSync(modelFile, JSON.stringify(initialModel));
  const accounts = new AccountService(modelFile, { unfollow: unfollowCp, cancel: cancelCp }, wl, meta);

  return { dir, accounts, wl, meta, logger };
}

test('AccountService ingestLiveSync: builds relationships, computes diff, enriches metadata without losing data', () => {
  const { accounts, meta, wl } = createMockEnv();

  // Whitelist dave
  wl.add('dave');

  // Pre-seed some metadata
  meta.set('alice', { followersCount: 50000, authorityRatio: 25 });

  // Live extraction discovers:
  // - following: ['alice', 'bob', 'dave', 'eve'] (charlie unfollowed by you, eve added)
  // - followers: ['alice', 'bob', 'frank'] (charlie unfollowed you, frank added)
  // Display names & verified status extracted from live session
  const res = accounts.ingestLiveSync({
    following: ['alice', 'bob', 'dave', 'eve'],
    followers: ['alice', 'bob', 'frank'],
    displayNames: { eve: 'Eve Online', frank: 'Frank Ocean' },
    userMeta: {
      alice: { isVerified: true, fullName: 'Alice Star' },
      eve: { isVerified: false, fullName: 'Eve Online' },
      frank: { isVerified: true, fullName: 'Frank Ocean' }
    }
  });

  assert.ok(res);
  const m = accounts.model;
  assert.equal(m.source, 'LIVE_BROWSER_SYNC');

  // Check relationship sets
  assert.deepEqual(m.nonFollowers, ['dave', 'eve']);
  assert.deepEqual(m.mutual, ['alice', 'bob']);
  assert.deepEqual(m.fans, ['frank']);

  // Preserved pending list from previous model
  assert.deepEqual(m.lists.pending, ['req_1']);

  // Whitelist preserved
  assert.ok(wl.has('dave'));

  // Diff verification: Charlie unfollowed you!
  const diff = res.latestDiff;
  assert.ok(diff);
  assert.deepEqual(diff.lostFollowers, ['charlie']);
  assert.deepEqual(diff.gainedFollowers, ['frank']);
  assert.deepEqual(diff.unfollowedByYou, ['charlie']);
  assert.deepEqual(diff.newFollowing, ['eve']);

  // Profile metadata enriched with live verification badge and name without losing follower count
  const aliceMeta = meta.get('alice');
  assert.equal(aliceMeta.isVerified, true);
  assert.equal(aliceMeta.followersCount, 50000); // Preserved!
  assert.equal(aliceMeta.authorityRatio, 25);    // Preserved!

  const frankMeta = meta.get('frank');
  assert.equal(frankMeta.isVerified, true);
  assert.equal(frankMeta.fullName, 'Frank Ocean');
});

test('LiveRelationshipSyncEngine: paginates following and followers, emits progress events and completes', async () => {
  const { accounts, meta, logger } = createMockEnv();

  // Mock Instagram browser session
  const fakeScannerPage = {
    url: () => 'https://www.instagram.com/',
    goto: async () => {},
    evaluate: async (fn, arg) => {
      // Simulate init info
      if (typeof fn === 'function' && fn.toString().includes('web_profile_info')) {
        return {
          ok: true,
          userId: '987654321',
          username: 'tester',
          followingCount: 3,
          followersCount: 2
        };
      }
      // Simulate friendships following
      if (arg?.uid && !arg?.cursor && fn.toString().includes('following')) {
        return {
          ok: true,
          users: [
            { pk: '1', username: 'user_a', full_name: 'User A', is_verified: true },
            { pk: '2', username: 'user_b', full_name: 'User B', is_verified: false }
          ],
          nextCursor: 'cursor_following_2'
        };
      }
      if (arg?.cursor === 'cursor_following_2') {
        return {
          ok: true,
          users: [
            { pk: '3', username: 'user_c', full_name: 'User C', is_verified: false }
          ],
          nextCursor: null
        };
      }
      // Simulate friendships followers
      if (arg?.uid && !arg?.cursor && fn.toString().includes('followers')) {
        return {
          ok: true,
          users: [
            { pk: '1', username: 'user_a', full_name: 'User A', is_verified: true },
            { pk: '4', username: 'user_d', full_name: 'User D', is_verified: false }
          ],
          nextCursor: null
        };
      }
      return { ok: false };
    }
  };

  const fakeIg = {
    ensureBrowser: async () => {},
    verifySession: async () => ({ state: 'AUTHENTICATED', account: 'tester' }),
    tabs: {
      scanner: async () => fakeScannerPage
    },
    closeScanner: async () => {}
  };

  const engine = new LiveRelationshipSyncEngine({
    ig: fakeIg,
    accountService: accounts,
    profileMeta: meta,
    logger
  });

  const states = [];
  engine.on('state', s => states.push(s.phase));

  const result = await engine.sync({ delayMs: 10 });
  assert.ok(result.ok);
  assert.equal(result.followingCount, 3);
  assert.equal(result.followersCount, 2);

  assert.ok(states.includes('INIT'));
  assert.ok(states.includes('FOLLOWING'));
  assert.ok(states.includes('FOLLOWERS'));
  assert.ok(states.includes('INGESTING'));
  assert.ok(states.includes('COMPLETED'));

  // Relationships ground truth:
  // user_a: mutual (follows both)
  // user_b, user_c: non-followers (following only)
  // user_d: fan (follows you only)
  assert.deepEqual(accounts.model.nonFollowers, ['user_b', 'user_c']);
  assert.deepEqual(accounts.model.mutual, ['user_a']);
  assert.deepEqual(accounts.model.fans, ['user_d']);
});

test('REST API: /api/sync/live/start, /api/sync/live/status, /api/sync/live/stop routes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-server-sync-'));
  const fakeIg = {
    open: true,
    session: { state: 'AUTHENTICATED', account: 'tester' },
    ensureBrowser: async () => {},
    verifySession: async () => ({ state: 'AUTHENTICATED', account: 'tester' }),
    health: async () => ({ open: true, browser: 'connected', tabs: [], session: { state: 'AUTHENTICATED', account: 'tester' } }),
    tabs: {
      action: async () => ({}),
      scanner: async () => ({
        url: () => 'https://www.instagram.com/',
        goto: async () => {},
        evaluate: async () => ({ ok: true, userId: '111', followingCount: 0, followersCount: 0 })
      })
    },
    closeScanner: async () => {}
  };

  const app = createApp({ dataDir: dir, logsDir: dir, ig: fakeIg });
  await new Promise(res => app.server.listen(0, '127.0.0.1', res));
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. GET status initially IDLE
    const stRes = await fetch(`${base}/api/sync/live/status`);
    const stJson = await stRes.json();
    assert.equal(stJson.active, false);
    assert.equal(stJson.phase, 'IDLE');

    // 2. POST start
    const startRes = await fetch(`${base}/api/sync/live/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nofollow': '1' },
      body: JSON.stringify({ delayMs: 10 })
    });
    const startJson = await startRes.json();
    assert.equal(startJson.ok, true);

    // 3. POST stop
    const stopRes = await fetch(`${base}/api/sync/live/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nofollow': '1' }
    });
    const stopJson = await stopRes.json();
    assert.equal(stopJson.ok, true);
  } finally {
    app.server.closeAllConnections?.();
    app.server.close();
  }
});
