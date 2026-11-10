import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright-core';
import { ensureDir } from '../utils/file-manager.mjs';
import { PATHS, REL } from '../utils/constants.mjs';
import { isAlive } from '../utils/instance-lock.mjs';
import { openProfile } from './profile-navigator.mjs';
import { unfollow, cancelRequest } from './action-executor.mjs';
import { waitForState } from './relationship-detector.mjs';
import { BrowserTabManager } from './browser-tab-manager.mjs';
import { classifySession, takeSessionSnapshot, SESSION } from './session-detector.mjs';
import { isBrowserClosed } from './retry-manager.mjs';

const NOT_INSTALLED = /executable doesn'?t exist|is not found|distribution|ENOENT|cannot find/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class BrowserLaunchError extends Error {
  constructor(message) { super(message); this.name = 'BrowserLaunchError'; this.code = 'BROWSER_LAUNCH'; }
}

/**
 * Owns the one persistent, user-authenticated browser (credentials live only in the profile folder; this class never
 * reads, stores or logs them). It validates the browser before every operation, reopens it after it was closed
 * (same profile, so the login survives), and only reports Instagram as logged in after verifySession() has seen the
 * logged-in page. It never silently replaces the session: if the login is gone, the run pauses and asks the user.
 */
export class BrowserSessionManager {
  constructor({ logger, channel = 'chrome', profileDir = PATHS.profile, lockFile = path.join(PATHS.data, '.browser.lock'), stateTimeout = 15000 }) {
    Object.assign(this, { logger, channel, profileDir, lockFile, stateTimeout });
    this.ctx = null; this.launching = null;
    this.tabs = new BrowserTabManager(logger);
    this.sessionInfo = { state: 'UNVERIFIED', account: null, reason: null, verifiedAt: null };
  }

  get open() { return !!this.ctx && this.tabs.count > 0; }

