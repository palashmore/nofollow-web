import { parseExportFile, buildModel } from './export-parser.mjs';
import { atomicWriteJson, readJson } from '../utils/file-manager.mjs';
import { STATUS } from '../utils/constants.mjs';

const requestStatus = st => ({ PENDING: 'Pending', RETRY_PENDING: 'Pending', IN_PROGRESS: 'Pending', PAUSED: 'Pending', ACTION_BLOCKED: 'Pending', CANCELLED: 'Cancelled', ALREADY_CANCELLED: 'Cancelled', ACCEPTED: 'Accepted', PROFILE_UNAVAILABLE: 'Unavailable' }[st] || 'Unknown');
const LISTS = ['nonFollowers', 'followers', 'following', 'mutual', 'fans', 'pending', 'incoming', 'recent', 'blocked', 'favorites', 'restricted', 'recentRequests', 'requestsReceived', 'removedSuggestions'];

/** Holds the imported export (persisted, so a restart needs no re-import) and answers table queries. */
export class AccountService {
  /** checkpoints = { unfollow, cancel }: the pending-requests list reads the cancel checkpoint, every other list the unfollow one. */
  constructor(file, checkpoints, whitelist = null, profileMeta = null) {
    this.file = file; this.cps = checkpoints; this.whitelist = whitelist; this.profileMeta = profileMeta; this.incoming = [];
    this.model = readJson(file, null);
    this.#index();
  }

