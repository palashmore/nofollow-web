import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright-core';
import { ensureDir } from '../utils/file-manager.mjs';
import { PATHS, REL } from '../utils/constants.mjs';
import { isAlive } from '../utils/instance-lock.mjs';
import { openProfile } from './profile-navigator.mjs';
import { unfollow, cancelRequest, follow } from './action-executor.mjs';
import { waitForState, waitForScannerProfile } from './relationship-detector.mjs';
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
    try {
      const pid = Number(fs.readFileSync(this.lockFile, 'utf8'));
      if (!pid || pid === process.pid) return null;
      if (!isAlive(pid)) {
        try { fs.unlinkSync(this.lockFile); } catch {}
        return null;
      }
      return pid;
    } catch { return null; }
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

  /** Dedicated fast-path profile inspection for VIP & Influencer scanner running in its own tab. */
  async inspectScanner(username, opts = {}) {
    await this.ensureBrowser();
    const page = await this.tabs.scanner();
    const timeout = opts.navTimeout ?? 25000;
    const url = `https://www.instagram.com/${encodeURIComponent(username)}/`;

    // ⚡ Direct Web API Pre-Flight (10x Faster Scanning)
    // Uses authenticated session cookies and headers inside the browser context to query
    // /api/v1/users/web_profile_info/?username={u} in ~150ms without loading heavy DOM assets.
    try {
      if (!page.url() || page.url() === 'about:blank') {
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
      }

      const apiResult = await page.evaluate(async (uname) => {
        try {
          const res = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(uname)}`, {
            headers: {
              'X-IG-App-ID': '936619743392459',
              'X-Requested-With': 'XMLHttpRequest',
              'Accept': '*/*'
            },
            credentials: 'include'
          });
          if (!res.ok) return { ok: false, status: res.status };
          const data = await res.json();
          const user = data?.data?.user;
          if (!user) return { ok: false, status: 404 };
          return {
            ok: true,
            isVerified: !!user.is_verified,
            followersCount: user.edge_followed_by?.count ?? null,
            followingCount: user.edge_follow?.count ?? null,
            isPrivate: !!user.is_private,
            fullName: user.full_name || '',
            biography: user.biography || ''
          };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }, username);

      if (apiResult?.ok) {
        const followersCount = apiResult.followersCount;
        const followingCount = apiResult.followingCount;
        const followersText = followersCount != null ? (followersCount >= 1e6 ? (followersCount/1e6).toFixed(1)+'M' : followersCount >= 1e3 ? (followersCount/1e3).toFixed(1)+'K' : String(followersCount)) : null;
        const followingText = followingCount != null ? (followingCount >= 1e6 ? (followingCount/1e6).toFixed(1)+'M' : followingCount >= 1e3 ? (followingCount/1e3).toFixed(1)+'K' : String(followingCount)) : null;
        const authorityRatio = (followersCount != null && followingCount != null) ? Number((followersCount / Math.max(1, followingCount)).toFixed(2)) : null;

        return {
          state: REL.FOLLOWING,
          isVerified: apiResult.isVerified,
          followersCount,
          followersText,
          followingCount,
          followingText,
          authorityRatio,
          viaApi: true
        };
      }
    } catch {
      // Graceful fallback to page navigation below
    }

    // Fallback: Full Chromium DOM page navigation
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    const out = await waitForScannerProfile(page, { timeout: opts.elementTimeout ?? 4000, interval: 200 });
    if (out.state === REL.LOGIN_REQUIRED) {
      this.#setSession(SESSION.LOGIN_REQUIRED, { reason: 'Instagram asked for login while inspecting profile in scanner.' });
    }
    return out;
  }

  async closeScannerTab() {
    await this.tabs.closeScanner();
  }

  async recycleScannerTab() {
    await this.tabs.closeScanner();
    this.logger?.info('Scanner tab recycled to maintain minimal memory footprint.');
  }

  async unfollow(opts = {}) { await this.ensureBrowser(); return unfollow(await this.tabs.action(), opts); }
  async cancelRequest(opts = {}) { await this.ensureBrowser(); return cancelRequest(await this.tabs.action(), opts); }
  async follow(opts = {}) { await this.ensureBrowser(); return follow(await this.tabs.action(), opts); }

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
