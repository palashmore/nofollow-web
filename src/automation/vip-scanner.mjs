import { EventEmitter } from 'events';
import { normalizeUsername } from '../services/export-parser.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * VIP & Influencer Scanner Engine.
 * Safely browses profile pages, extracts live Blue Tick (verified) status
 * and follower counts (e.g. 10k+, 50k+), and optionally auto-whitelists them.
 */
export class VipScannerEngine extends EventEmitter {
  constructor({ ig, profileMeta, whitelist, logger, getSettings }) {
    super();
    this.ig = ig;
    this.profileMeta = profileMeta;
    this.whitelist = whitelist;
    this.logger = logger;
    this.getSettings = getSettings || (() => ({}));

    this.active = false;
    this.stopFlag = false;
    this.pauseFlag = false;
    this.stats = {
      total: 0,
      processed: 0,
      verified: 0,
      above10k: 0,
      above50k: 0,
      current: null
    };
  }

  snapshot() {
    return {
      active: this.active,
      paused: this.pauseFlag,
      ...this.stats
    };
  }

  stop() {
    this.stopFlag = true;
    this.active = false;
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
    const queue = Array.from(new Set(usernames.map(normalizeUsername).filter(Boolean)));
    if (!queue.length) throw new Error('No valid usernames to scan.');

    this.active = true;
    this.stopFlag = false;
    this.pauseFlag = false;
    this.stats = {
      total: queue.length,
      processed: 0,
      verified: 0,
      above10k: 0,
      above50k: 0,
      current: null
    };
    this.emit('state', this.snapshot());

    try {
      for (const u of queue) {
        if (this.stopFlag) break;
        while (this.pauseFlag && !this.stopFlag) {
          await sleep(500);
        }
        if (this.stopFlag) break;

        this.stats.current = u;
        this.emit('state', this.snapshot());

        try {
          const insp = await this.ig.inspect(u, { navTimeout: 30000, elementTimeout: 8000 });
          const isVerified = !!insp.isVerified;
          const count = insp.followersCount || 0;
          const text = insp.followersText || (count ? String(count) : null);

          this.profileMeta.set(u, {
            followersCount: count,
            followersText: text,
            isVerified,
            relationship: insp.state
          });

          if (isVerified) this.stats.verified++;
          if (count >= 10000) this.stats.above10k++;
          if (count >= 50000) this.stats.above50k++;

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
            autoProtected
          });
        } catch (err) {
          this.logger.warn(`Could not inspect profile @${u}: ${err.message}`);
        }

        this.stats.processed++;
        this.emit('state', this.snapshot());

        if (this.stopFlag) break;
        // Polite delay between scans to respect Instagram rate limits
        await sleep(Math.max(2, intervalSec) * 1000);
      }
    } finally {
      this.active = false;
      this.stats.current = null;
      this.emit('state', this.snapshot());
    }

    return this.snapshot();
  }
}