  #index() {
    const m = this.model;
    this.sets = m ? { followers: new Set(m.lists.followers || []), following: new Set(m.lists.following || []), pending: new Set(m.lists.pending || []) } : null;
  }

  /** Parse one uploaded file now (so large files are not kept in memory). */
  addFile(name, text) {
    const p = parseExportFile(name, text);
    this.incoming = this.incoming.filter(x => x.name !== name);
    this.incoming.push({ name, ...p });
    return { name, role: p.role, count: p.usernames.length, malformed: p.malformed, duplicates: p.duplicates };
  }

  commit() {
    if (!this.incoming.length) throw new Error('No files were uploaded.');
    this.model = { ...buildModel(this.incoming), importedAt: new Date().toISOString() };
    this.incoming = [];
    atomicWriteJson(this.file, this.model);
    this.#index();
    return this.summary();
  }

  summary() {
    const m = this.model; if (!m) return null;
    const L = k => (m.lists[k] || []).length;
    return { importedAt: m.importedAt, files: m.files, warnings: m.warnings, duplicates: m.duplicates, blocking: m.blocking,
      totals: { following: L('following'), followers: L('followers'), nonFollowers: m.nonFollowers.length, mutual: m.mutual.length, fans: m.fans.length, pending: L('pending'), recent: L('recent'), blocked: L('blocked') } };
  }

  list(key) {
    const m = this.model; if (!m || !LISTS.includes(key)) return [];
    if (key === 'incoming') return m.lists.requestsReceived || [];
    return key === 'nonFollowers' || key === 'mutual' || key === 'fans' ? m[key] : (m.lists[key] || []);
  }

  relationship(u) {
    const s = this.sets; if (!s) return '';
    const f = s.followers.has(u), g = s.following.has(u);
    return f && g ? 'Mutual' : g ? 'Not following back' : f ? 'Follows you only' : s.pending.has(u) ? 'Request pending' : 'Other';
  }

  /** Filter / sort / paginate one list. `ids` returns every matching username (for "select all filtered"). */
  query({ list = 'nonFollowers', q = '', status = '', sort = '', dir = 'asc', page = 1, size = 50, ids = false }) {
    const needle = q.trim().toLowerCase();
    const cp = list === 'pending' ? this.cps.cancel : this.cps.unfollow;
    let rows = this.list(list).map(u => {
      const a = cp.get(u);
      const st = a?.status || STATUS.PENDING;
      const displayName = this.model?.displayNames?.[u] || null;
      const meta = this.profileMeta?.get(u);
      return {
        username: u,
        displayName,
        relationship: this.relationship(u),
        accountStatus: st === STATUS.PROFILE_UNAVAILABLE ? 'Unavailable' : a ? 'Available' : '—',
        requestStatus: requestStatus(st),
        status: st,
        whitelisted: this.whitelist ? this.whitelist.has(u) : false,
        isVerified: meta?.isVerified ?? false,
        followersCount: meta?.followersCount ?? null,
        followersText: meta?.followersText ?? null,
        lastAttemptAt: a?.lastAttemptAt || null,
        reason: a?.reason || null,
        screenshot: a?.screenshot || null,
        requestedAt: this.model?.requestDates?.[u] || null
      };
    });
    if (needle) {
      rows = rows.filter(r => r.username.includes(needle) || (r.displayName && r.displayName.toLowerCase().includes(needle)));
    }
    if (status === 'WHITELISTED') {
      rows = rows.filter(r => r.whitelisted);
    } else if (status === 'VERIFIED') {
      rows = rows.filter(r => r.isVerified);
    } else if (status === 'ABOVE_10K') {
      rows = rows.filter(r => (r.followersCount || 0) >= 10000);
    } else if (status === 'ABOVE_50K') {
      rows = rows.filter(r => (r.followersCount || 0) >= 50000);
    } else if (status) {
      rows = rows.filter(r => r.status === status);
    }
    const validSorts = ['username', 'displayName', 'status', 'lastAttemptAt', 'relationship', 'requestedAt', 'followersCount'];
    const k = validSorts.includes(sort) ? sort : (list === 'pending' ? 'requestedAt' : 'username');
    const mul = dir === 'desc' ? -1 : 1;
    if (k === 'requestedAt') {
      rows.sort((a, b) => mul * ((a.requestedAt || 0) - (b.requestedAt || 0)));
    } else if (k === 'followersCount') {
      rows.sort((a, b) => mul * ((a.followersCount || 0) - (b.followersCount || 0)));
    } else {
      rows.sort((a, b) => mul * String(a[k] ?? '').localeCompare(String(b[k] ?? '')));
    }
    if (ids) return { total: rows.length, ids: rows.map(r => r.username) };
    size = Math.min(200, Math.max(10, +size || 50)); page = Math.max(1, +page || 1);
    return { total: rows.length, page, size, rows: rows.slice((page - 1) * size, page * size) };
  }

  kpis() {
    const c = this.cps.unfollow.counts();
    const t = this.summary()?.totals || {};
    const out = this.list('pending');
    const dates = this.model?.requestDates || {};
    const cancelCounts = this.cps.cancel.calculateCounts
      ? this.cps.cancel.calculateCounts(out, dates)
      : {
          imported: out.length,
          eligible: this.cancelEligible().length,
          pending: out.length - out.filter(u => this.cps.cancel.isFinal(u)).length,
          cancelled: this.cps.cancel.counts().CANCELLED,
          alreadyCancelled: this.cps.cancel.counts().ALREADY_CANCELLED,
          accepted: this.cps.cancel.counts().ACCEPTED,
          unavailable: this.cps.cancel.counts().PROFILE_UNAVAILABLE,
          failed: this.cps.cancel.counts().FAILED,
          needsReview: this.cps.cancel.counts().NEEDS_REVIEW,
          remaining: Math.max(0, out.length - out.filter(u => this.cps.cancel.isFinal(u)).length),
        };

    return {
      following: t.following || 0,
      followers: t.followers || 0,
      nonFollowers: t.nonFollowers || 0,
      mutual: t.mutual || 0,
      alreadyUnfollowed: c.ALREADY_UNFOLLOWED,
      unfollowed: c.UNFOLLOWED,
      pendingReview: c.NEEDS_REVIEW,
      failed: c.FAILED,
      unavailable: c.PROFILE_UNAVAILABLE,
      remaining: Math.max(0, (t.nonFollowers || 0) - (this.model?.nonFollowers || []).filter(u => this.cps.unfollow.isFinal(u)).length),
      cancel: {
        total: cancelCounts.imported,
        imported: cancelCounts.imported,
        eligible: cancelCounts.eligible,
        pending: cancelCounts.pending,
        cancelled: cancelCounts.cancelled,
        alreadyCancelled: cancelCounts.alreadyCancelled,
        accepted: cancelCounts.accepted,
        unavailable: cancelCounts.unavailable,
        failed: cancelCounts.failed,
        review: cancelCounts.needsReview,
        needsReview: cancelCounts.needsReview,
        remaining: cancelCounts.remaining,
        received: this.list('incoming').length,
        processingOrder: 'OLDEST_FIRST',
      },
    };
  }

  /** Outgoing pending requests that a "cancel all" run would still process, sorted oldest first. */
  cancelEligible() {
    const dates = this.model?.requestDates || {};
    const eligible = this.list('pending').filter(u => !this.cps.cancel.isFinal(u));
    return eligible.sort((a, b) => (dates[a] || 0) - (dates[b] || 0));
  }
}
