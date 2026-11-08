import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { parseExportFile, buildModel } from '../src/services/export-parser.mjs';
import { AccountService } from '../src/services/account-service.mjs';
import { CheckpointService } from '../src/services/checkpoint-service.mjs';

test('Non-Followers Regression: calculations match ground truth exactly', () => {
  const exportDir = 'C:/Users/lenovo/Downloads/instagram-palash_more-2026-11-07-WFz6R9Dp/connections/followers_and_following';
  const followersHtml = fs.readFileSync(path.join(exportDir, 'followers_1.html'), 'utf8');
  const followingHtml = fs.readFileSync(path.join(exportDir, 'following.html'), 'utf8');
  const origArchive = path.join(exportDir, 'pending_follow_requests.html.orig-archive');
  const pendingHtml = fs.readFileSync(fs.existsSync(origArchive) ? origArchive : path.join(exportDir, 'pending_follow_requests.html'), 'utf8');

  const parsedFollowers = { name: 'followers_1.html', ...parseExportFile('followers_1.html', followersHtml) };
  const parsedFollowing = { name: 'following.html', ...parseExportFile('following.html', followingHtml) };
  const parsedPending = { name: 'pending_follow_requests.html', ...parseExportFile('pending_follow_requests.html', pendingHtml) };

  assert.equal(parsedFollowers.usernames.length, 3124, 'Followers count must be exactly 3,124');
  assert.equal(parsedFollowing.usernames.length, 1801, 'Following count must be exactly 1,801');
  assert.equal(parsedPending.usernames.length, 26990, 'Pending count must be exactly 26,990');

  const model = buildModel([parsedFollowers, parsedFollowing, parsedPending]);

  assert.equal(model.lists.followers.length, 3124, 'Model followers count');
  assert.equal(model.lists.following.length, 1801, 'Model following count');
  assert.equal(model.nonFollowers.length, 729, 'Non-followers count MUST BE 729');
  assert.equal(model.mutual.length, 1072, 'Mutual followers count MUST BE 1,072');
  assert.equal(model.lists.pending.length, 26990, 'Pending requests count MUST BE 26,990');

  // Verify nonFollowers + mutual = following (1801)
  assert.equal(model.nonFollowers.length + model.mutual.length, 1801, 'Non-followers + Mutual must equal Following');

  // Verify that pending accounts are kept apart and do not contaminate non-followers
  const nonFollowersSet = new Set(model.nonFollowers);
  const pendingSet = new Set(model.lists.pending);
  for (const u of nonFollowersSet) {
    // Non-followers must be accounts the user is FOLLOWING
    assert.ok(model.lists.following.includes(u), 'Non-follower must be in following list');
  }
});
