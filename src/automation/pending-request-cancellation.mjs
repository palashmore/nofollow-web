import { AutomationController } from './automation-controller.mjs';
import { STATUS, REL, FINAL, ENGINE } from '../utils/constants.mjs';

/**
 * Dedicated cancellation automation engine for Instagram outgoing pending follow requests.
 * Enforces:
 * - Strictly sequential single-worker execution
 * - Chronological Oldest-First processing
 * - Pre-click relationship verification
 * - Immediate atomic result checkpointing
 * - Automatic pause on security checks / action blocks / login expiration
 * - Zero impact on Non-Followers automation
 */
export class PendingRequestCancellationEngine extends AutomationController {
  constructor({ ig, checkpoint, logger, getSettings, accountService }) {
    super({ ig, checkpoint, logger, getSettings, job: 'cancel' });
    this.accountService = accountService;
  }

  /**
   * Sorts usernames strictly in oldest-first chronological order based on Instagram request date.
   * @param {Array<string>} usernames
   * @returns {Array<string>}
   */
  sortOldestFirst(usernames) {
    const dates = this.accountService?.model?.requestDates || {};
    return [...usernames].sort((a, b) => {
      const tsA = dates[a] ?? Infinity;
      const tsB = dates[b] ?? Infinity;
      if (tsA !== tsB) return tsA - tsB;
      return a.localeCompare(b);
    });
  }

  /**
   * Sorts usernames in newest-first chronological order (most recent requests first).
   * @param {Array<string>} usernames
   * @returns {Array<string>}
   */
  sortNewestFirst(usernames) {
    const dates = this.accountService?.model?.requestDates || {};
    return [...usernames].sort((a, b) => {
      const tsA = dates[a] ?? -Infinity;
      const tsB = dates[b] ?? -Infinity;
      if (tsA !== tsB) return tsB - tsA;
      return a.localeCompare(b);
    });
  }

  /**
   * Filters and sorts eligible pending requests by specified order (defaults to oldest first).
   */
  eligible(usernames, { includeRetry = false, order = 'oldest' } = {}) {
    const valid = usernames.filter(u => {
      const st = this.checkpoint.statusOf(u);
      if (FINAL.has(st) || st === STATUS.CANCELLED || st === STATUS.ALREADY_CANCELLED || st === STATUS.ACCEPTED || st === STATUS.PROFILE_UNAVAILABLE) {
        return false;
      }
      return includeRetry || (st !== STATUS.FAILED && st !== STATUS.NEEDS_REVIEW);
    });

    const isNewest = /new(est)?/i.test(order) || this.processingOrder === 'NEWEST_FIRST';
    return isNewest ? this.sortNewestFirst(valid) : this.sortOldestFirst(valid);
  }

  /**
   * Starts a cancellation run on selected accounts in specified order (oldest or newest first).
   */
  async start(usernames, { includeRetry = false, order = 'oldest' } = {}) {
    const isNewest = /new(est)?/i.test(order);
    this.processingOrder = isNewest ? 'NEWEST_FIRST' : 'OLDEST_FIRST';
    const sorted = isNewest
      ? this.sortNewestFirst([...new Set(usernames)])
      : this.sortOldestFirst([...new Set(usernames)]);
    return super.start(sorted, { includeRetry });
  }

  snapshot() {
    const snap = super.snapshot();
    const current = snap.current;
    const dates = this.accountService?.model?.requestDates || {};
    const displayNames = this.accountService?.model?.displayNames || {};

    return {
      ...snap,
      job: 'cancel',
      processingOrder: this.processingOrder || 'OLDEST_FIRST',
      currentDisplayName: current ? (displayNames[current] || null) : null,
      currentRequestDate: current && dates[current] ? new Date(dates[current]).toISOString() : null
    };
  }
}
