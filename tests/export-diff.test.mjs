import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AccountService } from '../src/services/account-service.mjs';
import { CheckpointService } from '../src/services/checkpoint-service.mjs';
import { WhitelistService } from '../src/services/whitelist-service.mjs';
import { ProfileMetadataService } from '../src/services/profile-metadata-service.mjs';
import { FollowersIntelligenceService } from '../src/services/followers-intelligence-service.mjs';
import { json, followingJson } from './fixtures/pages.mjs';

function createMockEnvironment() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-diff-test-'));
  const modelFile = path.join(dir, 'account-model.json');
  const unfollowCp = new CheckpointService(path.join(dir, 'cp-unfollow.json'));
  const cancelCp = new CheckpointService(path.join(dir, 'cp-cancel.json'));
  const wl = new WhitelistService(path.join(dir, 'whitelist.json'));
  const meta = new ProfileMetadataService(path.join(dir, 'meta.json'));

  const svc = new AccountService(modelFile, { unfollow: unfollowCp, cancel: cancelCp }, wl, meta);

  // Initial import
  svc.addFile('followers_1.json', json(['alice', 'bob', 'charlie', 'david', 'ghost_bot']));
  svc.addFile('following.json', followingJson(['alice', 'bob', 'eve', 'frank', 'charlie']));
  svc.commit();

  return { dir, svc, modelFile, wl, meta };
}

test('Export Diff Engine: detects lost followers, gained followers, and still-following-lost on new import', () => {
  const { svc, meta } = createMockEnvironment();

  // Initially no diff history because this was the first import
  assert.equal(svc.getLatestDiff(), null);
  assert.deepEqual(svc.getDiffHistory(), []);

  // Set metadata for ghost follower testing
  meta.set('ghost_bot', { followersCount: 15, followingCount: 2500, authorityRatio: 0.006 });
  meta.set('alice', { followersCount: 12000, followingCount: 300, authorityRatio: 40 });

  // Simulate second import where:
  // - 'charlie' unfollowed you (lost follower, but you still follow them!)
  // - 'grace' is a new follower (gained follower)
  // - you stopped following 'eve' (unfollowed by you)
  // - you started following 'heidi' (new following)
  svc.addFile('followers_1.json', json(['alice', 'bob', 'david', 'ghost_bot', 'grace']));
  svc.addFile('following.json', followingJson(['alice', 'bob', 'frank', 'charlie', 'heidi']));
  const res = svc.commit();
  const diff = res.latestDiff;

  assert.ok(diff);
  assert.deepEqual(diff.lostFollowers, ['charlie']);
  assert.deepEqual(diff.gainedFollowers, ['grace']);
  assert.deepEqual(diff.unfollowedByYou, ['eve']);
  assert.deepEqual(diff.newFollowing, ['heidi']);
  assert.deepEqual(diff.stillFollowingLost, ['charlie']); // Charlie unfollowed you, but you still follow Charlie!

  assert.equal(diff.stats.lostCount, 1);
  assert.equal(diff.stats.gainedCount, 1);
  assert.equal(diff.stats.stillFollowingLostCount, 1);
  assert.equal(diff.stats.netFollowerChange, 0);

  // Persistence check
  const latest = svc.getLatestDiff();
  assert.deepEqual(latest.lostFollowers, ['charlie']);
  assert.equal(svc.getDiffHistory().length, 1);
});

test('AccountService list() integration for diff and ghost followers', () => {
  const { svc, meta } = createMockEnvironment();

  meta.set('ghost_bot', { followersCount: 20, followingCount: 2800, authorityRatio: 0.007 });
  meta.set('alice', { followersCount: 500, followingCount: 400, authorityRatio: 1.25 });

  svc.addFile('followers_1.json', json(['alice', 'bob', 'ghost_bot'])); // lost 'charlie' and 'david'
  svc.addFile('following.json', followingJson(['alice', 'charlie'])); // still follow 'charlie'
  svc.commit();

  // Check list('diffLost')
  const lost = svc.list('diffLost');
  assert.ok(lost.includes('charlie'));
  assert.ok(lost.includes('david'));

  // Check list('diffStillFollowing')
  const stillFollowing = svc.list('diffStillFollowing');
  assert.deepEqual(stillFollowing, ['charlie']);

  // Check list('ghostFollowers')
  const ghosts = svc.list('ghostFollowers');
  assert.deepEqual(ghosts, ['ghost_bot']);
});

test('AccountService query() filters: UNFOLLOWED_YOU, NEW_FOLLOWER, GHOST_FOLLOWER', () => {
  const { svc, meta } = createMockEnvironment();

  meta.set('ghost_bot', { followersCount: 10, followingCount: 1800, authorityRatio: 0.005 });
  meta.set('alice', { followersCount: 25000, followingCount: 500, authorityRatio: 50, isVerified: true });

  svc.addFile('followers_1.json', json(['alice', 'bob', 'ghost_bot', 'zack'])); // charlie lost, zack gained
  svc.addFile('following.json', followingJson(['alice', 'bob', 'charlie']));
  svc.commit();

  // Query UNFOLLOWED_YOU in nonFollowers list
  const lostQuery = svc.query({ list: 'nonFollowers', status: 'UNFOLLOWED_YOU' });
  assert.equal(lostQuery.total, 1);
  assert.equal(lostQuery.rows[0].username, 'charlie');

  // Query GHOST_FOLLOWER in followers list
  const ghostQuery = svc.query({ list: 'followers', status: 'GHOST_FOLLOWER' });
  assert.equal(ghostQuery.total, 1);
  assert.equal(ghostQuery.rows[0].username, 'ghost_bot');
  assert.equal(ghostQuery.rows[0].isGhostFollower, true);

  // Query NEW_FOLLOWER in followers list
  const newFollowerQuery = svc.query({ list: 'followers', status: 'NEW_FOLLOWER' });
  assert.equal(newFollowerQuery.total, 1);
  assert.equal(newFollowerQuery.rows[0].username, 'zack');

  // Clear diff history
  svc.clearDiffHistory();
  assert.equal(svc.getLatestDiff(), null);
  assert.deepEqual(svc.getDiffHistory(), []);
});

test('FollowersIntelligenceService: integrates ghost followers and diff metrics in report', async () => {
  const { svc, meta } = createMockEnvironment();
  meta.set('ghost_bot', { followersCount: 12, followingCount: 2100, authorityRatio: 0.005 });

  const intelligence = new FollowersIntelligenceService(svc);
  const data = intelligence.getIntelligence();

  assert.ok(data);
  assert.ok(data.summary);
  assert.equal(typeof data.summary.ghostFollowers, 'number');
  assert.equal(data.summary.ghostFollowers, 1);
  assert.ok(Array.isArray(data.recommendations));
  assert.ok(data.recommendations.some(r => r.includes('ghost followers')));
});
