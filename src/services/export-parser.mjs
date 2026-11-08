// Parses Instagram "Download your information" files (JSON or HTML) and builds the
// follower / following relationship model. Pure functions: no file or browser access.

const USER_RE = /^[a-z0-9._]{1,30}$/;
const RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'tv', 'direct']);

export function normalizeUsername(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/^@/, '');
  if (/instagram\.com/i.test(s)) {
    try {
      const seg = new URL(/^https?:/i.test(s) ? s : `https://${s}`).pathname.split('/').filter(Boolean);
      s = seg[0] === '_u' ? seg[1] : seg[0];
    } catch { return null; }
  }
  s = (s || '').toLowerCase();
  return USER_RE.test(s) && !RESERVED.has(s) ? s : null;
}

// file name -> list key. Anything else is ignored.
export function roleOf(name) {
  const n = name.toLowerCase().replace(/\.(json|html)$/, '');
  if (/^followers(_\d+)?$/.test(n)) return 'followers';
  if (n === 'following') return 'following';
  if (n === 'pending_follow_requests') return 'pending';
  if (n === 'recently_unfollowed_profiles') return 'recent';
  if (n === 'blocked_profiles') return 'blocked';
  if (n === 'profiles_you\'ve_favorited') return 'favorites';
  if (n === 'restricted_profiles') return 'restricted';
  if (n === 'recent_follow_requests') return 'recentRequests';
  if (n === 'follow_requests_you\'ve_received') return 'requestsReceived';
  if (n === 'removed_suggestions') return 'removedSuggestions';
  return null;
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function flattenJson(j) {
  if (Array.isArray(j)) return j;
  return Object.values(j || {}).flatMap(v => (Array.isArray(v) ? v : []));
}

import { parsePendingRequests } from './pending-request-parser.mjs';

/** @returns {{role:string|null, usernames:string[], userDates:Record<string,number>, displayNames?:Record<string,string>, pendingRecords?:Array<object>, malformed:number, duplicates:number, minDate:number|null, maxDate:number|null}} */
export function parseExportFile(name, text) {
  const role = roleOf(name);
  if (role === 'pending') {
    const res = parsePendingRequests(text);
    return {
      role,
      usernames: res.usernames,
      userDates: res.userDates,
      displayNames: res.displayNames,
      pendingRecords: res.records,
      malformed: res.invalidCount,
      duplicates: res.duplicatesCount,
      minDate: res.earliestDate ? Date.parse(res.earliestDate) : null,
      maxDate: res.latestDate ? Date.parse(res.latestDate) : null,
    };
  }

  const found = [];       // normalized, may repeat
  const userDates = {};   // username -> timestamp (ms)
  let malformed = 0;
  const dates = [];
  const take = (v, ts = null) => {
    const u = normalizeUsername(v);
    if (u) {
      found.push(u);
      if (ts != null && userDates[u] == null) userDates[u] = ts;
    } else {
      malformed++;
    }
  };

  if (/\.json$/i.test(name)) {
    let j;
    try { j = JSON.parse(text); } catch { throw new Error(`${name}: not valid JSON`); }
    for (const item of flattenJson(j)) {
      const rows = item?.string_list_data;
      if (!Array.isArray(rows) || !rows.length) { malformed++; continue; }
      for (const r of rows) {
        const ts = r.timestamp ? r.timestamp * 1000 : null;
        take(r.value || r.href || item.title, ts);
        if (ts) dates.push(ts);
      }
    }
  } else {
    const links = [...text.matchAll(/href="(https?:\/\/(?:www\.)?instagram\.com\/[^"]+)"/g)].map(m => m[1]);
    const userMatches = [...text.matchAll(/<td class="_a6_q">Username<\/td><td[^>]*>([^<]*)<\/td>/gi)];
    const dateMatches = [...text.matchAll(/([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d+):(\d\d)\s?([ap]m)/gi)];

    if (links.length) {
      links.forEach(take);
    } else if (userMatches.length) {
      const hasDates = dateMatches.length === userMatches.length;
      for (let i = 0; i < userMatches.length; i++) {
        let ts = null;
        if (hasDates) {
          const d = dateMatches[i];
          let h = parseInt(d[4], 10);
          if (d[6].toLowerCase() === 'pm' && h < 12) h += 12;
          if (d[6].toLowerCase() === 'am' && h === 12) h = 0;
          ts = Date.UTC(parseInt(d[3], 10), MONTHS[d[1]], parseInt(d[2], 10), h, parseInt(d[5], 10));
        }
        take(userMatches[i][1].trim(), ts);
      }
    } else {
      [...text.matchAll(/<td class="_a6_q">URL<\/td><td[^>]*>([^<]*)<\/td>/g)].forEach(m => { if (m[1].trim()) take(m[1]); });
    }

    for (const m of text.matchAll(/([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) \d+:\d\d\s?[ap]m/g)) dates.push(Date.UTC(+m[3], MONTHS[m[1]], +m[2]));
  }
  let usernames = [...new Set(found)];
  return {
    role, usernames, userDates, malformed, duplicates: found.length - usernames.length,
    minDate: dates.length ? Math.min(...dates) : null, maxDate: dates.length ? Math.max(...dates) : null,
  };
}

const DAY = 864e5;

/** Merge parsed files into lists + relationship sets + validation warnings. */
export function buildModel(parsed) {
  const lists = {}; const files = []; const warnings = []; let dup = 0;
  const range = { followers: [null, null], following: [null, null] };
  const requestDates = {};
  const displayNames = {};
  const pendingRecords = [];
  for (const p of parsed) {
    files.push({ name: p.name, role: p.role, count: p.usernames.length, malformed: p.malformed, duplicates: p.duplicates });
    if (!p.role) continue;
    dup += p.duplicates;
    if (p.userDates) Object.assign(requestDates, p.userDates);
    if (p.displayNames) Object.assign(displayNames, p.displayNames);
    if (p.pendingRecords) pendingRecords.push(...p.pendingRecords);
    lists[p.role] = [...new Set([...(lists[p.role] || []), ...p.usernames])];
    if (range[p.role] && p.minDate != null) {
      const [a, b] = range[p.role];
      range[p.role] = [a == null ? p.minDate : Math.min(a, p.minDate), b == null ? p.maxDate : Math.max(b, p.maxDate)];
    }
    if (p.malformed) warnings.push(`${p.name}: ${p.malformed} record(s) had no usable username and were ignored.`);
  }
  if (lists.pending && Object.keys(requestDates).length) {
    lists.pending.sort((a, b) => (requestDates[a] || 0) - (requestDates[b] || 0));
  }
  const followers = lists.followers || []; const following = lists.following || [];
  if (!followers.length) warnings.push('No followers found. Import followers_1 (and followers_2... if present).');
  if (!following.length) warnings.push('No following found. Import the following file.');
  const [fMin] = range.followers; const [gMin] = range.following;
  if (fMin != null && gMin != null && fMin - gMin > 183 * DAY) {
    warnings.push(`INCOMPLETE EXPORT? Followers start ${new Date(fMin).toDateString()} but following starts ${new Date(gMin).toDateString()}. Re-export with date range "All time" or the non-follower list will be wrong.`);
  }
  const fset = new Set(followers); const gset = new Set(following);
  return {
    lists, files, warnings, duplicates: dup, requestDates, displayNames, pendingRecords,
    nonFollowers: following.filter(u => !fset.has(u)),
    mutual: following.filter(u => fset.has(u)),
    fans: followers.filter(u => !gset.has(u)),   // follow me, I don't follow back
    blocking: !followers.length || !following.length,
  };
}
