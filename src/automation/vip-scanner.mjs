import { EventEmitter } from 'events';
import { normalizeUsername } from '../services/export-parser.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * VIP & Influencer Scanner Engine.
 * Safely browses profile pages, extracts live Blue Tick (verified) status
 * and follower counts (e.g. 10k+, 50k+), and optionally auto-whitelists them.
 */
export class VipScannerEngine extends EventEmitter {
  constructor({ ig, profileMeta, whitelist, logger, getSettings, accountService }) {
    super();
    this.ig = ig;
    this.profileMeta = profileMeta;
    this.whitelist = whitelist;
    this.logger = logger;
    this.getSettings = getSettings || (() => ({}));
    this.accounts = accountService || null;

    this.active = false;
    this.stopFlag = false;
    this.pauseFlag = false;
    this.queue = [];
    this.stats = {
      total: 0,
      processed: 0,
      verified: 0,
      above10k: 0,
      above50k: 0,
      highAuthority: 0,
      current: null
    };
  }

  snapshot() {
    return {
      active: this.active,
      paused: this.pauseFlag,
      queueRemaining: this.queue.length,
      ...this.stats
    };
  }

  enqueue(usernames) {
    const fresh = usernames.map(normalizeUsername).filter(u => u && !this.queue.includes(u));
    this.queue.push(...fresh);
    this.stats.total = this.stats.processed + this.queue.length;
    this.emit('state', this.snapshot());
    return { added: fresh.length, enqueuedCount: fresh.length, total: this.stats.total, remaining: this.queue.length, queueRemaining: this.queue.length };
  }

  stop() {
    this.stopFlag = true;
    this.active = false;
    this.queue = [];
    this.emit('state', this.snapshot());
  }

  pause() {
    this.pauseFlag = true;
    this.emit('state', this.snapshot());
  }

  resume() {
    this.pauseFlag = false;
    this.emit('state', this.snapshot());
  }

  async scan(usernames, { intervalSec = 5, autoWhitelistVerified = false, autoWhitelistMin = 0 } = {}) {
    if (this.active) throw new Error('VIP Scanner is already running.');
    this.queue = Array.from(new Set(usernames.map(normalizeUsername).filter(Boolean)));
    if (!this.queue.length) throw new Error('No valid usernames to scan.');

    this.active = true;
    this.stopFlag = false;
    this.pauseFlag = false;
    this.stats = {
      total: this.queue.length,
      processed: 0,
      verified: 0,
      above10k: 0,
      above50k: 0,
      highAuthority: 0,
      current: null
    };
    this.emit('state', this.snapshot());

    try {
      while (this.queue.length > 0) {
        if (this.stopFlag) break;
        while (this.pauseFlag && !this.stopFlag) {
          await sleep(500);
        }
        if (this.stopFlag) break;

        const u = this.queue.shift();
        this.stats.current = u;
        this.emit('state', this.snapshot());

        try {
          const insp = typeof this.ig.inspectScanner === 'function'
            ? await this.ig.inspectScanner(u, { navTimeout: 30000, elementTimeout: 8000 })
            : await this.ig.inspect(u, { navTimeout: 30000, elementTimeout: 8000 });

          if (insp.state === 'ACTION_BLOCKED' || insp.state === 'CAPTCHA') {
            this.logger.warn(`VIP Scanner paused for safety: Instagram indicated ${insp.state}.`);
            this.pause();
            break;
          }

          const isVerified = !!insp.isVerified;
          const count = insp.followersCount || 0;
          const text = insp.followersText || (count ? String(count) : null);
          const gCount = insp.followingCount || 0;
          const gText = insp.followingText || (gCount ? String(gCount) : null);
          const ratio = insp.authorityRatio ?? (count && gCount ? Math.round((count / gCount) * 10) / 10 : null);

          let rel = null;
          if (insp.state && insp.state !== 'LOADING' && insp.state !== 'AMBIGUOUS') {
            if (insp.state === 'FOLLOWING') rel = 'Following';
            else if (insp.state === 'NOT_FOLLOWING') rel = 'Not following';
            else if (insp.state === 'REQUESTED') rel = 'Request pending';
            else rel = insp.state;
          }
          if (!rel && this.accounts) {
            const accRel = this.accounts.relationship(u);
            if (accRel && accRel !== 'Other') rel = accRel;
          }
          if (!rel) rel = 'Following';

          this.profileMeta.set(u, {
            followersCount: count,
            followersText: text,
            followingCount: gCount,
            followingText: gText,
            authorityRatio: ratio,
            isVerified,
            relationship: rel
          });

          if (isVerified) this.stats.verified++;
          if (count >= 10000) this.stats.above10k++;
          if (count >= 50000) this.stats.above50k++;
          if ((ratio || 0) >= 10) this.stats.highAuthority++;

          let autoProtected = false;
          if (this.whitelist) {
            if ((autoWhitelistVerified && isVerified) || (autoWhitelistMin > 0 && count >= autoWhitelistMin)) {
              this.whitelist.add(u);
              autoProtected = true;
              this.logger.info(`Auto-whitelisted VIP account @${u} (${isVerified ? 'Blue Tick' : ''} ${text || ''} followers).`);
            }
          }

          this.emit('scanned', {
            username: u,
            isVerified,
            followersCount: count,
            followersText: text,
            followingCount: gCount,
            followingText: gText,
            authorityRatio: ratio,
            autoProtected
          });
        } catch (err) {
          this.logger.warn(`Could not inspect profile @${u}: ${err.message}`);
        }

        this.stats.processed++;
        this.emit('state', this.snapshot());

        // 🛡️ Automatic Tab & Context Memory Recycling:
        // Close and recreate the scanner page every 150 accounts to maintain sub-50MB memory footprint
        if (this.stats.processed > 0 && this.stats.processed % 150 === 0) {
          if (typeof this.ig.recycleScannerTab === 'function') {
            await this.ig.recycleScannerTab().catch(() => {});
          } else if (typeof this.ig.closeScannerTab === 'function') {
            await this.ig.closeScannerTab().catch(() => {});
          }
        }

        if (this.stopFlag) break;
        // Delay between scans to respect Instagram rate limits
        await sleep(Math.max(0.2, intervalSec) * 1000);
      }
    } finally {
      this.active = false;
      this.stats.current = null;
      if (typeof this.ig.closeScannerTab === 'function') {
        await this.ig.closeScannerTab().catch(() => {});
      }
      this.emit('state', this.snapshot());
    }

    return this.snapshot();
  }
}
