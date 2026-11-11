import { EventEmitter } from 'events';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * LiveRelationshipSyncEngine
 * Extracts live followers and following directly from the authenticated Instagram session in the browser.
 * Bypasses the need for manual Instagram export ZIP downloads (followers_1.json, following.json).
 * 
 * Safety & Performance:
 * - Read-only: fetches user relationship lists without making any follow/unfollow mutations.
 * - Paced pagination: 300ms-600ms natural jitter between 50-account pages.
 * - Rate-limit circuit breaker: pauses and safely saves collected progress if Instagram issues HTTP 429.
 * - Tab isolation: uses dedicated scanner tab to prevent interfering with action tab.
 */
export class LiveRelationshipSyncEngine extends EventEmitter {
  constructor({ ig, accountService, profileMeta, logger }) {
    super();
    this.ig = ig;
    this.accounts = accountService;
    this.profileMeta = profileMeta;
    this.logger = logger;

    this.active = false;
    this.stopFlag = false;
    this.stats = {
      phase: 'IDLE', // 'IDLE' | 'INIT' | 'FOLLOWING' | 'FOLLOWERS' | 'INGESTING' | 'COMPLETED' | 'FAILED'
      processedFollowing: 0,
      totalFollowing: 0,
      processedFollowers: 0,
      totalFollowers: 0,
      current: null,
      error: null,
      startedAt: null,
      endedAt: null
    };
  }

  snapshot() {
    return {
      active: this.active,
      ...this.stats
    };
  }

  stop() {
    if (this.active) {
      this.stopFlag = true;
      this.logger.warn('Live relationship sync stop requested by user.');
    }
  }

