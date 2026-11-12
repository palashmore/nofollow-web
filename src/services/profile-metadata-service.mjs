import path from 'path';
import { readJson, atomicWriteJson, ensureDir } from '../utils/file-manager.mjs';
import { normalizeUsername } from './export-parser.mjs';

/**
 * Persistent Profile Metadata Service.
 * Stores and queries live Instagram profile intelligence:
 * follower counts, verified blue tick status, and VIP tier classifications.
 */
export class ProfileMetadataService {
  constructor(filePath) {
    this.filePath = filePath;
    ensureDir(path.dirname(filePath));
    this.state = this.load();
  }

  load() {
    const raw = readJson(this.filePath, null);
    if (raw && typeof raw.profiles === 'object' && raw.profiles !== null) {
      return {
        profiles: raw.profiles,
        updatedAt: raw.updatedAt || new Date().toISOString()
      };
    }
    return { profiles: {}, updatedAt: new Date().toISOString() };
  }

  save() {
    atomicWriteJson(this.filePath, this.state);
  }

  get(username) {
    const u = normalizeUsername(username);
    return u ? (this.state.profiles[u] || null) : null;
  }

  has(username) {
    const u = normalizeUsername(username);
    return !!(u && this.state.profiles[u]);
  }

  hasScannedStats(username) {
    const u = normalizeUsername(username);
    const p = u ? this.state.profiles[u] : null;
    return !!(p && p.followersCount !== null && p.followersCount !== undefined);
  }

  set(username, { followersCount = null, followersText = null, followingCount = null, followingText = null, authorityRatio = null, isVerified = false, fullName = null, profilePicUrl = null, relationship = null } = {}) {
    const u = normalizeUsername(username);
    if (!u) return;
    const prev = this.state.profiles[u] || {};
    const fCount = followersCount !== null ? followersCount : (prev.followersCount ?? null);
    const gCount = followingCount !== null ? followingCount : (prev.followingCount ?? null);
    const fName = fullName !== null ? fullName : (prev.fullName ?? null);
    const pic = profilePicUrl !== null ? profilePicUrl : (prev.profilePicUrl ?? null);
    let ratio = authorityRatio !== null ? authorityRatio : (prev.authorityRatio ?? null);
    if (ratio === null && fCount !== null && gCount !== null && gCount > 0) {
      ratio = Math.round((fCount / gCount) * 10) / 10;
    }
    const cleanRel = (relationship && relationship !== 'LOADING' && relationship !== 'AMBIGUOUS')
      ? (relationship === 'FOLLOWING' ? 'Following' : relationship === 'NOT_FOLLOWING' ? 'Not following' : relationship === 'REQUESTED' ? 'Request pending' : relationship)
      : (prev.relationship && prev.relationship !== 'LOADING' && prev.relationship !== 'AMBIGUOUS' ? prev.relationship : null);

    this.state.profiles[u] = {
      username: u,
      fullName: fName,
      profilePicUrl: pic,
      followersCount: fCount,
      followersText: followersText || prev.followersText || (fCount ? String(fCount) : null),
      followingCount: gCount,
      followingText: followingText || prev.followingText || (gCount ? String(gCount) : null),
      authorityRatio: ratio,
      isVerified: typeof isVerified === 'boolean' ? isVerified : (prev.isVerified ?? false),
      relationship: cleanRel,
      scannedAt: new Date().toISOString()
    };
    this.state.updatedAt = new Date().toISOString();
    this.save();
    return this.state.profiles[u];
  }

  all() {
    return Object.values(this.state.profiles);
  }

  query({ verified = false, minFollowers = 0, minRatio = 0, q = '', sort = 'followers', dir = 'desc' } = {}) {
    let list = Object.values(this.state.profiles);
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter(p => p.username.includes(needle));
    }
    if (verified) {
      list = list.filter(p => p.isVerified);
    }
    if (minFollowers > 0) {
      list = list.filter(p => (p.followersCount || 0) >= minFollowers);
    }
    if (minRatio > 0) {
      list = list.filter(p => (p.authorityRatio || 0) >= minRatio);
    }
    const mul = dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (sort === 'ratio') {
        return mul * ((a.authorityRatio || 0) - (b.authorityRatio || 0));
      }
      if (sort === 'followers') {
        return mul * ((a.followersCount || 0) - (b.followersCount || 0));
      }
      return mul * String(a.username || '').localeCompare(String(b.username || ''));
    });
    return list;
  }

  summary() {
    const all = Object.values(this.state.profiles);
    let verifiedCount = 0;
    let above10k = 0;
    let above50k = 0;
    let highAuthorityCount = 0;
    let statsScannedCount = 0;
    for (const p of all) {
      if (p.followersCount !== null && p.followersCount !== undefined) statsScannedCount++;
      if (p.isVerified) verifiedCount++;
      const c = p.followersCount || 0;
      if (c >= 10000) above10k++;
      if (c >= 50000) above50k++;
      if ((p.authorityRatio || 0) >= 10) highAuthorityCount++;
    }
    return {
      totalScanned: all.length,
      statsScannedCount,
      verifiedCount,
      above10k,
      above50k,
      highAuthorityCount
    };
  }
}
