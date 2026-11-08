import { EventEmitter } from 'events';
import { STATUS, REL, FINAL, ENGINE, TRANSITIONS, ACTIVE_STATES, RESUMABLE } from '../utils/constants.mjs';
import { retry, isBrowserClosed } from './retry-manager.mjs';
import { SafetyMonitor } from './safety-monitor.mjs';
import { classifyError, ERR, REVIEW_CODES } from './errors.mjs';
import { SESSION } from './session-detector.mjs';

const E = ENGINE;
const sleepUntil = (ms, cancelled) => new Promise(res => {
  const end = Number.isFinite(ms) ? Date.now() + ms : Infinity;
  const t = setInterval(() => { if (cancelled() || Date.now() >= end) { clearInterval(t); res(); } }, 200);
});

/** What each kind of job does with each relationship state. */
export const JOBS = {
  unfollow: {
    name: 'unfollow', verb: 'Unfollowing', act: REL.FOLLOWING, done: STATUS.UNFOLLOWED, already: STATUS.ALREADY_UNFOLLOWED,
    alreadyMsg: 'You were not following this account', doneMsg: 'Unfollowed and verified.',
    other: { [REL.REQUESTED]: [STATUS.SKIPPED, 'Only a follow request is pending (not an active follow); left alone.'] },
    perform: (ig, o) => ig.unfollow(o),
  },
  cancel: {
    name: 'cancel', verb: 'Cancelling request for', act: REL.REQUESTED, done: STATUS.CANCELLED, already: STATUS.ALREADY_CANCELLED,
    alreadyMsg: 'No request is pending any more', doneMsg: 'Follow request cancelled and verified.',
    other: { [REL.FOLLOWING]: [STATUS.ACCEPTED, 'The request was accepted: you follow this account now. Nothing was cancelled.'] },
    perform: (ig, o) => ig.cancelRequest(o),
  },
};
const COUNTER = { UNFOLLOWED: 'unfollowed', CANCELLED: 'unfollowed', ALREADY_UNFOLLOWED: 'alreadyUnfollowed', ALREADY_CANCELLED: 'alreadyUnfollowed', ACCEPTED: 'accepted', SKIPPED: 'skipped', PROFILE_UNAVAILABLE: 'unavailable', NEEDS_REVIEW: 'needsReview', FAILED: 'failed' };

/**
 * ONE sequential action worker over the selected accounts, driven by a validated state machine
 * (IDLE > STARTING > CHECKING_SESSION > RUNNING > PAUSED | LOGIN_REQUIRED | RECOVERING | SAFETY_PAUSED > ... > COMPLETED | FAILED).
 * `ig` is any object with: verifySession?, loggedIn, inspect(u, opts), unfollow(opts) / cancelRequest(opts), screenshot?
 *
 * Rules enforced here:
 *  - leaving a paused state to RUNNING always goes through CHECKING_SESSION and needs a verified login;
 *  - a held account is re-checked against the checkpoint and the live page before anything is clicked;
 *  - Instagram safety messages pause the run and are never retried automatically;
 *  - one bad profile never ends the batch.
 */
export class AutomationController extends EventEmitter {
  constructor({ ig, checkpoint, logger, getSettings, job = 'unfollow' }) {
    super();
    Object.assign(this, { ig, checkpoint, logger, getSettings });
    this.job = JOBS[job];
    this.status = E.IDLE; this.pauseReason = null; this.run = null;
    this.stats = this.#blank(); this.stopFlag = false; this.pauseFlag = false; this.resuming = false;
  }