  async sync({ delayMs = 350, maxFollowing = 0, maxFollowers = 0 } = {}) {
    if (this.active) throw new Error('Live relationship sync is already in progress.');
    this.active = true;
    this.stopFlag = false;
    this.stats = {
      phase: 'INIT',
      processedFollowing: 0,
      totalFollowing: 0,
      processedFollowers: 0,
      totalFollowers: 0,
      current: null,
      error: null,
      startedAt: new Date().toISOString(),
      endedAt: null
    };
    this.emit('state', this.snapshot());

    try {
      // 1. Ensure browser is open and session is verified
      await this.ig.ensureBrowser();
      const health = await this.ig.verifySession({ navTimeout: 25000 });
      if (health.state !== 'AUTHENTICATED') {
        throw new Error(health.reason || 'Instagram session not verified. Please log in to Instagram in the browser first.');
      }

      const myAccount = health.account;
      this.logger.info(`Starting live follower & following extraction for @${myAccount || 'current user'}...`);

      // 2. Acquire dedicated scanner tab
      const page = await this.ig.tabs.scanner();
      if (!page.url() || page.url() === 'about:blank') {
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      }

      // 3. Resolve user ID and expected counts from web_profile_info
      const initInfo = await page.evaluate(async (account) => {
        try {
          const cookieMatch = document.cookie.match(/ds_user_id=([0-9]+)/);
          const cookieUserId = cookieMatch ? cookieMatch[1] : null;

          let targetAccount = account;
          if (!targetAccount) {
            const viewerLink = document.querySelector('nav a[href^="/"][role="link"], a[href^="/"][role="link"] img[alt*="profile"]');
            const href = viewerLink?.closest('a')?.getAttribute('href');
            if (href) targetAccount = href.replace(/\//g, '').split('?')[0];
          }

          if (targetAccount) {
            const res = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(targetAccount)}`, {
              headers: {
                'X-IG-App-ID': '936619743392459',
                'X-Requested-With': 'XMLHttpRequest'
              },
              credentials: 'include'
            });
            if (res.ok) {
              const data = await res.json();
              const u = data?.data?.user;
              if (u) {
                return {
                  ok: true,
                  userId: u.id || cookieUserId,
                  username: u.username,
                  followingCount: u.edge_follow?.count || 0,
                  followersCount: u.edge_followed_by?.count || 0
                };
              }
            }
          }

          if (cookieUserId) {
            return { ok: true, userId: cookieUserId, username: account, followingCount: 0, followersCount: 0 };
          }
          return { ok: false, error: 'Could not determine user ID from active Instagram session.' };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }, myAccount);

      if (!initInfo || !initInfo.ok || !initInfo.userId) {
        throw new Error(initInfo?.error || 'Could not resolve logged-in Instagram account ID.');
      }

      const { userId } = initInfo;
      this.stats.totalFollowing = initInfo.followingCount || 0;
      this.stats.totalFollowers = initInfo.followersCount || 0;
      this.emit('state', this.snapshot());

      const followingList = [];
      const followersList = [];
      const displayNames = {};
      const userMeta = {};

      // 4. Extract Following
      this.stats.phase = 'FOLLOWING';
      this.emit('state', this.snapshot());
      let nextCursor = null;

      while (!this.stopFlag) {
        const res = await page.evaluate(async ({ uid, cursor }) => {
          try {
            const url = `https://www.instagram.com/api/v1/friendships/${uid}/following/?count=50${cursor ? `&max_id=${encodeURIComponent(cursor)}` : ''}`;
            const r = await fetch(url, {
              headers: {
                'X-IG-App-ID': '936619743392459',
                'X-Requested-With': 'XMLHttpRequest'
              },
              credentials: 'include'
            });
            if (!r.ok) return { ok: false, status: r.status };
            const json = await r.json();
            return { ok: true, users: json.users || [], nextCursor: json.next_max_id || null };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        }, { uid: userId, cursor: nextCursor });

        if (!res || !res.ok) {
          if (res?.status === 429) {
            this.logger.warn('Instagram rate limited following query; stopping following fetch safely.');
            break;
          }
          this.logger.warn(`Following batch fetch failed (${res?.error || res?.status}); stopping following phase.`);
          break;
        }

        const batch = res.users || [];
        for (const u of batch) {
          const uname = (u.username || '').toLowerCase().trim();
          if (uname && !followingList.includes(uname)) {
            followingList.push(uname);
            if (u.full_name) displayNames[uname] = u.full_name;
            userMeta[uname] = {
              isVerified: !!u.is_verified,
              fullName: u.full_name || '',
              profilePicUrl: u.profile_pic_url || null,
              pk: u.pk
            };
          }
        }

        this.stats.processedFollowing = followingList.length;
        if (!this.stats.totalFollowing || followingList.length > this.stats.totalFollowing) {
          this.stats.totalFollowing = followingList.length;
        }
        this.emit('state', this.snapshot());

        if (!res.nextCursor || batch.length === 0 || (maxFollowing > 0 && followingList.length >= maxFollowing)) {
          break;
        }
        nextCursor = res.nextCursor;

        // Pacing delay between pages
        const jitter = delayMs + Math.floor(Math.random() * 200);
        await sleep(jitter);
      }

      this.logger.info(`Live Sync: Extracted ${followingList.length} following accounts.`);

      // 5. Extract Followers
      if (!this.stopFlag) {
        this.stats.phase = 'FOLLOWERS';
        this.emit('state', this.snapshot());
        nextCursor = null;

        while (!this.stopFlag) {
          const res = await page.evaluate(async ({ uid, cursor }) => {
            try {
              const url = `https://www.instagram.com/api/v1/friendships/${uid}/followers/?count=50${cursor ? `&max_id=${encodeURIComponent(cursor)}` : ''}`;
              const r = await fetch(url, {
                headers: {
                  'X-IG-App-ID': '936619743392459',
                  'X-Requested-With': 'XMLHttpRequest'
                },
                credentials: 'include'
              });
              if (!r.ok) return { ok: false, status: r.status };
              const json = await r.json();
              return { ok: true, users: json.users || [], nextCursor: json.next_max_id || null };
            } catch (e) {
              return { ok: false, error: e.message };
            }
          }, { uid: userId, cursor: nextCursor });

          if (!res || !res.ok) {
            if (res?.status === 429) {
              this.logger.warn('Instagram rate limited followers query; stopping followers fetch safely.');
              break;
            }
            this.logger.warn(`Followers batch fetch failed (${res?.error || res?.status}); stopping followers phase.`);
            break;
          }

          const batch = res.users || [];
          for (const u of batch) {
            const uname = (u.username || '').toLowerCase().trim();
            if (uname && !followersList.includes(uname)) {
              followersList.push(uname);
              if (u.full_name) displayNames[uname] = u.full_name;
              userMeta[uname] = {
                isVerified: !!u.is_verified,
                fullName: u.full_name || '',
                profilePicUrl: u.profile_pic_url || null,
                pk: u.pk
              };
            }
          }

          this.stats.processedFollowers = followersList.length;
          if (!this.stats.totalFollowers || followersList.length > this.stats.totalFollowers) {
            this.stats.totalFollowers = followersList.length;
          }
          this.emit('state', this.snapshot());

          if (!res.nextCursor || batch.length === 0 || (maxFollowers > 0 && followersList.length >= maxFollowers)) {
            break;
          }
          nextCursor = res.nextCursor;

          // Pacing delay between pages
          const jitter = delayMs + Math.floor(Math.random() * 200);
          await sleep(jitter);
        }

        this.logger.info(`Live Sync: Extracted ${followersList.length} followers.`);
      }

      // 6. Ingest into AccountService
      this.stats.phase = 'INGESTING';
      this.emit('state', this.snapshot());

      const ingestResult = this.accounts.ingestLiveSync({
        following: followingList,
        followers: followersList,
        displayNames,
        userMeta
      });

      this.stats.phase = 'COMPLETED';
      this.stats.endedAt = new Date().toISOString();
      this.active = false;
      this.emit('state', this.snapshot());
      this.emit('completed', {
        followingCount: followingList.length,
        followersCount: followersList.length,
        summary: ingestResult
      });

      return {
        ok: true,
        followingCount: followingList.length,
        followersCount: followersList.length,
        latestDiff: ingestResult?.latestDiff || null,
        summary: ingestResult
      };
    } catch (e) {
      this.stats.phase = 'FAILED';
      this.stats.error = e.message;
      this.stats.endedAt = new Date().toISOString();
      this.active = false;
      this.emit('state', this.snapshot());
      this.logger.error(`Live relationship sync failed: ${e.message}`);
      throw e;
    } finally {
      if (typeof this.ig.closeScanner === 'function') {
        await this.ig.closeScanner().catch(() => {});
      }
    }
  }
}