  #setSession(state, extra = {}) {
    this.sessionInfo = { state, account: extra.account || null, reason: extra.reason || null, verifiedAt: state === SESSION.AUTHENTICATED ? new Date().toISOString() : this.sessionInfo.verifiedAt };
    return { state, account: this.sessionInfo.account, reason: this.sessionInfo.reason };
  }

  /** Make sure a live browser exists (reopens the same profile if it was closed). Never uses another profile for Chrome. */
  async ensureBrowser() {
    if (this.open) return;
    if (this.ctx) { this.ctx = null; }   // context object survived but all its tabs are gone
    if (this.launching) return this.launching;
    this.launching = this.#launch().finally(() => { this.launching = null; });
    return this.launching;
  }

  #lockHolder() {
    try { const pid = Number(fs.readFileSync(this.lockFile, 'utf8')); return pid && pid !== process.pid && isAlive(pid) ? pid : null; } catch { return null; }
  }

  async #launch() {
    ensureDir(path.dirname(this.lockFile));
    const holder = this.#lockHolder();
    if (holder) throw new BrowserLaunchError(`Another NoFollow Web process (pid ${holder}) already uses this browser profile. Close it first.`);
    fs.writeFileSync(this.lockFile, String(process.pid));
    const opts = {
      headless: !!process.env.NF_HEADLESS,
      viewport: null,
      args: ['--start-maximized', '--window-size=1280,900']
    };   // NF_HEADLESS is for automated tests only
    const launch = (dir, channel) => chromium.launchPersistentContext(dir, channel ? { ...opts, channel } : opts);
    try {
      this.ctx = await launch(this.profileDir, this.channel);
    } catch (e) {
      if (this.channel && NOT_INSTALLED.test(e.message)) {
        // Playwright Chromium gets its OWN profile folder so the Chrome profile is never touched; the user logs in once there.
        this.logger.warn(`${this.channel} is not installed. Using Playwright Chromium with a separate profile; you will need to log in again.`);
        this.ctx = await launch(`${this.profileDir}-chromium`, '');
      } else if (/closed|SingletonLock|already (running|in use)/i.test(e.message)) {
        throw new BrowserLaunchError('The browser profile is already open in another window (often a browser left over from an earlier run). Close every Chrome window opened by NoFollow Web (or end them in Task Manager), then press Resume.');
      } else throw new BrowserLaunchError(`Could not start the browser: ${e.message.split('\n')[0]}`);
    }
    this.ctx.on('close', () => { this.ctx = null; this.tabs.tabs.clear(); this.#setSession('UNVERIFIED', { reason: 'Browser was closed.' }); this.logger.warn('The browser window was closed.'); });
    this.tabs.attach(this.ctx);
    this.#setSession('UNVERIFIED', { reason: 'Browser (re)opened: login not verified yet.' });
    this.logger.info('Browser opened.');
  }

  /** Quick, side-effect free cookie check. Display code must use sessionInfo, which is only set by verifySession(). */
  async loggedIn() {
    if (!this.ctx) return false;
    try {
      const cookies = await this.ctx.cookies();
      return cookies.some(c => (c.domain.includes('instagram.com') || c.domain === '.instagram.com') && (c.name === 'sessionid' || c.name === 'ds_user_id'));
    } catch { return false; }
  }

  /** Full check: loads the Instagram home page in the action tab and classifies what is really shown. */
  async verifySession({ navTimeout = 30000, elementTimeout = 15000 } = {}) {
    await this.ensureBrowser();
    try {
      const page = await this.tabs.action();
      await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: navTimeout });
      const end = Date.now() + elementTimeout;
      let r = { state: SESSION.UNKNOWN };
      while (Date.now() < end) {
        const hasCookie = await this.loggedIn();
        r = classifySession({ ...(await takeSessionSnapshot(page)), hasCookie });
        if (r.state !== SESSION.UNKNOWN) break;
        await sleep(400);
      }
      return this.#setSession(r.state, r);
    } catch (e) {
      if (isBrowserClosed(e)) return this.#setSession(SESSION.DISCONNECTED, { reason: 'The browser connection was lost.' });
      if (/goto|Timeout|net::/i.test(e.message)) return this.#setSession(SESSION.UNKNOWN, { reason: `Instagram did not load: ${e.message.split('\n')[0]}` });
      throw e;
    }
  }

  async health() {
    return { open: this.open, browser: this.open ? 'connected' : 'closed', tabs: this.open ? this.tabs.list() : [], session: { ...this.sessionInfo }, profileLockedBy: this.#lockHolder() };
  }

  async inspect(username, opts = {}) {
    await this.ensureBrowser();
    const page = await this.tabs.action();
    const stateTimeout = opts.elementTimeout ?? this.stateTimeout;
    const r = await openProfile(page, username, { timeout: opts.navTimeout ?? 30000, stateTimeout });
    let out = r;
    if (r.state === REL.AMBIGUOUS) {          // re-evaluate once with a fresh load before giving up
      await page.reload({ waitUntil: 'domcontentloaded', timeout: opts.navTimeout ?? 30000 });
      out = await waitForState(page, { timeout: stateTimeout });
    }
    if (out.state === REL.LOGIN_REQUIRED) this.#setSession(SESSION.LOGIN_REQUIRED, { reason: 'Instagram asked for login while opening a profile.' });
    return out;
  }

  async unfollow(opts = {}) { await this.ensureBrowser(); return unfollow(await this.tabs.action(), opts); }
  async cancelRequest(opts = {}) { await this.ensureBrowser(); return cancelRequest(await this.tabs.action(), opts); }

  async screenshot(name) {
    try {
      ensureDir(PATHS.shots);
      const file = path.join(PATHS.shots, `${name.replace(/[^\w.-]/g, '_')}-${Date.now()}.png`);
      await (await this.tabs.action()).screenshot({ path: file });
      return path.relative(PATHS.logs, file).replace(/\\/g, '/');
    } catch { return null; }
  }

  async openManualTab(url) { await this.ensureBrowser(); return this.tabs.openManual(url); }

  async openLogin() {
    await this.ensureBrowser();
    const p = await this.tabs.action();
    if (!/instagram\.com/.test(p.url())) await p.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
    await p.bringToFront();
  }

  async close() {
    try { await this.ctx?.close(); } catch { /* already gone */ }
    this.ctx = null;
    try { if (Number(fs.readFileSync(this.lockFile, 'utf8')) === process.pid) fs.unlinkSync(this.lockFile); } catch { /* none */ }
  }
}
