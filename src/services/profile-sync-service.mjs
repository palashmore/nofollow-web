import path from 'path';
import { readJson, atomicWriteJson, ensureDir } from '../utils/file-manager.mjs';

/**
 * ProfileSyncService
 * Safely coordinates with the authenticated Playwright browser session to sync:
 * - Profile details: avatar, bio, full name, follower/following/post counts
 * - Timeline posts: media thumbnail, caption, like count, comment count, post date, media type
 * 
 * Safety: Reads public profile and post analytics only. Never mutates or alters posts during sync.
 */
export class ProfileSyncService {
  constructor({ session, postArchive, dataDir, logger }) {
    this.session = session;
    this.postArchive = postArchive;
    this.dataFile = path.join(dataDir, 'profile.json');
    this.logger = logger;
    this.state = this.load();
  }

  load() {
    return readJson(this.dataFile, {
      username: null,
      fullName: '',
      biography: '',
      profilePicUrl: '',
      postsCount: 0,
      followersCount: 0,
      followingCount: 0,
      lastSyncedAt: null,
      posts: []
    });
  }

  save() {
    atomicWriteJson(this.dataFile, this.state);
  }

  getProfile() {
    return {
      ...this.state,
      postSummary: this.postArchive.summary(),
      engagement: this.postArchive.getEngagementSummary()
    };
  }

