import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { atomicWriteJson, readJson } from '../utils/file-manager.mjs';
import { STATUS, FINAL } from '../utils/constants.mjs';

const MAX_RUNS = 100;

/** Final statuses where a pending request is definitively resolved */
export const PENDING_FINAL_STATUSES = new Set([
  STATUS.CANCELLED,
  STATUS.ALREADY_CANCELLED,
  STATUS.ACCEPTED,
  STATUS.PROFILE_UNAVAILABLE
]);

/**
 * Independent execution state and count management for Pending Requests.
 * Stored in data/pending-request-state.json (with automatic fallback/migration from cancellation-state.json).
 * Never touches or modifies data/done.json or data/execution-state.json.
 */
export class PendingRequestStateService {
  constructor(file) {
    this.file = file;
    let s = readJson(file, null);

    // Fallback/migration from cancellation-state.json if pending-request-state.json is empty
    if (!s || !s.accounts) {
      const altFile = path.join(path.dirname(file), 'cancellation-state.json');
      if (fs.existsSync(altFile)) {
        s = readJson(altFile, null);
      }
    }

    this.state = s && s.accounts ? s : {
      version: 1,
      job: 'cancel',
      processingOrder: 'OLDEST_FIRST',
      currentUsername: null,
      currentRequestDate: null,
      lastSuccess: null,
      accounts: {},
      runs: []
    };
  }

  get(username) {
    if (!username) return null;
    return this.state.accounts[username.toLowerCase()] || null;
  }

  statusOf(username) {
    return this.get(username)?.status || STATUS.PENDING;
  }

  isFinal(username) {
    const st = this.statusOf(username);
    return PENDING_FINAL_STATUSES.has(st) || FINAL.has(st);
  }

  save() {
    atomicWriteJson(this.file, this.state);
    try {
      const altFile = this.file.endsWith('pending-request-state.json')
        ? this.file.replace('pending-request-state.json', 'cancellation-state.json')
        : this.file.replace('cancellation-state.json', 'pending-request-state.json');
      if (altFile !== this.file) {
        atomicWriteJson(altFile, this.state);
      }
    } catch {
      // non-fatal
    }
  }

  counts() {
    const c = Object.fromEntries(Object.values(STATUS).map(s => [s, 0]));
    for (const a of Object.values(this.state.accounts)) {
      c[a.status] = (c[a.status] || 0) + 1;
    }
    return c;
  }

  /**
   * Sets or updates an account's cancellation state atomically.
   */
  set(username, patch = {}) {
    if (!username) return null;
    const u = username.toLowerCase();
    const prev = this.state.accounts[u] || {
      username: u,
      displayName: null,
      requestedAt: null,
      status: STATUS.PENDING,
      attempts: 0,
      lastAttemptAt: null,
      reason: null
    };

    const next = {
      ...prev,
      ...patch,
      username: u,
      updatedAt: new Date().toISOString()
    };

    this.state.accounts[u] = next;
    if (patch.status === STATUS.CANCELLED || patch.status === STATUS.ALREADY_CANCELLED) {
      this.state.lastSuccess = u;
    }
    this.state.currentUsername = u;
    this.save();
    return next;
  }

  /**
   * Single source of truth for pending request counts.
   *
   * Formulated strictly per specification:
   * Imported = Pending + In Progress + Cancelled + Already Cancelled + Accepted + Unavailable + Needs Review + Failed
   *
   * @param {Array<string>} importedUsernames Array of unique imported pending usernames
   * @param {Record<string, number>} [userDates] Optional timestamp map
   * @returns {object} Count breakdown
   */
  calculateCounts(importedUsernames = [], userDates = {}) {
    const importedSet = new Set((importedUsernames || []).map(u => u.toLowerCase()));
    const importedCount = importedSet.size;

    let pendingCount = 0;
    let inProgressCount = 0;
    let cancelledCount = 0;
    let alreadyCancelledCount = 0;
    let acceptedCount = 0;
    let unavailableCount = 0;
    let needsReviewCount = 0;
    let failedCount = 0;

    for (const u of importedSet) {
      const rec = this.get(u);
      const st = rec?.status || STATUS.PENDING;

      switch (st) {
        case STATUS.CANCELLED:
          cancelledCount++;
          break;
        case STATUS.ALREADY_CANCELLED:
          alreadyCancelledCount++;
          break;
        case STATUS.ACCEPTED:
          acceptedCount++;
          break;
        case STATUS.PROFILE_UNAVAILABLE:
          unavailableCount++;
          break;
        case STATUS.NEEDS_REVIEW:
          needsReviewCount++;
          break;
        case STATUS.FAILED:
        case STATUS.RETRY_PENDING:
          failedCount++;
          break;
        case STATUS.IN_PROGRESS:
          inProgressCount++;
          break;
        case STATUS.PENDING:
        case STATUS.PAUSED:
        case STATUS.ACTION_BLOCKED:
        default:
          pendingCount++;
          break;
      }
    }

    const finalCount = cancelledCount + alreadyCancelledCount + acceptedCount + unavailableCount;
    // Eligible pending are records not yet verified as final
    const eligibleCount = importedCount - finalCount;
    // Remaining are eligible records not currently being processed or finalized
    const remainingCount = Math.max(0, eligibleCount - inProgressCount);

    return {
      imported: importedCount,
      eligible: eligibleCount,
      pending: pendingCount,
      inProgress: inProgressCount,
      cancelled: cancelledCount,
      alreadyCancelled: alreadyCancelledCount,
      accepted: acceptedCount,
      unavailable: unavailableCount,
      needsReview: needsReviewCount,
      failed: failedCount,
      remaining: remainingCount,
      processingOrder: 'OLDEST_FIRST'
    };
  }

  startRun(selected, job = 'cancel') {
    const run = {
      runId: randomUUID(),
      job,
      processingOrder: 'OLDEST_FIRST',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      endedAt: null,
      status: 'RUNNING',
      selectedCount: selected.length,
      counts: {}
    };
    this.state.runs.unshift(run);
    this.state.runs.length = Math.min(this.state.runs.length, MAX_RUNS);
    this.save();
    return run;
  }

  updateRun(run, patch) {
    Object.assign(run, patch, { updatedAt: new Date().toISOString() });
    this.save();
  }

  /**
   * On startup or crash recovery: recovers in-flight accounts back to RETRY_PENDING.
   */
  recoverInterrupted() {
    let n = 0;
    for (const a of Object.values(this.state.accounts)) {
      if (a.status === STATUS.IN_PROGRESS) {
        a.status = STATUS.RETRY_PENDING;
        a.reason = 'interrupted before finishing';
        n++;
      }
    }
    for (const r of this.state.runs) {
      if (r.status === 'RUNNING') {
        r.status = 'INTERRUPTED';
        r.endedAt = r.updatedAt;
      }
    }
    this.state.currentUsername = null;
    if (n || this.state.runs.some(r => r.status === 'INTERRUPTED')) {
      this.save();
    }
    return n;
  }

  /**
   * Clears account results with a backup copy.
   */
  reset() {
    this.save();
    atomicWriteJson(`${this.file}.before-reset`, this.state);
    this.state.accounts = {};
    this.state.currentUsername = null;
    this.state.currentRequestDate = null;
    this.state.lastSuccess = null;
    this.save();
  }
}
