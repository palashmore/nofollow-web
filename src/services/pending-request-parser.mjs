// Dedicated parser and validator for Instagram outgoing pending follow requests.
// Source file: connections/followers_and_following/pending_follow_requests.html
// Pure module: no browser or network access.

const USER_RE = /^[a-z0-9._]{1,30}$/;
const RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'tv', 'direct']);

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
};

/** Decodes basic HTML entities commonly found in Instagram export names */
export function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/&#064;/g, '@')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Normalizes an Instagram username.
 * Strips @, extracts from URLs, lowercases, validates length and chars.
 * @param {string|null} raw
 * @returns {string|null}
 */
export function normalizeUsername(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/^@/, '');
  if (/instagram\.com/i.test(s)) {
    try {
      const parsedUrl = new URL(/^https?:/i.test(s) ? s : `https://${s}`);
      const segments = parsedUrl.pathname.split('/').filter(Boolean);
      s = segments[0] === '_u' ? segments[1] : segments[0];
    } catch {
      return null;
    }
  }
  s = (s || '').toLowerCase().trim();
  return USER_RE.test(s) && !RESERVED.has(s) ? s : null;
}

/**
 * Extracts username from a parsed HTML record chunk or string.
 * @param {string|object} record
 * @returns {string|null}
 */
export function extractUsername(record) {
  if (!record) return null;
  if (typeof record === 'object' && record.username) {
    return normalizeUsername(record.username);
  }
  const str = String(record);
  // Match table cell: <td class="_a6_q">Username</td><td[^>]*>username</td>
  const tableMatch = str.match(/<td class="_a6_q">Username<\/td><td[^>]*>([^<]*)<\/td>/i);
  if (tableMatch && tableMatch[1].trim()) {
    return normalizeUsername(tableMatch[1].trim());
  }
  // Match table cell: <td class="_a6_q">URL</td><td[^>]*>url</td>
  const urlCellMatch = str.match(/<td class="_a6_q">URL<\/td><td[^>]*>([^<]*)<\/td>/i);
  if (urlCellMatch && urlCellMatch[1].trim()) {
    return normalizeUsername(urlCellMatch[1].trim());
  }
  // Match Instagram URL link
  const linkMatch = str.match(/href="(?:https?:\/\/(?:www\.)?instagram\.com\/)?([^"/?#]+)/i);
  if (linkMatch && linkMatch[1]) {
    return normalizeUsername(linkMatch[1]);
  }
  return null;
}

/**
 * Extracts display name from a parsed HTML record chunk or string.
 * @param {string|object} record
 * @returns {string|null}
 */
export function extractDisplayName(record) {
  if (!record) return null;
  if (typeof record === 'object' && record.displayName !== undefined) {
    return record.displayName ? decodeHtmlEntities(record.displayName).trim() : null;
  }
  const str = String(record);
  const match = str.match(/<td class="_a6_q">Name<\/td><td[^>]*>([^<]*)<\/td>/i);
  if (match && match[1] && match[1].trim()) {
    return decodeHtmlEntities(match[1].trim());
  }
  return null;
}

/**
 * Builds the canonical profile URL for a user or record.
 * @param {string|object} record
 * @returns {string|null}
 */
export function extractProfileUrl(record) {
  const u = typeof record === 'string' ? normalizeUsername(record) : extractUsername(record);
  return u ? `https://www.instagram.com/${u}/` : null;
}

/**
 * Extracts and parses the request date from a record or string.
 * Supports:
 * - Instagram format: "Nov 06, 2026 10:05 pm", "Jan 31, 2017 4:31 am"
 * - ISO string: "2017-01-31T04:31:00.000Z"
 * - Unix timestamp in seconds or ms
 * Returns { requestedAt: string|null, requestedTimestamp: number|null, rawDate: string|null }
 * @param {string|object} record
 * @returns {{ requestedAt: string|null, requestedTimestamp: number|null, rawDate: string|null }}
 */
export function extractRequestDate(record) {
  const result = { requestedAt: null, requestedTimestamp: null, rawDate: null };
  if (!record) return result;

  let raw = '';
  if (typeof record === 'object') {
    raw = record.requestedAt || record.rawDate || record.date || '';
  } else {
    const str = String(record);
    const divMatch = str.match(/<div class="_3-94 _a6-o">([^<]+)<\/div>/i);
    raw = divMatch ? divMatch[1].trim() : str.trim();
  }

  if (!raw) return result;
  result.rawDate = raw;

  // 1. Instagram export format: "Nov 06, 2026 10:05 pm" or "Jan 31, 2017 4:31 am"
  const igMatch = raw.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?/i);
  if (igMatch) {
    const monthKey = igMatch[1].toLowerCase().slice(0, 3);
    const month = MONTHS[monthKey];
    const day = parseInt(igMatch[2], 10);
    const year = parseInt(igMatch[3], 10);
    let hour = parseInt(igMatch[4], 10);
    const minute = parseInt(igMatch[5], 10);
    const meridiem = (igMatch[6] || '').toLowerCase();

    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;

    if (month !== undefined && !isNaN(day) && !isNaN(year) && !isNaN(hour) && !isNaN(minute)) {
      const ms = Date.UTC(year, month, day, hour, minute);
      result.requestedTimestamp = ms;
      result.requestedAt = new Date(ms).toISOString();
      return result;
    }
  }

  // 2. Numeric Unix timestamp
  if (/^\d{10,13}$/.test(raw)) {
    const num = Number(raw);
    const ms = raw.length === 10 ? num * 1000 : num;
    if (!isNaN(ms) && ms > 0) {
      result.requestedTimestamp = ms;
      result.requestedAt = new Date(ms).toISOString();
      return result;
    }
  }

  // 3. Standard ISO / Date parse
  const parsed = Date.parse(raw);
  if (!isNaN(parsed) && parsed > 0) {
    result.requestedTimestamp = parsed;
    result.requestedAt = new Date(parsed).toISOString();
    return result;
  }

  return result;
}

