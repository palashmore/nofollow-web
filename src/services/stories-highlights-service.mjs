import path from 'path';
import { readJson, atomicWriteJson } from '../utils/file-manager.mjs';

/**
 * Stories & Highlights Manager service.
 * Tracks story activities, archived stories, and highlight collections.
 */
export class StoriesHighlightsService {
  constructor(dataFile) {
    this.dataFile = dataFile;
    this.state = this.load();
  }

  load() {
    const s = readJson(this.dataFile, null);
    if (s && s.highlights) return s;
    return {
      version: 1,
      lastSyncedAt: null,
      stories: [],
      highlights: []
    };
  }

  save() {
    atomicWriteJson(this.dataFile, this.state);
  }

  getStories({ page = 1, size = 50 } = {}) {
    const total = this.state.stories.length;
    return {
      total,
      page,
      size,
      stories: this.state.stories.slice((page - 1) * size, page * size)
    };
  }

  getHighlights() {
    return this.state.highlights;
  }

  addHighlight(hl) {
    const existing = this.state.highlights.find(h => h.id === hl.id);
    if (existing) {
      Object.assign(existing, hl, { updatedAt: new Date().toISOString() });
    } else {
      this.state.highlights.push({
        id: hl.id || `hl_${Date.now()}`,
        title: hl.title || 'Untitled Highlight',
        coverUrl: hl.coverUrl || null,
        itemCount: hl.itemCount || 0,
        createdAt: hl.createdAt || new Date().toISOString()
      });
    }
    this.save();
  }

  summary() {
    return {
      totalStories: this.state.stories.length,
      totalHighlights: this.state.highlights.length,
      lastSyncedAt: this.state.lastSyncedAt
    };
  }
}
