import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { ensureDir } from '../utils/file-manager.mjs';

const LEVELS = ['INFO', 'SUCCESS', 'WARNING', 'ERROR', 'CRITICAL'];
// Never let credentials reach a log file
const scrub = s => String(s ?? '').replace(/(sessionid|csrftoken|ds_user_id|password|token)=?[^\s;,"']*/gi, '$1=[redacted]');

export class Logger extends EventEmitter {
  constructor(dir) {
    super();
    ensureDir(dir);
    this.txt = path.join(dir, 'unfollow.log');
    this.jsonl = path.join(dir, 'unfollow.jsonl');
    this.recent = [];
  }

  log(level, message, extra = {}) {
    if (!LEVELS.includes(level)) level = 'INFO';
    const entry = { timestamp: new Date().toISOString(), level, ...extra, message: scrub(message) };
    if (entry.error) entry.error = scrub(entry.error);
    try {
      fs.appendFileSync(this.jsonl, JSON.stringify(entry) + '\n');
      fs.appendFileSync(this.txt, `${entry.timestamp} [${level}] ${entry.username ? entry.username + ': ' : ''}${entry.message}\n`);
    } catch { /* logging must never crash a run */ }
    this.recent.push(entry);
    if (this.recent.length > 500) this.recent.shift();
    this.emit('log', entry);
    return entry;
  }
  info(m, x) { return this.log('INFO', m, x); }
  success(m, x) { return this.log('SUCCESS', m, x); }
  warn(m, x) { return this.log('WARNING', m, x); }
  error(m, x) { return this.log('ERROR', m, x); }
  critical(m, x) { return this.log('CRITICAL', m, x); }

  /** Entries that need attention, for the exportable error report. */
  errorReport(limit = 5000) {
    try {
      return fs.readFileSync(this.jsonl, 'utf8').trim().split('\n').slice(-20000)
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(e => e && ['WARNING', 'ERROR', 'CRITICAL'].includes(e.level)).slice(-limit);
    } catch { return []; }
  }
}
