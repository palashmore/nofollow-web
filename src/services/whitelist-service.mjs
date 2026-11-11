import path from 'path';
import { readJson, atomicWriteJson, ensureDir } from '../utils/file-manager.mjs';
import { normalizeUsername } from './export-parser.mjs';

/**
 * Persistent Whitelist Service.
 * Protects specified Instagram accounts from ever being unfollowed or cancelled.
 */
export class WhitelistService {
  constructor(filePath) {
    this.filePath = filePath;
    ensureDir(path.dirname(filePath));
    this.state = this.load();
  }

  load() {
    const raw = readJson(this.filePath, null);
    if (raw && Array.isArray(raw.accounts)) {
      return {
        accounts: Array.from(new Set(raw.accounts.map(normalizeUsername).filter(Boolean))),
        updatedAt: raw.updatedAt || new Date().toISOString()
      };
    }
    return { accounts: [], updatedAt: new Date().toISOString() };
  }

  save() {
    atomicWriteJson(this.filePath, this.state);
  }

  list() {
    return [...this.state.accounts];
  }

  has(username) {
    const u = normalizeUsername(username);
    return u ? this.state.accounts.includes(u) : false;
  }

  add(username) {
    const u = normalizeUsername(username);
    if (!u) throw new Error('Invalid username');
    if (!this.state.accounts.includes(u)) {
      this.state.accounts.push(u);
      this.state.updatedAt = new Date().toISOString();
      this.save();
    }
    return { ok: true, added: u, total: this.state.accounts.length };
  }

  remove(username) {
    const u = normalizeUsername(username);
    if (!u) throw new Error('Invalid username');
    const idx = this.state.accounts.indexOf(u);
    if (idx !== -1) {
      this.state.accounts.splice(idx, 1);
      this.state.updatedAt = new Date().toISOString();
      this.save();
    }
    return { ok: true, removed: u, total: this.state.accounts.length };
  }

  toggle(username) {
    return this.has(username) ? this.remove(username) : this.add(username);
  }

  removeMany(usernames) {
    let removedCount = 0;
    for (const raw of usernames) {
      const u = normalizeUsername(raw);
      if (u) {
        const idx = this.state.accounts.indexOf(u);
        if (idx !== -1) {
          this.state.accounts.splice(idx, 1);
          removedCount++;
        }
      }
    }
    if (removedCount > 0) {
      this.state.updatedAt = new Date().toISOString();
      this.save();
    }
    return { ok: true, removedCount, total: this.state.accounts.length };
  }

  addMany(usernames) {
    let addedCount = 0;
    for (const raw of usernames) {
      const u = normalizeUsername(raw);
      if (u && !this.state.accounts.includes(u)) {
        this.state.accounts.push(u);
        addedCount++;
      }
    }
    if (addedCount > 0) {
      this.state.updatedAt = new Date().toISOString();
      this.save();
    }
    return { ok: true, addedCount, total: this.state.accounts.length };
  }

  clear() {
    this.state.accounts = [];
    this.state.updatedAt = new Date().toISOString();
    this.save();
    return { ok: true, total: 0 };
  }
}
