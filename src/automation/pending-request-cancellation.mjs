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
   * Filters and sorts eligible pending requests oldest first.
   */
  eligible(usernames, { includeRetry = false } = {}) {
    const valid = usernames.filter(u => {
      const st = this.checkpoint.statusOf(u);
      if (FINAL.has(st) || st === STATUS.CANCELLED || st === STATUS.ALREADY_CANCELLED || st === STATUS.ACCEPTED || st === STATUS.PROFILE_UNAVAILABLE) {
        return false;
      }
      return includeRetry || (st !== STATUS.FAILED && st !== STATUS.NEEDS_REVIEW);
    });

    // Enforce oldest-first priority
    return this.sortOldestFirst(valid);
  }

  /**
   * Starts a cancellation run on selected accounts in oldest-first order.
   */
  async start(usernames, { includeRetry = false } = {}) {
    // Ensure input is uniquely sorted oldest-first
    const sorted = this.sortOldestFirst([...new Set(usernames)]);
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
      processingOrder: 'OLDEST_FIRST',
      currentDisplayName: current ? (displayNames[current] || null) : null,
      currentRequestDate: current && dates[current] ? new Date(dates[current]).toISOString() : null
    };
  }
}
