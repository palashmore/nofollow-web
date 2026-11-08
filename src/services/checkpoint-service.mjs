import { randomUUID } from 'crypto';
import { atomicWriteJson, readJson } from '../utils/file-manager.mjs';
import { STATUS, FINAL } from '../utils/constants.mjs';

const MAX_RUNS = 100;

/** Persistent per-account results + run history. Every change is written atomically at once. */
export class CheckpointService {
  constructor(file) {
    this.file = file;
    const s = readJson(file, null);
    this.state = s && s.accounts ? s : { version: 1, accounts: {}, runs: [] };
  }

  get(u) { return this.state.accounts[u] || null; }
  statusOf(u) { return this.get(u)?.status || STATUS.PENDING; }
  isFinal(u) { return FINAL.has(this.statusOf(u)); }
  save() { atomicWriteJson(this.file, this.state); }

  set(u, patch) {
    const prev = this.state.accounts[u] || { username: u, status: STATUS.PENDING, attempts: 0, lastAttemptAt: null, reason: null };
    const next = { ...prev, ...patch, username: u, updatedAt: new Date().toISOString() };
    this.state.accounts[u] = next;
    this.save();
    return next;
  }

  counts() {
    const c = Object.fromEntries(Object.values(STATUS).map(s => [s, 0]));
    for (const a of Object.values(this.state.accounts)) c[a.status] = (c[a.status] || 0) + 1;
    return c;
  }

  startRun(selected, job = 'unfollow') {
    const run = { runId: randomUUID(), job, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), endedAt: null, status: 'RUNNING', selectedCount: selected.length, counts: {} };
    this.state.runs.unshift(run);
    this.state.runs.length = Math.min(this.state.runs.length, MAX_RUNS);
    this.save();
    return run;
  }

  updateRun(run, patch) { Object.assign(run, patch, { updatedAt: new Date().toISOString() }); this.save(); }

  // Accounts that were left mid-flight by a crash go back to the queue.
  recoverInterrupted() {
    let n = 0;
    for (const a of Object.values(this.state.accounts)) {
      if (a.status === STATUS.IN_PROGRESS) { a.status = STATUS.RETRY_PENDING; a.reason = 'interrupted before finishing'; n++; }
    }
    for (const r of this.state.runs) if (r.status === 'RUNNING') { r.status = 'INTERRUPTED'; r.endedAt = r.updatedAt; }
    if (n || this.state.runs.some(r => r.status === 'INTERRUPTED')) this.save();
    return n;
  }

  /** Import the old done.json list (plain array of usernames). */
  importDone(list) {
    let n = 0;
    for (const u of list) if (!this.state.accounts[u]) { this.state.accounts[u] = { username: u, status: STATUS.UNFOLLOWED, attempts: 1, lastAttemptAt: null, reason: 'imported from done.json', updatedAt: new Date().toISOString() }; n++; }
    if (n) this.save();
    return n;
  }

  /** Clear account results (run history is kept). A backup copy is written first. */
  reset() {
    this.save();
    atomicWriteJson(`${this.file}.before-reset`, this.state);
    this.state.accounts = {};
    this.save();
  }
}
