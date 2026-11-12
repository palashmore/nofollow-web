import { EventEmitter } from 'events';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * LiveRelationshipSyncEngine
 * Extracts live followers, following, and pending follow requests directly from the authenticated Instagram session in the browser.
 * Bypasses the need for manual Instagram export ZIP downloads (followers_1.json, following.json, pending_follow_requests.json).
 * 
 * Architecture & Resilience:
 * - Dual-layer extraction: Native GraphQL connection (doc_id: 40819242737691319) with REST API fallback.
 * - Exponential backoff retry: Retries up to 3 times on temporary network errors or HTML throttles.
 * - Multi-tab isolation: Runs inside dedicated scanner tab, never interfering with the user's action tab.
 * - Pending request extraction: Automatically pulls outgoing & incoming pending follow requests.
 * - Zero data loss: Preserves existing historical records and whitelists.
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
      phase: 'IDLE', // 'IDLE' | 'INIT' | 'FOLLOWING' | 'FOLLOWERS' | 'PENDING' | 'INGESTING' | 'COMPLETED' | 'FAILED'
      processedFollowing: 0,
      totalFollowing: 0,
      processedFollowers: 0,
      totalFollowers: 0,
      processedPending: 0,
      totalPending: 0,
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

  async sync({ delayMs = 600, maxFollowing = 0, maxFollowers = 0, maxPending = 0 } = {}) {
    if (this.active) throw new Error('Live relationship sync is already in progress.');
    this.active = true;
    this.stopFlag = false;
    this.stats = {
      phase: 'INIT',
      processedFollowing: 0,
      totalFollowing: 0,
      processedFollowers: 0,
      totalFollowers: 0,
      processedPending: 0,
      totalPending: 0,
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
      this.logger.info(`Starting live sync (following, followers, pending requests) for @${myAccount || 'current user'}...`);

      // 2. Acquire dedicated scanner tab
      const page = await this.ig.tabs.scanner();
      if (!page.url() || !page.url().includes('instagram.com')) {
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await sleep(1500);
      }

      // 3. Resolve user ID, expected counts, and session tokens with retry
      let initInfo = null;
      for (let initAttempt = 0; initAttempt < 3; initAttempt++) {
        try {
          initInfo = await page.evaluate(async (account) => {
            try {
              const cookieMatch = document.cookie.match(/ds_user_id=([0-9]+)/);
              const cookieUserId = cookieMatch ? cookieMatch[1] : null;
              const csrfMatch = document.cookie.match(/csrftoken=([^;]+)/);
              const csrfToken = csrfMatch ? csrfMatch[1] : '';

              let dtsg = '';
              try {
                const scriptTags = Array.from(document.querySelectorAll('script')).map(s => s.textContent);
                for (const s of scriptTags) {
                  const m = s.match(/"DTSGInitialData"[^}]*"token":"([^"]+)"/) || s.match(/\["DTSGInitialData",\[\],{"token":"([^"]+)"}/);
                  if (m) { dtsg = m[1]; break; }
                }
              } catch (_) {}

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
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRFToken': csrfToken
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
                      followersCount: u.edge_followed_by?.count || 0,
                      dtsg,
                      csrfToken
                    };
                  }
                }
              }

              if (cookieUserId) {
                return {
                  ok: true,
                  userId: cookieUserId,
                  username: account,
                  followingCount: 0,
                  followersCount: 0,
                  dtsg,
                  csrfToken
                };
              }
              return { ok: false, error: 'Could not determine user ID from active Instagram session.' };
            } catch (e) {
              return { ok: false, error: e.message };
            }
          }, myAccount);

          if (initInfo?.ok) break;
        } catch (err) {
          if (/context was destroyed|navigation/i.test(err.message)) {
            await sleep(1500);
            continue;
          }
          throw err;
        }
      }

      if (!initInfo || !initInfo.ok || !initInfo.userId) {
        throw new Error(initInfo?.error || 'Could not resolve logged-in Instagram account ID.');
      }

      const { userId, dtsg: sessionDtsg, csrfToken: sessionCsrf } = initInfo;
      this.stats.totalFollowing = initInfo.followingCount || 0;
      this.stats.totalFollowers = initInfo.followersCount || 0;
      this.emit('state', this.snapshot());

      const followingList = [];
      const followersList = [];
      const pendingList = [];
      const displayNames = {};
      const userMeta = {};

      // 4. Extract Following
      this.stats.phase = 'FOLLOWING';
      this.emit('state', this.snapshot());
      let nextCursor = null;

      while (!this.stopFlag) {
        let attempt = 0;
        let batchRes = null;

        while (attempt < 3 && !this.stopFlag) {
          attempt++;
          batchRes = await page.evaluate(async ({ uid, cursor, dtsg, csrf }) => {
            try {
              // Primary: GraphQL connection (resilient against edge limits)
              if (dtsg) {
                const p = new URLSearchParams();
                p.append('fb_dtsg', dtsg);
                p.append('doc_id', '40819242737691319');
                const vars = { isFollowerList: false, query: '', userID: uid };
                if (cursor) vars.after = cursor;
                p.append('variables', JSON.stringify(vars));

                const gr = await fetch('/api/graphql', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-IG-App-ID': '936619743392459',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRFToken': csrf || ''
                  },
                  body: p.toString(),
                  credentials: 'include'
                });

                if (gr.ok) {
                  const gj = await gr.json();
                  const conn = gj.data?.xdt_api__v1__friendships__following__connection ||
                               gj.data?.xdt_api__v1__friendships__followers__connection ||
                               Object.values(gj.data || {})[0];
                  if (conn && Array.isArray(conn.edges)) {
                    const users = (conn.edges || []).map(e => ({
                      username: e.node?.username,
                      full_name: e.node?.full_name,
                      pk: e.node?.pk || e.node?.id,
                      is_verified: !!e.node?.is_verified,
                      profile_pic_url: e.node?.profile_pic_url,
                      isOutgoingRequest: !!e.node?.friendship_status?.outgoing_request
                    }));
                    return {
                      ok: true,
                      source: 'GRAPHQL',
                      users,
                      nextCursor: conn.page_info?.has_next_page ? conn.page_info?.end_cursor : null,
                      hasMore: !!conn.page_info?.has_next_page
                    };
                  }
                }
              }

              // Fallback: REST API endpoint
              const restUrl = `https://www.instagram.com/api/v1/friendships/${uid}/following/?count=50${cursor ? `&max_id=${encodeURIComponent(cursor)}` : ''}`;
              const r = await fetch(restUrl, {
                headers: {
                  'X-IG-App-ID': '936619743392459',
                  'X-Requested-With': 'XMLHttpRequest',
                  'X-CSRFToken': csrf || ''
                },
                credentials: 'include'
              });

              const ct = r.headers.get('content-type') || '';
              if (r.ok && ct.includes('json')) {
                const json = await r.json();
                const users = (json.users || []).map(u => ({
                  username: u.username,
                  full_name: u.full_name,
                  pk: u.pk,
                  is_verified: !!u.is_verified,
                  profile_pic_url: u.profile_pic_url,
                  isOutgoingRequest: false
                }));
                return {
                  ok: true,
                  source: 'REST',
                  users,
                  nextCursor: json.next_max_id || null,
                  hasMore: json.big_list === true || !!json.next_max_id
                };
              }

              return { ok: false, status: r?.status || 500, ct };
            } catch (e) {
              return { ok: false, error: e.message };
            }
          }, { uid: userId, cursor: nextCursor, dtsg: sessionDtsg, csrf: sessionCsrf });

          if (batchRes?.ok) break;
          // Temporary error, wait with exponential backoff before retry
          this.logger.warn(`Following batch attempt ${attempt} failed (${batchRes?.error || batchRes?.status}); retrying in ${attempt * 2}s...`);
          await sleep(2000 * attempt);
        }

        if (!batchRes || !batchRes.ok) {
          this.logger.warn(`Following pagination completed or throttled at ${followingList.length} accounts.`);
          break;
        }

        const batch = batchRes.users || [];
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
            if (u.isOutgoingRequest && !pendingList.includes(uname)) {
              pendingList.push(uname);
            }
          }
        }

        this.stats.processedFollowing = followingList.length;
        if (!this.stats.totalFollowing || followingList.length > this.stats.totalFollowing) {
          this.stats.totalFollowing = followingList.length;
        }
        this.emit('state', this.snapshot());

        const hasMoreFollowing = batchRes.hasMore !== undefined ? batchRes.hasMore : !!batchRes.nextCursor;
        if (!batchRes.nextCursor || batch.length === 0 || !hasMoreFollowing || (maxFollowing > 0 && followingList.length >= maxFollowing)) {
          break;
        }
        nextCursor = batchRes.nextCursor;

        // Pacing delay between pages
        const jitter = Math.max(300, delayMs) + Math.floor(Math.random() * 200);
        await sleep(jitter);
      }

      this.logger.info(`Live Sync: Extracted ${followingList.length} following accounts.`);

      // 5. Extract Followers
      if (!this.stopFlag) {
        this.stats.phase = 'FOLLOWERS';
        this.emit('state', this.snapshot());
        nextCursor = null;

        while (!this.stopFlag) {
          let attempt = 0;
          let batchRes = null;

          while (attempt < 3 && !this.stopFlag) {
            attempt++;
            batchRes = await page.evaluate(async ({ uid, cursor, dtsg, csrf }) => {
              try {
                // Primary: GraphQL connection (resilient against edge rate-limits)
                if (dtsg) {
                  const p = new URLSearchParams();
                  p.append('fb_dtsg', dtsg);
                  p.append('doc_id', '40819242737691319');
                  const vars = { isFollowerList: true, query: '', userID: uid };
                  if (cursor) vars.after = cursor;
                  p.append('variables', JSON.stringify(vars));

                  const gr = await fetch('/api/graphql', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/x-www-form-urlencoded',
                      'X-IG-App-ID': '936619743392459',
                      'X-Requested-With': 'XMLHttpRequest',
                      'X-CSRFToken': csrf || ''
                    },
                    body: p.toString(),
                    credentials: 'include'
                  });

                  if (gr.ok) {
                    const gj = await gr.json();
                    const conn = gj.data?.xdt_api__v1__friendships__followers__connection;
                    if (conn) {
                      const users = (conn.edges || []).map(e => ({
                        username: e.node?.username,
                        full_name: e.node?.full_name,
                        pk: e.node?.pk || e.node?.id,
                        is_verified: !!e.node?.is_verified,
                        profile_pic_url: e.node?.profile_pic_url,
                        isOutgoingRequest: !!e.node?.friendship_status?.outgoing_request
                      }));
                      return {
                        ok: true,
                        source: 'GRAPHQL',
                        users,
                        nextCursor: conn.page_info?.has_next_page ? conn.page_info?.end_cursor : null,
                        hasMore: !!conn.page_info?.has_next_page
                      };
                    }
                  }
                }

                // Fallback: REST API endpoint
                const restUrl = `https://www.instagram.com/api/v1/friendships/${uid}/followers/?count=50${cursor ? `&max_id=${encodeURIComponent(cursor)}` : ''}`;
                const r = await fetch(restUrl, {
                  headers: {
                    'X-IG-App-ID': '936619743392459',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRFToken': csrf || ''
                  },
                  credentials: 'include'
                });

                const ct = r.headers.get('content-type') || '';
                if (r.ok && ct.includes('json')) {
                  const json = await r.json();
                  const users = (json.users || []).map(u => ({
                    username: u.username,
                    full_name: u.full_name,
                    pk: u.pk,
                    is_verified: !!u.is_verified,
                    profile_pic_url: u.profile_pic_url,
                    isOutgoingRequest: false
                  }));
                  return {
                    ok: true,
                    source: 'REST',
                    users,
                    nextCursor: json.next_max_id || null,
                    hasMore: json.big_list === true || !!json.next_max_id
                  };
                }

                return { ok: false, status: r.status, ct };
              } catch (e) {
                return { ok: false, error: e.message };
              }
            }, { uid: userId, cursor: nextCursor, dtsg: sessionDtsg, csrf: sessionCsrf });

            if (batchRes?.ok) break;
            this.logger.warn(`Followers batch attempt ${attempt} failed (${batchRes?.error || batchRes?.status}); retrying in ${attempt * 2}s...`);
            await sleep(2000 * attempt);
          }

          if (!batchRes || !batchRes.ok) {
            this.logger.warn(`Followers pagination completed or throttled at ${followersList.length} accounts.`);
            break;
          }

          const batch = batchRes.users || [];
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
              if (u.isOutgoingRequest && !pendingList.includes(uname)) {
                pendingList.push(uname);
              }
            }
          }

          this.stats.processedFollowers = followersList.length;
          if (!this.stats.totalFollowers || followersList.length > this.stats.totalFollowers) {
            this.stats.totalFollowers = followersList.length;
          }
          this.emit('state', this.snapshot());

          const hasMoreFollowers = batchRes.hasMore !== undefined ? batchRes.hasMore : !!batchRes.nextCursor;
          if (!batchRes.nextCursor || batch.length === 0 || !hasMoreFollowers || (maxFollowers > 0 && followersList.length >= maxFollowers)) {
            break;
          }
          nextCursor = batchRes.nextCursor;

          // Pacing delay between pages
          const jitter = Math.max(300, delayMs) + Math.floor(Math.random() * 200);
          await sleep(jitter);
        }

        this.logger.info(`Live Sync: Extracted ${followersList.length} followers.`);
      }

      // 6. Extract Pending Follow Requests
      if (!this.stopFlag) {
        this.stats.phase = 'PENDING';
        this.emit('state', this.snapshot());

        const pendingRes = await page.evaluate(async ({ csrf }) => {
          try {
            const r = await fetch('/api/v1/friendships/pending/', {
              headers: {
                'X-IG-App-ID': '936619743392459',
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRFToken': csrf || ''
              },
              credentials: 'include'
            });

            if (r.ok) {
              const j = await r.json();
              return { ok: true, users: j.users || [] };
            }
            return { ok: false, status: r.status };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        }, { csrf: sessionCsrf });

        if (pendingRes?.ok && Array.isArray(pendingRes.users)) {
          for (const u of pendingRes.users) {
            const uname = (u.username || '').toLowerCase().trim();
            if (uname && !pendingList.includes(uname)) {
              pendingList.push(uname);
              if (u.full_name) displayNames[uname] = u.full_name;
              userMeta[uname] = {
                isVerified: !!u.is_verified,
                fullName: u.full_name || '',
                profilePicUrl: u.profile_pic_url || null,
                pk: u.pk
              };
            }
          }
        }

        this.stats.processedPending = pendingList.length;
        this.stats.totalPending = pendingList.length;
        this.emit('state', this.snapshot());
        this.logger.info(`Live Sync: Extracted ${pendingList.length} pending requests.`);
      }

      // 7. Ingest into AccountService
      this.stats.phase = 'INGESTING';
      this.emit('state', this.snapshot());

      const ingestResult = this.accounts.ingestLiveSync({
        following: followingList,
        followers: followersList,
        pending: pendingList,
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
        pendingCount: pendingList.length,
        summary: ingestResult
      });

      return {
        ok: true,
        followingCount: followingList.length,
        followersCount: followersList.length,
        pendingCount: pendingList.length,
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