  #blank() {
    return { selected: 0, processed: 0, unfollowed: 0, alreadyUnfollowed: 0, accepted: 0, skipped: 0, unavailable: 0, failed: 0, needsReview: 0, current: null, operation: null, lastSuccess: null };
  }

  get active() { return ACTIVE_STATES.has(this.status); }

  snapshot() {
    const s = this.stats, cfg = this.getSettings();
    return {
      job: this.job.name, status: this.status, pauseReason: this.pauseReason, runId: this.run?.runId || null, ...s,
      remaining: Math.max(0, s.selected - s.processed),
      profile: cfg.executionProfile, intervalSec: cfg.actionIntervalSec, navigationTimeoutSec: cfg.navigationTimeoutSec, elementTimeoutSec: cfg.elementTimeoutSec, maxAttempts: cfg.maxAttempts,
    };
  }

  #emit() { this.emit('state', this.snapshot()); }
  /** The only place the state changes. Throws on a transition that is not in the table. */
  #to(next, reason = null) {
    if (this.status !== next && !TRANSITIONS[this.status]?.includes(next)) throw new Error(`Invalid engine transition ${this.status} -> ${next}`);
    this.status = next; this.pauseReason = reason; this.#emit();
  }
  #op(op, current = this.stats.current) { this.stats.operation = op; this.stats.current = current; this.#emit(); }
  #opts(s) { return { navTimeout: s.navigationTimeoutSec * 1000, elementTimeout: s.elementTimeoutSec * 1000 }; }

  /** Accounts a run works on: not final. FAILED / NEEDS_REVIEW wait for an explicit retry. */
  eligible(usernames, { includeRetry = false } = {}) {
    return usernames.filter(u => {
      const st = this.checkpoint.statusOf(u);
      if (FINAL.has(st)) return false;
      return includeRetry || (st !== STATUS.FAILED && st !== STATUS.NEEDS_REVIEW);
    });
  }

  async start(usernames, { includeRetry = false } = {}) {
    if (this.active) throw new Error(`A run is already ${this.status.toLowerCase().replace('_', ' ')}.`);
    const settings = this.getSettings();
    const queue = this.eligible([...new Set(usernames)], { includeRetry }).slice(0, settings.maxPerRun);
    if (!queue.length) throw new Error('Nothing to do: every selected account already has a final result.');
    this.stopFlag = false; this.pauseFlag = false;
    this.stats = { ...this.#blank(), selected: queue.length };
    this.run = this.checkpoint.startRun(queue, this.job.name);
    this.monitor = new SafetyMonitor(settings.errorThreshold);
    this.#to(E.STARTING);
    this.logger.info(`Run started (${this.job.name}): ${queue.length} accounts (${usernames.length - queue.length} selected were already final or waiting for retry). Interval ${settings.actionIntervalSec} s.`, { runId: this.run.runId });
    this.#run(queue);
    return this.snapshot();
  }

  pause() { if (this.status === E.RUNNING) { this.pauseFlag = true; this.logger.info('Pause requested; finishing the current account first.'); } }

  /** Resume never trusts the button: it re-verifies the Instagram session first. */
  async resume() {
    if (this.status === E.RUNNING && this.pauseFlag) { this.pauseFlag = false; this.logger.info('Pause cancelled.'); return this.snapshot(); }
    if (!RESUMABLE.has(this.status) || this.resuming) return this.snapshot();
    this.resuming = true;
    try {
      this.#to(E.CHECKING_SESSION, 'Verifying the Instagram session…');
      await this.#validateSession();
    } catch (e) {
      this.logger.critical(`Resume failed: ${e.message}`, { error: e.message });
    } finally { this.resuming = false; }
    return this.snapshot();
  }

  stop() {
    if (!this.active) return;
    this.stopFlag = true; this.pauseFlag = false;
    if (this.status !== E.RUNNING && this.status !== E.STOPPING) this.#to(E.STOPPING, 'Stopping…');
    this.logger.info('Stop requested.');
  }

  /** CHECKING_SESSION -> RUNNING only when the session is verified; otherwise the matching waiting state with the reason. */
  async #validateSession() {
    const s = this.getSettings();
    let v;
    try {
      v = this.ig.verifySession ? await this.ig.verifySession(this.#opts(s)) : { state: (await this.ig.loggedIn()) ? SESSION.AUTHENTICATED : SESSION.LOGIN_REQUIRED };
    } catch (e) {
      if (this.stopFlag) return false;
      if (e.code === 'BROWSER_LAUNCH' || isBrowserClosed(e)) { this.logger.error(e.message, { runId: this.run?.runId, errorCategory: classifyError(e) }); this.#to(E.RECOVERING, e.code === 'BROWSER_LAUNCH' ? e.message : 'The browser window was closed. Press Resume to reopen it and verify the login.'); return false; }
      throw e;
    }
    if (this.stopFlag) return false;
    switch (v.state) {
      case SESSION.AUTHENTICATED:
        this.monitor?.ok(); this.#to(E.RUNNING);
        this.logger.info(`Instagram session verified${v.account ? ` (account @${v.account})` : ''}.`, { runId: this.run?.runId });
        return true;
      case SESSION.SECURITY: this.logger.critical(v.reason, { runId: this.run?.runId, errorCategory: ERR.INSTAGRAM_SECURITY_WARNING }); this.#to(E.SAFETY_PAUSED, v.reason); return false;
      case SESSION.DISCONNECTED: this.#to(E.RECOVERING, v.reason || 'The browser connection was lost. Press Resume to reconnect.'); return false;
      default: {
        const why = `${v.reason || 'Instagram login required.'} Log in in the browser window, then press Resume.`;
        this.logger.warn(why, { runId: this.run?.runId, errorCategory: ERR.LOGIN_REQUIRED });
        this.#to(E.LOGIN_REQUIRED, why); return false;
      }
    }
  }

  async #waitUntilRunning() { while (this.status !== E.RUNNING && !this.stopFlag) await sleepUntil(300, () => this.status === E.RUNNING || this.stopFlag); }

  async #run(queue) {
    let crashed = false;
    try {
      this.#to(E.CHECKING_SESSION, 'Verifying the Instagram session…');
      await this.#validateSession();
      await this.#loop(queue);
    } catch (e) {
      crashed = true;
      this.logger.critical(`Engine stopped: ${e.message}`, { runId: this.run?.runId, error: e.message });
    } finally {
      this.#finish(crashed ? 'CRASHED' : this.stopFlag ? 'STOPPED' : 'COMPLETED', queue);
    }
  }

  async #loop(queue) {
    for (let i = 0; i < queue.length && !this.stopFlag;) {
      if (this.status !== E.RUNNING) { await this.#waitUntilRunning(); continue; }
      if (this.pauseFlag) { this.pauseFlag = false; this.#to(E.PAUSED, 'Paused by user'); continue; }
      const u = queue[i];
      if (this.checkpoint.isFinal(u)) { this.stats.processed++; i++; this.#emit(); continue; }   // finished meanwhile (earlier run / restart)
      const outcome = await this.#process(u, this.getSettings());                                 // 'done' | 'paused'
      if (outcome === 'paused') continue;                                                         // same account again after a verified resume
      this.stats.processed++; i++; this.#emit();
      if (this.stopFlag || i >= queue.length) break;
      if (this.status === E.RUNNING) {
        this.#op('Waiting before next account', null);
        const t0 = Date.now();   // fixed interval, re-read every tick so a settings change applies to the wait in progress
        await sleepUntil(Infinity, () => this.stopFlag || this.pauseFlag || Date.now() - t0 >= this.getSettings().actionIntervalSec * 1000);
      }
    }
  }

  #finish(kind, queue) {
    const left = queue.filter(u => !FINAL.has(this.checkpoint.statusOf(u)) && ![STATUS.FAILED, STATUS.NEEDS_REVIEW].includes(this.checkpoint.statusOf(u))).length;
    this.checkpoint.updateRun(this.run, { status: kind === 'COMPLETED' && left ? 'INCOMPLETE' : kind, endedAt: new Date().toISOString(), counts: { ...this.stats } });
    const c = this.stats;
    this.logger.info(`Run ${kind.toLowerCase()}: ${c.unfollowed} done, ${c.alreadyUnfollowed} already done, ${c.accepted} accepted, ${c.unavailable} unavailable, ${c.skipped} skipped, ${c.needsReview} need review, ${c.failed} failed, ${left} left.`, { runId: this.run.runId });
    this.stats.current = null; this.stats.operation = null;
    this.stopFlag = false; this.pauseFlag = false;
    if (kind === 'STOPPED') { if (this.status !== E.STOPPING) this.#to(E.STOPPING); this.#to(E.IDLE); }
    else if (kind === 'CRASHED') this.#to(E.FAILED, 'The engine stopped because of an internal error. See the log.');
    else this.#to(E.COMPLETED);
  }

  #record(u, status, reason, extra = {}) {
    const a = this.checkpoint.get(u);
    const k = COUNTER[status]; if (k) this.stats[k]++;
    this.checkpoint.set(u, { status, reason: reason ?? null, result: status, lastAttemptAt: new Date().toISOString(), previousStatus: a?.previousStatus ?? STATUS.PENDING, errorCode: null, ...extra });
    this.emit('account', { username: u, status, reason, attempts: a?.attempts });
  }

  #log(level, u, status, message, extra = {}) {
    this.logger.log(level, message, { runId: this.run?.runId, username: u, status, attempt: this.checkpoint.get(u)?.attempts, ...extra });
  }

  #safetyPause(u, reason) {
    this.checkpoint.set(u, { status: STATUS.ACTION_BLOCKED, reason, lastAttemptAt: new Date().toISOString() });   // not final: queued again by the next run
    this.logger.critical(`${reason}. Run paused for safety; nothing was retried. Resume only after Instagram allows activity again.`, { runId: this.run?.runId, username: u, status: STATUS.ACTION_BLOCKED, errorCategory: ERR.INSTAGRAM_SECURITY_WARNING });
    this.#to(E.SAFETY_PAUSED, reason);
  }

  #needLogin(u) {
    this.checkpoint.set(u, { status: STATUS.PAUSED, reason: 'login required' });
    const why = 'Instagram login required. Log in in the browser window, then press Resume.';
    this.logger.warn(why, { runId: this.run?.runId, username: u, status: STATUS.PAUSED, errorCategory: ERR.LOGIN_REQUIRED });
    this.#to(E.LOGIN_REQUIRED, why);
    return 'paused';
  }

  #recover(u, e) {
    const reason = e.code === 'BROWSER_LAUNCH' ? e.message : 'The browser window was closed. Press Resume to reopen it and verify the login.';
    this.checkpoint.set(u, { status: STATUS.PAUSED, reason: e.code === 'BROWSER_LAUNCH' ? 'browser could not start' : 'browser was closed' });
    this.logger.warn(reason, { runId: this.run?.runId, username: u, status: STATUS.PAUSED, errorCategory: classifyError(e) });
    this.#to(E.RECOVERING, reason);
    return 'paused';
  }

  async #process(u, s) {
    const prev = this.checkpoint.get(u);
    this.checkpoint.set(u, { status: STATUS.IN_PROGRESS, previousStatus: prev && prev.status !== STATUS.IN_PROGRESS ? prev.status : (prev?.previousStatus ?? STATUS.PENDING), attempts: (prev?.attempts || 0) + 1, lastAttemptAt: new Date().toISOString() });
    this.#op('Opening profile', u);
    try {
      if (!(await this.ig.loggedIn())) return this.#needLogin(u);
      const insp = await retry(() => this.ig.inspect(u, this.#opts(s)), {
        attempts: s.maxAttempts, shouldRetry: e => ![ERR.SESSION_DISCONNECTED, 'BROWSER_LAUNCH'].includes(classifyError(e)),
        onRetry: (e, n) => this.#log('WARNING', u, STATUS.RETRY_PENDING, `${classifyError(e)}: ${e.message.split('\n')[0]}; retry ${n}.`, { errorCategory: classifyError(e) }),
      });
      const result = await this.#decide(u, insp, s);
      if (result === 'done') this.monitor.ok();
      return result;
    } catch (e) { return this.#error(u, e, s); }
  }

  async #decide(u, insp, s) {
    const J = this.job, { state } = insp;
    const info = insp.followsYou ? ' (note: this account follows you)' : '';
    switch (state) {
      case REL.UNAVAILABLE:
        this.#record(u, STATUS.PROFILE_UNAVAILABLE, 'Profile not available (deleted, renamed or suspended)');
        this.#log('WARNING', u, STATUS.PROFILE_UNAVAILABLE, 'Profile unavailable. Will not be revisited.', { previousState: state, errorCategory: ERR.PROFILE_UNAVAILABLE });
        return 'done';
      case REL.NOT_FOLLOWING:
        this.#record(u, J.already, J.alreadyMsg);
        this.#log('INFO', u, J.already, `${J.alreadyMsg}. No action required.${info}`, { previousState: state });
        return 'done';
      case REL.LOGIN_REQUIRED: return this.#needLogin(u);
      case REL.ACTION_BLOCKED: this.#safetyPause(u, 'Instagram showed an action-block / try-again-later message'); return 'paused';
      case REL.CAPTCHA: this.#safetyPause(u, 'Instagram asked for a security check / CAPTCHA'); return 'paused';
      case J.act: return this.#perform(u, s, info);
      default:
        if (J.other[state]) { const [st, msg] = J.other[state]; this.#record(u, st, msg); this.#log('INFO', u, st, msg, { previousState: state }); return 'done'; }
        return this.#review(u, 'Could not identify the relationship state on the page', ERR.RELATIONSHIP_AMBIGUOUS, state);
    }
  }

  async #review(u, reason, code, state) {
    const shot = await this.ig.screenshot?.(`review-${u}`);
    this.#record(u, STATUS.NEEDS_REVIEW, reason, { screenshot: shot, errorCode: code });
    this.#log('WARNING', u, STATUS.NEEDS_REVIEW, `${reason}; no further click was made. Needs manual review.`, { previousState: state, errorCategory: code });
    this.monitor.ok();
    return 'done';
  }

  async #perform(u, s, info) {
    const J = this.job;
    this.#op(`${J.verb} @${u}`, u);
    let after = { state: J.act };
    for (let t = 1; t <= s.maxAttempts; t++) {
      try { after = await J.perform(this.ig, this.#opts(s)); }
      catch (e) {
        const code = classifyError(e);
        if (REVIEW_CODES.has(code)) return this.#review(u, `${code}: ${e.message.split('\n')[0]}`, code, J.act);
        throw e;
      }
      if (![REL.FOLLOWING, REL.REQUESTED, REL.AMBIGUOUS, REL.LOADING].includes(after.state)) break;
      if (t < s.maxAttempts) {
        this.#log('WARNING', u, STATUS.RETRY_PENDING, `Not confirmed (state ${after.state}); re-checking the page.`);
        const again = await this.ig.inspect(u, this.#opts(s));
        if (again.state !== J.act) { after = again; break; }
      }
    }
    switch (after.state) {
      case REL.NOT_FOLLOWING:   // verified from the page, not assumed
        this.stats.lastSuccess = u; this.#record(u, J.done, null);
        this.#log('SUCCESS', u, J.done, `${J.doneMsg}${info}`, { previousState: J.act, newState: after.state });
        return 'done';
      case REL.ACTION_BLOCKED: this.#safetyPause(u, 'Instagram blocked the action'); return 'paused';
      case REL.CAPTCHA: this.#safetyPause(u, 'Instagram asked for a security check / CAPTCHA'); return 'paused';
      case REL.LOGIN_REQUIRED: return this.#needLogin(u);
      default: return this.#fail(u, `The action was not confirmed (page state: ${after.state})`, 'UNVERIFIED', s);
    }
  }

  async #error(u, e, s) {
    const code = classifyError(e);
    if (code === 'BROWSER_LAUNCH' || code === ERR.SESSION_DISCONNECTED) return this.#recover(u, e);
    if (code === ERR.LOGIN_REQUIRED) return this.#needLogin(u);
    if (REVIEW_CODES.has(code)) return this.#review(u, `${code}: ${e.message.split('\n')[0]}`, code, 'UNKNOWN');
    return this.#fail(u, e.message.split('\n')[0], code, s);
  }

  async #fail(u, reason, category, s) {
    const shot = await this.ig.screenshot?.(`fail-${u}`);
    this.#record(u, STATUS.FAILED, reason, { screenshot: shot, errorCode: category });
    this.#log('ERROR', u, STATUS.FAILED, `Failed: ${reason}`, { errorCategory: category, error: reason });
    if (this.monitor.failure()) {
      this.logger.critical(`${s.errorThreshold} accounts failed in a row. Pausing: check the browser window and the log before resuming.`, { runId: this.run?.runId });
      this.#to(E.SAFETY_PAUSED, `${s.errorThreshold} consecutive failures`);
    }
    return 'done';
  }
}