/**
 * Validates a pending request record.
 * @param {object} record
 * @returns {{ valid: boolean, status: string, reason: string|null }}
 */
export function validatePendingRequest(record) {
  if (!record || typeof record !== 'object') {
    return { valid: false, status: 'NEEDS_REVIEW', reason: 'Missing or empty record' };
  }
  const u = normalizeUsername(record.username);
  if (!u) {
    return { valid: false, status: 'NEEDS_REVIEW', reason: 'Invalid or missing username' };
  }
  return { valid: true, status: 'PENDING', reason: null };
}

/**
 * Deduplicates pending requests by normalized username.
 * In case of duplicates:
 * - Retains the earliest valid request date
 * - Preserves displayName if available
 * - Merges attempts/history if present
 * @param {Array<object>} records
 * @returns {Array<object>}
 */
export function deduplicatePendingRequests(records) {
  if (!Array.isArray(records)) return [];
  const map = new Map();

  for (const item of records) {
    const u = normalizeUsername(item?.username);
    if (!u) continue;

    const existing = map.get(u);
    if (!existing) {
      map.set(u, { ...item, username: u });
    } else {
      // Retain the earliest valid request date
      const existingTs = existing.requestedTimestamp ?? Infinity;
      const itemTs = item.requestedTimestamp ?? Infinity;
      if (itemTs < existingTs) {
        existing.requestedTimestamp = item.requestedTimestamp;
        existing.requestedAt = item.requestedAt;
        existing.rawDate = item.rawDate;
      }
      if (!existing.displayName && item.displayName) {
        existing.displayName = item.displayName;
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Sorts pending requests strictly by original Instagram request date in ascending order.
 * Oldest request first (e.g. 2017 before 2019, 2019 before 2021).
 * Records with missing or invalid timestamps are placed after valid dated records.
 * @param {Array<object>} records
 * @returns {Array<object>}
 */
export function sortPendingRequestsOldestFirst(records) {
  if (!Array.isArray(records)) return [];
  return [...records].sort((a, b) => {
    const tsA = a.requestedTimestamp;
    const tsB = b.requestedTimestamp;

    // Both have valid timestamps: ascending (earliest first)
    if (tsA != null && tsB != null) return tsA - tsB;
    // Missing dates go to the bottom
    if (tsA != null && tsB == null) return -1;
    if (tsA == null && tsB != null) return 1;
    // Both missing dates: stable username sort
    return String(a.username || '').localeCompare(String(b.username || ''));
  });
}

/**
 * Parses the raw HTML from `pending_follow_requests.html`.
 * Extracts usernames, display names, and request dates.
 * Deduplicates and sorts Oldest First.
 *
 * @param {string} html Raw content of pending_follow_requests.html
 * @returns {{
 *   records: Array<object>,
 *   usernames: Array<string>,
 *   userDates: Record<string, number>,
 *   displayNames: Record<string, string>,
 *   totalRecords: number,
 *   uniqueCount: number,
 *   duplicatesCount: number,
 *   invalidCount: number,
 *   missingDateCount: number,
 *   earliestDate: string|null,
 *   latestDate: string|null
 * }}
 */
export function parsePendingRequests(html) {
  if (!html || typeof html !== 'string') {
    return {
      records: [],
      usernames: [],
      userDates: {},
      displayNames: {},
      totalRecords: 0,
      uniqueCount: 0,
      duplicatesCount: 0,
      invalidCount: 0,
      missingDateCount: 0,
      earliestDate: null,
      latestDate: null
    };
  }

  const rawCards = [];
  let chunks = [];
  if (html.includes('<div class="pam _3-95 _2ph- _a6-g uiBoxWhite noborder">')) {
    chunks = html.split('<div class="pam _3-95 _2ph- _a6-g uiBoxWhite noborder">').slice(1);
  } else if (html.includes('<div class="_a6-p">')) {
    chunks = html.split('<div class="_a6-p">').slice(1);
  } else if (/<table[^>]*>/i.test(html)) {
    chunks = html.split(/<table[^>]*>/i).slice(1);
  } else if (/<div[^>]*>/i.test(html)) {
    chunks = html.split(/<div[^>]*>/i).slice(1);
  } else {
    chunks = [html];
  }

  let invalidCount = 0;
  let missingDateCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const hasField = /<td class="_a6_q">(?:Username|URL)<\/td>/i.test(chunk);
    const u = extractUsername(chunk);
    if (!u) {
      if (hasField) {
        invalidCount++;
      }
      continue;
    }

    const displayName = extractDisplayName(chunk);
    const dateInfo = extractRequestDate(chunk);
    if (!dateInfo.requestedTimestamp) {
      missingDateCount++;
    }

    const record = {
      username: u,
      displayName: displayName || null,
      profileUrl: `https://www.instagram.com/${u}/`,
      requestedAt: dateInfo.requestedAt,
      requestedTimestamp: dateInfo.requestedTimestamp,
      rawDate: dateInfo.rawDate,
      source: 'pending_follow_requests.html',
      status: 'PENDING',
      lastAttemptAt: null,
      attemptCount: 0,
      reason: null
    };

    rawCards.push(record);
  }

  // Deduplicate and sort oldest-first
  const deduplicated = deduplicatePendingRequests(rawCards);
  const sorted = sortPendingRequestsOldestFirst(deduplicated);

  const userDates = {};
  const displayNames = {};
  for (const r of sorted) {
    if (r.requestedTimestamp != null) userDates[r.username] = r.requestedTimestamp;
    if (r.displayName) displayNames[r.username] = r.displayName;
  }

  const validTimestamps = sorted
    .map(r => r.requestedTimestamp)
    .filter(ts => ts != null);

  const earliestDate = validTimestamps.length ? new Date(Math.min(...validTimestamps)).toISOString() : null;
  const latestDate = validTimestamps.length ? new Date(Math.max(...validTimestamps)).toISOString() : null;

  return {
    records: sorted,
    usernames: sorted.map(r => r.username),
    userDates,
    displayNames,
    totalRecords: rawCards.length,
    uniqueCount: sorted.length,
    duplicatesCount: rawCards.length - sorted.length,
    invalidCount,
    missingDateCount,
    earliestDate,
    latestDate
  };
}