  /**
   * Sync complete Instagram profile and post analytics using the active browser session.
   */
  async syncProfile({ timeout = 30000 } = {}) {
    await this.session.ensureBrowser();
    const health = await this.session.verifySession({ navTimeout: timeout });
    if (health.state !== 'AUTHENTICATED') {
      throw new Error(health.reason || 'Instagram session not verified. Please log in to Instagram in the browser first.');
    }

    const username = health.account || this.state.username;
    if (!username) {
      throw new Error('Logged-in username could not be determined. Please ensure Instagram is loaded in the browser.');
    }

    this.logger.info(`Starting profile sync for @${username}...`);
    const page = await this.session.tabs.action();

    // Navigate to profile page
    const profileUrl = `https://www.instagram.com/${encodeURIComponent(username)}/`;
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForTimeout(1500);

    // Attempt high-fidelity sync via authenticated Instagram Web API in page context
    let syncResult = null;
    try {
      syncResult = await page.evaluate(async (uname) => {
        try {
          const res = await fetch(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(uname)}`, {
            headers: {
              'x-ig-app-id': '936619743392459',
              'x-requested-with': 'XMLHttpRequest'
            }
          });
          if (res.ok) {
            const data = await res.json();
            const u = data?.data?.user;
            if (u) {
              const posts = (u.edge_owner_to_timeline_media?.edges || []).map(e => {
                const n = e.node;
                return {
                  id: n.shortcode || n.id,
                  url: `https://www.instagram.com/p/${n.shortcode || n.id}/`,
                  caption: n.edge_media_to_caption?.edges?.[0]?.node?.text || '',
                  mediaType: n.is_video ? 'VIDEO' : (n.__typename === 'GraphSidecar' ? 'CAROUSEL' : 'IMAGE'),
                  thumbnailUrl: n.display_url || n.thumbnail_src || '',
                  likeCount: n.edge_liked_by?.count ?? n.edge_media_preview_like?.count ?? 0,
                  commentCount: n.edge_media_to_comment?.count ?? 0,
                  postedAt: n.taken_at_timestamp ? new Date(n.taken_at_timestamp * 1000).toISOString() : new Date().toISOString(),
                  status: 'ACTIVE'
                };
              });

              return {
                method: 'api',
                username: u.username,
                fullName: u.full_name || '',
                biography: u.biography || '',
                profilePicUrl: u.profile_pic_url_hd || u.profile_pic_url || '',
                postsCount: u.edge_owner_to_timeline_media?.count || posts.length,
                followersCount: u.edge_followed_by?.count || 0,
                followingCount: u.edge_follow?.count || 0,
                posts
              };
            }
          }
        } catch { /* fallback to dom */ }
        return null;
      }, username);
    } catch (e) {
      this.logger.warn(`API profile sync failed (${e.message}); attempting DOM fallback.`);
    }

    // Fallback: DOM scraping from profile page
    if (!syncResult) {
      syncResult = await page.evaluate((uname) => {
        const header = document.querySelector('header');
        const img = header?.querySelector('img[alt*="profile picture"]') || document.querySelector('img[alt*="profile picture"]');
        const bioEl = header?.querySelector('h1, section') || document.body;

        const statSpans = [...document.querySelectorAll('header li, header section ul li')];
        let postsCount = 0, followersCount = 0, followingCount = 0;
        for (const li of statSpans) {
          const t = li.innerText.toLowerCase();
          const num = parseInt(t.replace(/[^0-9]/g, ''), 10) || 0;
          if (t.includes('post')) postsCount = num;
          else if (t.includes('follower')) followersCount = num;
          else if (t.includes('following')) followingCount = num;
        }

        const postLinks = [...document.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]')];
        const posts = postLinks.slice(0, 36).map(a => {
          const m = a.getAttribute('href').match(/\/(p|reel)\/([^/]+)/);
          const shortcode = m ? m[2] : Math.random().toString(36).slice(2, 10);
          const pImg = a.querySelector('img');
          const alt = pImg?.getAttribute('alt') || '';
          const src = pImg?.getAttribute('src') || '';

          // Look for like/comment indicators if rendered
          const text = a.innerText || '';
          const likesMatch = text.match(/([0-9,kKmM]+)\s*(?:likes?)/i);
          const commentsMatch = text.match(/([0-9,kKmM]+)\s*(?:comments?)/i);

          const parseK = s => {
            if (!s) return 0;
            s = s.replace(/,/g, '').trim().toLowerCase();
            if (s.endsWith('k')) return Math.round(parseFloat(s) * 1000);
            if (s.endsWith('m')) return Math.round(parseFloat(s) * 1000000);
            return parseInt(s, 10) || 0;
          };

          return {
            id: shortcode,
            url: `https://www.instagram.com/p/${shortcode}/`,
            caption: alt.slice(0, 300),
            mediaType: a.getAttribute('href').includes('/reel/') ? 'REEL' : 'IMAGE',
            thumbnailUrl: src,
            likeCount: parseK(likesMatch?.[1]),
            commentCount: parseK(commentsMatch?.[1]),
            postedAt: new Date().toISOString(),
            status: 'ACTIVE'
          };
        });

        return {
          method: 'dom',
          username: uname,
          fullName: header?.querySelector('span, h2')?.innerText || '',
          biography: bioEl?.innerText?.slice(0, 200) || '',
          profilePicUrl: img?.getAttribute('src') || '',
          postsCount: postsCount || posts.length,
          followersCount,
          followingCount,
          posts
        };
      }, username);
    }

    if (!syncResult) {
      throw new Error('Could not extract Instagram profile data. Please refresh Instagram and try again.');
    }

    // Persist posts into PostArchiveService
    if (syncResult.posts && syncResult.posts.length > 0) {
      this.postArchive.bulkAddPosts(syncResult.posts);
    }

    // Update profile state
    this.state = {
      username: syncResult.username,
      fullName: syncResult.fullName || this.state.fullName,
      biography: syncResult.biography || this.state.biography,
      profilePicUrl: syncResult.profilePicUrl || this.state.profilePicUrl,
      postsCount: syncResult.postsCount || this.state.postsCount,
      followersCount: syncResult.followersCount || this.state.followersCount,
      followingCount: syncResult.followingCount || this.state.followingCount,
      lastSyncedAt: new Date().toISOString()
    };
    this.save();

    this.logger.info(`Profile synced successfully for @${username}: ${syncResult.posts?.length || 0} posts ingested.`);

    return this.getProfile();
  }
}
