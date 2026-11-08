import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePendingRequests,
  extractUsername,
  extractDisplayName,
  extractProfileUrl,
  extractRequestDate,
  normalizeUsername,
  validatePendingRequest,
  deduplicatePendingRequests,
  sortPendingRequestsOldestFirst
} from '../src/services/pending-request-parser.mjs';

test('normalizeUsername: valid usernames, urls, case and trim', () => {
  assert.equal(normalizeUsername('example_user'), 'example_user');
  assert.equal(normalizeUsername('@Example_User'), 'example_user');
  assert.equal(normalizeUsername('  user.name_123  '), 'user.name_123');
  assert.equal(normalizeUsername('https://www.instagram.com/johndoe/'), 'johndoe');
  assert.equal(normalizeUsername('https://instagram.com/_u/janedoe/'), 'janedoe');
  assert.equal(normalizeUsername('instagram.com/test_user?igsh=123'), 'test_user');
  assert.equal(normalizeUsername(''), null);
  assert.equal(normalizeUsername(null), null);
  assert.equal(normalizeUsername('invalid space user'), null);
  assert.equal(normalizeUsername('user$name!'), null);
  assert.equal(normalizeUsername('reel'), null); // reserved keyword
  assert.equal(normalizeUsername('explore'), null); // reserved keyword
});

test('extractUsername: from table html and object', () => {
  const html = `<tr><td class="_a6_q">Username</td><td class="_2piu _a6_r">nikii_chaudhari_</td></tr>`;
  assert.equal(extractUsername(html), 'nikii_chaudhari_');

  const obj = { username: 'test_user' };
  assert.equal(extractUsername(obj), 'test_user');

  const emptyHtml = `<tr><td class="_a6_q">Username</td><td>   </td></tr>`;
  assert.equal(extractUsername(emptyHtml), null);

  const missingHtml = `<div>no username here</div>`;
  assert.equal(extractUsername(missingHtml), null);
});

test('extractDisplayName: decodes HTML entities and handles missing name', () => {
  const html = `<tr><td class="_a6_q">Name</td><td class="_2piu _a6_r">Nikita&#064;Chaudhari &amp; Co&#039;s</td></tr>`;
  assert.equal(extractDisplayName(html), "Nikita@Chaudhari & Co's");

  const noName = `<tr><td class="_a6_q">URL</td><td>https://test.com</td></tr>`;
  assert.equal(extractDisplayName(noName), null);

  const emojiName = `<tr><td class="_a6_q">Name</td><td>cute girl😘😘😘</td></tr>`;
  assert.equal(extractDisplayName(emojiName), 'cute girl😘😘😘');
});

test('extractProfileUrl: canonical instagram URL', () => {
  assert.equal(extractProfileUrl('bhagadkarshubhangi'), 'https://www.instagram.com/bhagadkarshubhangi/');
  assert.equal(extractProfileUrl({ username: 'radion_11' }), 'https://www.instagram.com/radion_11/');
  assert.equal(extractProfileUrl('invalid user!'), null);
});

test('extractRequestDate: Instagram date formats, ISO, and timestamps', () => {
  // 1. Instagram am/pm format
  const d1 = extractRequestDate('<div class="_3-94 _a6-o">Jan 31, 2017 4:31 am</div>');
  assert.ok(d1.requestedTimestamp);
  assert.equal(d1.requestedAt, '2017-01-31T04:31:00.000Z');

  const d2 = extractRequestDate('<div class="_3-94 _a6-o">Nov 06, 2026 10:05 pm</div>');
  assert.ok(d2.requestedTimestamp);
  assert.equal(d2.requestedAt, '2026-11-06T22:05:00.000Z');

  // 2. ISO timestamp
  const d3 = extractRequestDate('2019-07-05T17:23:00.000Z');
  assert.equal(d3.requestedAt, '2019-07-05T17:23:00.000Z');

  // 3. Epoch ms
  const d4 = extractRequestDate('1496741100000');
  assert.equal(d4.requestedAt, '2017-06-06T09:25:00.000Z');

  // 4. Invalid date
  const d5 = extractRequestDate('not a real date string');
  assert.equal(d5.requestedTimestamp, null);
  assert.equal(d5.requestedAt, null);
});

