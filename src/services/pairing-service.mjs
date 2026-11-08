import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { readJson, atomicWriteJson } from '../utils/file-manager.mjs';

const PIN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Service managing pairing tokens, PIN verification, and revocable sessions
 * for secure local-agent cross-origin access from Vercel.
 */
export class PairingService {
  constructor(dataFile) {
    this.dataFile = dataFile;
    this.state = this.load();
  }

  load() {
    const s = readJson(this.dataFile, null);
    if (s && s.sessions) return s;
    return {
      pairingPin: null,
      pinExpiresAt: null,
      sessions: []
    };
  }

  save() {
    atomicWriteJson(this.dataFile, this.state);
  }

  /**
   * Generates or returns an active 6-character pairing PIN.
   * Example: "NF-7429"
   */
  getOrCreatePin() {
    const now = Date.now();
    if (this.state.pairingPin && this.state.pinExpiresAt && new Date(this.state.pinExpiresAt).getTime() > now) {
      return this.state.pairingPin;
    }
    const num = crypto.randomInt(1000, 9999);
    this.state.pairingPin = `NF-${num}`;
    this.state.pinExpiresAt = new Date(now + PIN_TTL_MS).toISOString();
    this.save();
    return this.state.pairingPin;
  }

  /**
   * Validates a candidate PIN.
   * @param {string} candidate
   * @returns {boolean}
   */
  verifyPin(candidate) {
    if (!candidate || !this.state.pairingPin) return false;
    const now = Date.now();
    if (this.state.pinExpiresAt && new Date(this.state.pinExpiresAt).getTime() <= now) {
      return false;
    }
    const cleanCandidate = String(candidate).trim().toUpperCase();
    const cleanPin = this.state.pairingPin.toUpperCase();
    const matches = cleanCandidate === cleanPin || cleanCandidate === cleanPin.replace('NF-', '');
    if (matches) {
      // Rotate PIN after successful use for security
      this.state.pairingPin = null;
      this.state.pinExpiresAt = null;
      this.save();
    }
    return matches;
  }

  /**
   * Creates a new authenticated session token after successful PIN verification.
   */
  createSession({ origin = '', userAgent = '' } = {}) {
    const token = `nf_sess_${crypto.randomBytes(24).toString('hex')}`;
    const now = new Date();
    const session = {
      token,
      origin: origin || 'direct',
      userAgent: userAgent || 'unknown',
      createdAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString()
    };
    // Keep at most 20 active sessions
    this.state.sessions = [session, ...this.state.sessions.filter(s => new Date(s.expiresAt).getTime() > Date.now())].slice(0, 20);
    this.save();
    return session;
  }

  /**
   * Validates a bearer token.
   * @param {string} token
   * @returns {object|null}
   */
  validateToken(token) {
    if (!token) return null;
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
    const s = this.state.sessions.find(x => x.token === cleanToken);
    if (!s) return null;
    const now = Date.now();
    if (new Date(s.expiresAt).getTime() <= now) {
      this.revokeSession(cleanToken);
      return null;
    }
    s.lastUsedAt = new Date().toISOString();
    this.save();
    return s;
  }

  /**
   * Revokes a specific session.
   */
  revokeSession(token) {
    const clean = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
    const prevLen = this.state.sessions.length;
    this.state.sessions = this.state.sessions.filter(s => s.token !== clean);
    if (this.state.sessions.length !== prevLen) this.save();
    return true;
  }

  /**
   * Revokes all active sessions and resets pairing.
   */
  revokeAll() {
    this.state.sessions = [];
    this.state.pairingPin = null;
    this.state.pinExpiresAt = null;
    this.save();
    return true;
  }

  /**
   * Returns current pairing status.
   */
  getStatus() {
    const now = Date.now();
    const validSessions = this.state.sessions.filter(s => new Date(s.expiresAt).getTime() > now);
    return {
      paired: validSessions.length > 0,
      activeSessions: validSessions.length,
      currentPin: this.getOrCreatePin(),
      pinExpiresAt: this.state.pinExpiresAt
    };
  }
}
