import path from 'path';
import { readJson, atomicWriteJson } from '../utils/file-manager.mjs';

/**
 * Post Archive Manager service.
 * Manages post records, engagement analytics (likes, comments), and safe archiving actions.
 * Safety invariant: Deletion is NEVER used as an archive fallback.
 */
export class PostArchiveService {
  constructor(dataFile) {
    this.dataFile = dataFile;
    this.state = this.load();
  }

  load() {
    const s = readJson(this.dataFile, null);
    if (s && Array.isArray(s.posts)) return s;
    return {
      version: 1,
      lastSyncedAt: null,
      posts: []
    };
  }

  save() {
    atomicWriteJson(this.dataFile, this.state);
  }

  getPosts({ status = '', page = 1, size = 50, q = '', sort = 'postedAt', dir = 'desc' } = {}) {
    let list = [...this.state.posts];
    if (status) list = list.filter(p => p.status === status);
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter(p => (p.caption && p.caption.toLowerCase().includes(needle)) || (p.id && String(p.id).includes(needle)));
    }

    const mul = dir === 'asc' ? 1 : -1;
    if (sort === 'likes' || sort === 'likeCount') {
      list.sort((a, b) => mul * ((a.likeCount || 0) - (b.likeCount || 0)));
    } else if (sort === 'comments' || sort === 'commentCount') {
      list.sort((a, b) => mul * ((a.commentCount || 0) - (b.commentCount || 0)));
    } else {
      list.sort((a, b) => mul * (new Date(a.postedAt || 0).getTime() - new Date(b.postedAt || 0).getTime()));
    }

    const total = list.length;
    const paginated = list.slice((page - 1) * size, page * size);
    return { total, page, size, posts: paginated, summary: this.summary() };
  }

  addPost(post) {
    const exists = this.state.posts.find(p => p.id === post.id);
    if (exists) {
      Object.assign(exists, post, {
        likeCount: post.likeCount ?? exists.likeCount ?? 0,
        commentCount: post.commentCount ?? exists.commentCount ?? 0,
        thumbnailUrl: post.thumbnailUrl || exists.thumbnailUrl || '',
        updatedAt: new Date().toISOString()
      });
    } else {
      this.state.posts.unshift({
        id: post.id,
        url: post.url || `https://www.instagram.com/p/${post.id}/`,
        caption: post.caption || '',
        mediaType: post.mediaType || 'IMAGE', // IMAGE, VIDEO, CAROUSEL, REEL
        thumbnailUrl: post.thumbnailUrl || '',
        likeCount: Number(post.likeCount) || 0,
        commentCount: Number(post.commentCount) || 0,
        postedAt: post.postedAt || new Date().toISOString(),
        status: post.status || 'ACTIVE', // ACTIVE, ARCHIVED, QUEUED, FAILED
        lastAttemptAt: null,
        reason: null
      });
    }
    this.save();
  }

  bulkAddPosts(posts = []) {
    for (const post of posts) {
      const exists = this.state.posts.find(p => p.id === post.id);
      if (exists) {
        Object.assign(exists, post, {
          likeCount: post.likeCount ?? exists.likeCount ?? 0,
          commentCount: post.commentCount ?? exists.commentCount ?? 0,
          thumbnailUrl: post.thumbnailUrl || exists.thumbnailUrl || '',
          updatedAt: new Date().toISOString()
        });
      } else {
        this.state.posts.unshift({
          id: post.id,
          url: post.url || `https://www.instagram.com/p/${post.id}/`,
          caption: post.caption || '',
          mediaType: post.mediaType || 'IMAGE',
          thumbnailUrl: post.thumbnailUrl || '',
          likeCount: Number(post.likeCount) || 0,
          commentCount: Number(post.commentCount) || 0,
          postedAt: post.postedAt || new Date().toISOString(),
          status: post.status || 'ACTIVE',
          lastAttemptAt: null,
          reason: null
        });
      }
    }
    this.state.lastSyncedAt = new Date().toISOString();
    this.save();
    return this.summary();
  }

  setPostStatus(id, status, reason = null) {
    const p = this.state.posts.find(x => x.id === id);
    if (p) {
      p.status = status;
      p.reason = reason;
      p.lastAttemptAt = new Date().toISOString();
      this.save();
    }
    return p;
  }

  getEngagementSummary() {
    const posts = this.state.posts;
    const totalLikes = posts.reduce((sum, p) => sum + (Number(p.likeCount) || 0), 0);
    const totalComments = posts.reduce((sum, p) => sum + (Number(p.commentCount) || 0), 0);
    const count = posts.length || 1;
    const avgLikes = Math.round(totalLikes / count);
    const avgComments = Math.round(totalComments / count);
    const topPosts = [...posts]
      .sort((a, b) => ((b.likeCount || 0) + (b.commentCount || 0)) - ((a.likeCount || 0) + (a.commentCount || 0)))
      .slice(0, 6);

    return {
      totalPosts: posts.length,
      totalLikes,
      totalComments,
      avgLikes,
      avgComments,
      topPosts
    };
  }

  summary() {
    const total = this.state.posts.length;
    const archived = this.state.posts.filter(p => p.status === 'ARCHIVED').length;
    const active = this.state.posts.filter(p => p.status === 'ACTIVE').length;
    const queued = this.state.posts.filter(p => p.status === 'QUEUED').length;
    const eng = this.getEngagementSummary();
    return {
      total,
      archived,
      active,
      queued,
      lastSyncedAt: this.state.lastSyncedAt,
      totalLikes: eng.totalLikes,
      totalComments: eng.totalComments,
      avgLikes: eng.avgLikes,
      avgComments: eng.avgComments
    };
  }
}