test('validatePendingRequest: valid and invalid records', () => {
  assert.deepEqual(validatePendingRequest({ username: 'valid_user' }), { valid: true, status: 'PENDING', reason: null });
  assert.deepEqual(validatePendingRequest({ username: '' }), { valid: false, status: 'NEEDS_REVIEW', reason: 'Invalid or missing username' });
  assert.deepEqual(validatePendingRequest(null), { valid: false, status: 'NEEDS_REVIEW', reason: 'Missing or empty record' });
});

test('deduplicatePendingRequests: retains earliest valid date', () => {
  const records = [
    { username: 'user_a', requestedTimestamp: 2000, requestedAt: '2020-01-01', displayName: null },
    { username: 'user_a', requestedTimestamp: 1000, requestedAt: '2019-01-01', displayName: 'User A' },
    { username: 'user_b', requestedTimestamp: 3000, requestedAt: '2021-01-01', displayName: 'User B' }
  ];

  const deduped = deduplicatePendingRequests(records);
  assert.equal(deduped.length, 2);
  const userA = deduped.find(r => r.username === 'user_a');
  assert.equal(userA.requestedTimestamp, 1000);
  assert.equal(userA.requestedAt, '2019-01-01');
  assert.equal(userA.displayName, 'User A');
});

test('sortPendingRequestsOldestFirst: 2017 before 2019 before 2021, missing dates at end', () => {
  const records = [
    { username: 'user_2021', requestedTimestamp: 1614417480000 }, // 2021
    { username: 'user_no_date', requestedTimestamp: null },
    { username: 'user_2017', requestedTimestamp: 1485837060000 }, // 2017
    { username: 'user_2019', requestedTimestamp: 1562347380000 }, // 2019
    { username: 'user_2017_b', requestedTimestamp: 1496741100000 } // Jun 2017
  ];

  const sorted = sortPendingRequestsOldestFirst(records);
  assert.deepEqual(
    sorted.map(r => r.username),
    ['user_2017', 'user_2017_b', 'user_2019', 'user_2021', 'user_no_date']
  );
});

test('parsePendingRequests: parses sample html cards accurately', () => {
  const html = `
    <html><body>
    <div class="pam _3-95 _2ph- _a6-g uiBoxWhite noborder">
      <div class="_3-95 _a6-p">
        <div class="pam _3-95 _2ph- _a6-g uiBoxWhite noborder">
          <div class="_a6-p">
            <table>
              <tr><td class="_a6_q">Name</td><td>Shubhangi Bhagadkar</td></tr>
              <tr><td class="_a6_q">Username</td><td>bhagadkarshubhangi</td></tr>
            </table>
          </div>
        </div>
      </div>
      <div class="_3-94 _a6-o">Jan 31, 2017 4:31 am</div>
    </div>
    <div class="pam _3-95 _2ph- _a6-g uiBoxWhite noborder">
      <div class="_3-95 _a6-p">
        <div class="pam _3-95 _2ph- _a6-g uiBoxWhite noborder">
          <div class="_a6-p">
            <table>
              <tr><td class="_a6_q">Name</td><td>Nikita Chaudhari</td></tr>
              <tr><td class="_a6_q">Username</td><td>nikii_chaudhari_</td></tr>
            </table>
          </div>
        </div>
      </div>
      <div class="_3-94 _a6-o">Nov 06, 2026 10:05 pm</div>
    </div>
    </body></html>
  `;

  const parsed = parsePendingRequests(html);
  assert.equal(parsed.totalRecords, 2);
  assert.equal(parsed.uniqueCount, 2);
  assert.equal(parsed.usernames[0], 'bhagadkarshubhangi'); // Oldest first!
  assert.equal(parsed.usernames[1], 'nikii_chaudhari_');
  assert.equal(parsed.records[0].displayName, 'Shubhangi Bhagadkar');
  assert.equal(parsed.records[0].requestedAt, '2017-01-31T04:31:00.000Z');
});

test('parsePendingRequests: empty or malformed input', () => {
  const empty = parsePendingRequests('');
  assert.equal(empty.totalRecords, 0);
  assert.equal(empty.records.length, 0);

  const nonString = parsePendingRequests(null);
  assert.equal(nonString.totalRecords, 0);
});
