import path from 'path';
import { readJson, atomicWriteJson } from '../utils/file-manager.mjs';

/**
 * Post Archive Manager service.
 * Manages post records and safe archiving actions.
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

  getPosts({ status = '', page = 1, size = 50, q = '' } = {}) {
    let list = this.state.posts;
    if (status) list = list.filter(p => p.status === status);
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter(p => (p.caption && p.caption.toLowerCase().includes(needle)) || p.id.includes(needle));
    }
    const total = list.length;
    const paginated = list.slice((page - 1) * size, page * size);
    return { total, page, size, posts: paginated };
  }

  addPost(post) {
    const exists = this.state.posts.find(p => p.id === post.id);
    if (exists) {
      Object.assign(exists, post, { updatedAt: new Date().toISOString() });
    } else {
      this.state.posts.unshift({
        id: post.id,
        url: post.url || `https://www.instagram.com/p/${post.id}/`,
        caption: post.caption || '',
        mediaType: post.mediaType || 'IMAGE', // IMAGE, VIDEO, CAROUSEL
        postedAt: post.postedAt || new Date().toISOString(),
        status: post.status || 'ACTIVE', // ACTIVE, ARCHIVED, QUEUED, FAILED
        lastAttemptAt: null,
        reason: null
      });
    }
    this.save();
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

  summary() {
    const total = this.state.posts.length;
    const archived = this.state.posts.filter(p => p.status === 'ARCHIVED').length;
    const active = this.state.posts.filter(p => p.status === 'ACTIVE').length;
    const queued = this.state.posts.filter(p => p.status === 'QUEUED').length;
    return { total, archived, active, queued };
  }
}
