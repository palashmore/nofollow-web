import { SAFETY } from './safety-monitor.mjs';

export const SESSION = Object.freeze({ AUTHENTICATED: 'AUTHENTICATED', LOGIN_REQUIRED: 'LOGIN_REQUIRED', SECURITY: 'SECURITY', DISCONNECTED: 'DISCONNECTED', UNKNOWN: 'UNKNOWN' });

/**
 * Pure classifier for the Instagram home page.
 * s = { url, hasCookie, hasLoginForm, hasNav, bodyText, dialogText, account }
 * AUTHENTICATED needs three things at once: an instagram.com page, a session cookie, and the logged-in navigation rendered.
 * A cookie alone is never enough (it can be expired server-side).
 */
export function classifySession(s) {
  const url = s.url || '';
  let host = '';
  try { host = new URL(url).hostname; } catch { /* about:blank etc. */ }
  if (!/(^|\.)instagram\.com$/.test(host)) return { state: SESSION.UNKNOWN, reason: `Unexpected page (${host || url || 'blank'}) instead of Instagram.` };
  if (/\/challenge\/|\/accounts\/(suspended|disabled)|\/checkpoint/.test(url) || SAFETY.captcha.test(s.bodyText || '') || SAFETY.blocked.test(s.dialogText || '')) {
    return { state: SESSION.SECURITY, reason: 'Instagram is asking for a security verification. Complete it in the browser window.' };
  }
  if (s.hasLoginForm || /\/accounts\/(login|emailsignup)/.test(url)) return { state: SESSION.LOGIN_REQUIRED, reason: 'Instagram shows the login page.' };
  if (!s.hasCookie) return { state: SESSION.LOGIN_REQUIRED, reason: 'No Instagram session found in this browser.' };
  if (s.hasNav) return { state: SESSION.AUTHENTICATED, account: s.account || null };
  return { state: SESSION.UNKNOWN, reason: 'Instagram did not finish loading.' };
}

export function takeSessionSnapshot(page) {
  return page.evaluate(() => {
    const img = document.querySelector('nav img[alt*="profile picture"], a[href^="/"] img[alt*="profile picture"], [role="navigation"] img[alt*="profile picture"], header img[alt*="profile picture"]');
    const hasNav = !!document.querySelector('nav, [role=navigation], a[href="/explore/"], a[href="/direct/inbox/"], a[href^="/direct/"], a[href="/reels/"], svg[aria-label="Home"], svg[aria-label="Search"], svg[aria-label="Explore"], svg[aria-label="Messages"], svg[aria-label="New post"], svg[aria-label="Your profile"]');
    let account = img ? (img.getAttribute('alt') || '').replace(/['’]s profile picture$/i, '').trim() : null;
    if (!account) {
      const link = document.querySelector('a[href^="/"][role="link"] span, nav a[href^="/"]:last-child');
      const href = link?.closest('a')?.getAttribute('href') || '';
      const m = href.match(/^\/([a-zA-Z0-9._]+)\/?$/);
      if (m && !['explore', 'reels', 'direct', 'stories'].includes(m[1])) account = m[1];
    }
    return {
      url: location.href,
      hasLoginForm: !!document.querySelector('input[name=password]'),
      hasNav,
      bodyText: ((document.body && document.body.innerText) || '').slice(0, 3000),
      dialogText: [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].map(d => d.innerText).join('\n').slice(0, 2000),
      account,
    };
  });
}
