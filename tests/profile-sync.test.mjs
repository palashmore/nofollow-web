import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { PostArchiveService } from '../src/services/post-archive-service.mjs';
import { ProfileSyncService } from '../src/services/profile-sync-service.mjs';

const TEST_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'profile-sync-test-data');
const POSTS_FILE = path.join(TEST_DIR, 'test-posts.json');

function cleanup() {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
}

test('PostArchiveService: records likes, comments and computes engagement metrics', () => {
  cleanup();
  const service = new PostArchiveService(POSTS_FILE);

  service.bulkAddPosts([
    { id: 'post1', caption: 'First post', likeCount: 120, commentCount: 15, mediaType: 'IMAGE', postedAt: '2026-01-01T10:00:00Z' },
    { id: 'post2', caption: 'Second video', likeCount: 300, commentCount: 45, mediaType: 'VIDEO', postedAt: '2026-02-01T10:00:00Z' },
    { id: 'post3', caption: 'Third reel', likeCount: 50, commentCount: 5, mediaType: 'REEL', postedAt: '2026-03-01T10:00:00Z' },
  ]);

  const summary = service.summary();
  assert.equal(summary.total, 3);
  assert.equal(summary.totalLikes, 470);
  assert.equal(summary.totalComments, 65);
  assert.equal(summary.avgLikes, Math.round(470 / 3));
  assert.equal(summary.avgComments, Math.round(65 / 3));
  assert.ok(summary.lastSyncedAt);

  // Sorting by likes descending
  const sortedLikes = service.getPosts({ sort: 'likes', dir: 'desc' });
  assert.equal(sortedLikes.posts[0].id, 'post2');
  assert.equal(sortedLikes.posts[0].likeCount, 300);

  // Sorting by comments descending
  const sortedComments = service.getPosts({ sort: 'comments', dir: 'desc' });
  assert.equal(sortedComments.posts[0].id, 'post2');
  assert.equal(sortedComments.posts[0].commentCount, 45);

  // Search filter
  const searched = service.getPosts({ q: 'video' });
  assert.equal(searched.posts.length, 1);
  assert.equal(searched.posts[0].id, 'post2');

  cleanup();
});

test('ProfileSyncService: loads, saves, and reports profile state', async () => {
  cleanup();
  const postArchive = new PostArchiveService(POSTS_FILE);
  const mockLogger = { info: () => {}, warn: () => {}, error: () => {} };
  const mockSession = {
    ensureBrowser: async () => {},
    verifySession: async () => ({ state: 'LOGIN_REQUIRED', reason: 'Please log in' }),
  };

  const syncService = new ProfileSyncService({
    session: mockSession,
    postArchive,
    dataDir: TEST_DIR,
    logger: mockLogger,
  });

  const prof = syncService.getProfile();
  assert.equal(prof.username, null);
  assert.equal(prof.postsCount, 0);

  // Expect error if not authenticated
  await assert.rejects(
    () => syncService.syncProfile(),
    /Please log in/i
  );

  cleanup();
});
