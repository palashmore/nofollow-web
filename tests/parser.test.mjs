import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsername, parseExportFile, buildModel, roleOf } from '../src/services/export-parser.mjs';
import { html, followersHtml, json, followingJson, tableHtml } from './fixtures/pages.mjs';

test('normalizeUsername handles urls, @, case and junk', () => {
  assert.equal(normalizeUsername('https://www.instagram.com/_u/Foo.Bar?igsh=1'), 'foo.bar');
  assert.equal(normalizeUsername('http://instagram.com/Foo'), 'foo');
  assert.equal(normalizeUsername('@Amy_1'), 'amy_1');
  assert.equal(normalizeUsername('www.instagram.com/p/abc'), null);   // reserved path, not a profile
  assert.equal(normalizeUsername(''), null);
  assert.equal(normalizeUsername('has space'), null);
  assert.equal(normalizeUsername(null), null);
});

test('roleOf recognises export files', () => {
  assert.equal(roleOf('followers_2.html'), 'followers');
  assert.equal(roleOf('following.json'), 'following');
  assert.equal(roleOf('pending_follow_requests.html'), 'pending');
  assert.equal(roleOf("profiles_you've_favorited.html"), 'favorites');
  assert.equal(roleOf('start_here.html'), null);
});

test('HTML following (_u links) and followers (plain links)', () => {
  const g = parseExportFile('following.html', html(['a', 'B', 'c']));
  assert.deepEqual(g.usernames, ['a', 'b', 'c']);
  const f = parseExportFile('followers_1.html', followersHtml(['x', 'y']));
  assert.deepEqual(f.usernames, ['x', 'y']);
  assert.ok(f.minDate);
});

test('JSON followers (list) and following (object) formats', () => {
  assert.deepEqual(parseExportFile('followers_1.json', json(['a', 'b'])).usernames, ['a', 'b']);
  assert.deepEqual(parseExportFile('following.json', followingJson(['pat', 'quin'])).usernames, ['pat', 'quin']);
});

test('empty, invalid and duplicate input', () => {
  assert.deepEqual(parseExportFile('followers_1.html', '<html></html>').usernames, []);
  assert.deepEqual(parseExportFile('followers_1.json', '[]').usernames, []);
  assert.throws(() => parseExportFile('following.json', '{not json'), /not valid JSON/);
  const d = parseExportFile('followers_1.json', json(['a', 'A', 'a']));
  assert.deepEqual(d.usernames, ['a']);
  assert.equal(d.duplicates, 2);
  const bad = parseExportFile('followers_1.json', JSON.stringify([{ title: 'x' }, { string_list_data: [{ value: 'ok_user' }] }]));
  assert.equal(bad.malformed, 1);
  assert.deepEqual(bad.usernames, ['ok_user']);
});

test('table-style files (URL cells) are read; rows without a profile url are counted, not trusted', () => {
  const p = parseExportFile('pending_follow_requests.html', tableHtml(['https://www.instagram.com/who?igsh=1', ' ']));
  assert.deepEqual(p.usernames, ['who']);
});

test('relationship model: non-followers, mutual, fans; multiple follower files merged; pending kept apart', () => {
  const m = buildModel([
    { name: 'followers_1.json', ...parseExportFile('followers_1.json', json(['a', 'b'])) },
    { name: 'followers_2.json', ...parseExportFile('followers_2.json', json(['b', 'C'])) },
    { name: 'following.json', ...parseExportFile('following.json', followingJson(['A', 'b', 'd', 'e'])) },
    { name: 'pending_follow_requests.html', ...parseExportFile('pending_follow_requests.html', tableHtml(['https://www.instagram.com/d'])) },
  ]);
  assert.deepEqual(m.nonFollowers, ['d', 'e']);        // d has a pending request but is NOT a follower
  assert.deepEqual(m.mutual, ['a', 'b']);
  assert.deepEqual(m.fans, ['c']);
  assert.deepEqual(m.lists.pending, ['d']);
  assert.equal(m.blocking, false);
});

test('validation: missing files and incomplete (last-year-only) followers export', () => {
  const noF = buildModel([{ name: 'following.json', ...parseExportFile('following.json', followingJson(['a'])) }]);
  assert.ok(noF.warnings.some(w => /No followers/.test(w)));
  assert.equal(noF.blocking, true);
  const old = parseExportFile('following.html', html(['a'], 'Jan 05, 2018 1:00 pm'));
  const recent = parseExportFile('followers_1.html', followersHtml(['b'], 'Nov 07, 2026 5:56 am'));
  const m = buildModel([{ name: 'following.html', ...old }, { name: 'followers_1.html', ...recent }]);
  assert.ok(m.warnings.some(w => /INCOMPLETE EXPORT/.test(w)));
  const fine = buildModel([{ name: 'following.html', ...old }, { name: 'followers_1.html', ...parseExportFile('followers_1.html', followersHtml(['b'], 'Feb 01, 2018 1:00 pm')) }]);
  assert.ok(!fine.warnings.some(w => /INCOMPLETE/.test(w)));
});

test('pending_follow_requests.html with Username table cells and oldest-first sorting', () => {
  const tableContent = `<html><body>
    <div><table><tr><td class="_a6_q">Username</td><td>newest_user</td></tr></table><div>Nov 06, 2026 10:05 pm</div></div>
    <div><table><tr><td class="_a6_q">Username</td><td>middle_user</td></tr></table><div>Feb 27, 2021 9:18 am</div></div>
    <div><table><tr><td class="_a6_q">Username</td><td>oldest_user</td></tr></table><div>Jan 31, 2017 4:31 am</div></div>
  </body></html>`;
  const p = parseExportFile('pending_follow_requests.html', tableContent);
  assert.equal(p.role, 'pending');
  assert.equal(p.malformed, 0);
  assert.deepEqual(p.usernames, ['oldest_user', 'middle_user', 'newest_user'], 'sorted oldest date first');
  assert.ok(p.userDates.oldest_user < p.userDates.newest_user);
});
