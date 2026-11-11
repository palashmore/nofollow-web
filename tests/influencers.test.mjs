import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseFollowerCount, classify } from '../src/automation/relationship-detector.mjs';
import { ProfileMetadataService } from '../src/services/profile-metadata-service.mjs';
import { WhitelistService } from '../src/services/whitelist-service.mjs';
import { VipScannerEngine } from '../src/automation/vip-scanner.mjs';
import { Logger } from '../src/services/logger-service.mjs';

test('parseFollowerCount: accurately parses various Instagram follower strings', () => {
  assert.equal(parseFollowerCount('12.5K'), 12500);
  assert.equal(parseFollowerCount('12.5k'), 12500);
  assert.equal(parseFollowerCount('2.1M'), 2100000);
  assert.equal(parseFollowerCount('15,400'), 15400);
  assert.equal(parseFollowerCount('850'), 850);
  assert.equal(parseFollowerCount('0'), 0);
  assert.equal(parseFollowerCount(''), null);
  assert.equal(parseFollowerCount(null), null);
  assert.equal(parseFollowerCount('invalid'), null);
});

test('classify: includes isVerified, followersCount, and followersText in returned snapshot info', () => {
  const snap = {
    url: 'https://www.instagram.com/creator/',
    buttons: ['Following'],
    bodyText: 'Photography & Art',
    isVerified: true,
    followersCount: 52000,
    followersText: '52K'
  };
  const res = classify(snap);
  assert.equal(res.state, 'FOLLOWING');
  assert.equal(res.isVerified, true);
  assert.equal(res.followersCount, 52000);
  assert.equal(res.followersText, '52K');
});

test('ProfileMetadataService: set, get, query filters, and summary calculation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-meta-'));
  const meta = new ProfileMetadataService(path.join(dir, 'meta.json'));

  meta.set('regular_user', { followersCount: 450, followersText: '450', isVerified: false });
  meta.set('@Big_Creator', { followersCount: 25000, followersText: '25K', isVerified: false });
  meta.set('celebrity', { followersCount: 1500000, followersText: '1.5M', isVerified: true });

  const reg = meta.get('regular_user');
  assert.equal(reg.followersCount, 450);
  assert.equal(reg.isVerified, false);

  const celeb = meta.get('celebrity');
  assert.equal(celeb.isVerified, true);
  assert.equal(celeb.followersCount, 1500000);

  // Summary
  const sum = meta.summary();
  assert.equal(sum.totalScanned, 3);
  assert.equal(sum.verifiedCount, 1);
  assert.equal(sum.above10k, 2); // Big_Creator and celebrity
  assert.equal(sum.above50k, 1); // celebrity

  // Query verified
  const verifiedOnly = meta.query({ verified: true });
  assert.equal(verifiedOnly.length, 1);
  assert.equal(verifiedOnly[0].username, 'celebrity');

  // Query minFollowers >= 10000
  const above10k = meta.query({ minFollowers: 10000 });
  assert.equal(above10k.length, 2);
  assert.equal(above10k[0].username, 'celebrity'); // sorted desc by followers
  assert.equal(above10k[1].username, 'big_creator');

  // has check
  assert.equal(meta.has('celebrity'), true);
  assert.equal(meta.has('big_creator'), true);
  assert.equal(meta.has('non_existent'), false);
});

test('VipScannerEngine: scans queue and auto-whitelists verified and >10K accounts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-vip-'));
  const meta = new ProfileMetadataService(path.join(dir, 'meta.json'));
  const wl = new WhitelistService(path.join(dir, 'wl.json'));
  const logger = new Logger(dir);

  const fakeIg = {
    async inspect(username) {
      if (username === 'star_athlete') {
        return { state: 'FOLLOWING', isVerified: true, followersCount: 5000000, followersText: '5M' };
      }
      if (username === 'popular_artist') {
        return { state: 'FOLLOWING', isVerified: false, followersCount: 15000, followersText: '15K' };
      }
      return { state: 'FOLLOWING', isVerified: false, followersCount: 300, followersText: '300' };
    }
  };

  const scanner = new VipScannerEngine({
    ig: fakeIg,
    profileMeta: meta,
    whitelist: wl,
    logger
  });

  const queue = ['star_athlete', 'popular_artist', 'normal_friend'];
  await scanner.scan(queue, { intervalSec: 0, autoWhitelistVerified: true, autoWhitelistMin: 10000 });

  assert.equal(scanner.stats.processed, 3);
  assert.equal(scanner.stats.verified, 1);
  assert.equal(scanner.stats.above10k, 2);

  // star_athlete (verified) and popular_artist (>10k) should be auto-whitelisted
  assert.equal(wl.has('star_athlete'), true);
  assert.equal(wl.has('popular_artist'), true);
  // normal_friend (300 followers) should NOT be whitelisted
  assert.equal(wl.has('normal_friend'), false);

  // Metadata should be saved
  assert.equal(meta.get('star_athlete').isVerified, true);
  assert.equal(meta.get('popular_artist').followersCount, 15000);
});

test('VipScannerEngine: uses dedicated inspectScanner and closes scanner tab on finish', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-vip-scanner-'));
  const meta = new ProfileMetadataService(path.join(dir, 'meta.json'));
  const wl = new WhitelistService(path.join(dir, 'wl.json'));
  const logger = new Logger(dir);

  let scannerTabClosed = false;
  const inspectedViaScanner = [];

  const fakeIg = {
    async inspectScanner(username) {
      inspectedViaScanner.push(username);
      return { state: 'FOLLOWING', isVerified: true, followersCount: 20000, followersText: '20K' };
    },
    async closeScannerTab() {
      scannerTabClosed = true;
    }
  };

  const scanner = new VipScannerEngine({
    ig: fakeIg,
    profileMeta: meta,
    whitelist: wl,
    logger
  });

  await scanner.scan(['vip_creator'], { intervalSec: 0 });

  assert.deepEqual(inspectedViaScanner, ['vip_creator'], 'should call dedicated inspectScanner');
  assert.equal(scannerTabClosed, true, 'should close scanner tab in finally block');
});
