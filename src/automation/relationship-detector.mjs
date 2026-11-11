import { REL } from '../utils/constants.mjs';
import { SAFETY } from './safety-monitor.mjs';

// Button labels (English plus common Latin-script UI languages)
export const FOLLOWING_RE = /^(Following|Siguiendo|Abonniert|Suivi\(e\)|Seguindo)$/i;
// Accessible name of the real button is "Following" + an icon label, so locators match the START of the name.
export const FOLLOWING_BTN = /^(Following|Siguiendo|Abonniert|Suivi\(e\)|Seguindo)/i;
export const REQUESTED_BTN = /^(Requested|Solicitado|Angefragt|Demand[eé])/i;
export const REQUESTED_RE = /^(Requested|Solicitado|Angefragt|Demand[eé])/i;
export const FOLLOW_RE = /^(Follow|Follow Back|Seguir|Folgen|Suivre|Seguir de volta)$/i;
export const FOLLOW_BTN = /^(Follow|Follow Back|Seguir|Folgen|Suivre|Seguir de volta)/i;
const UNAVAILABLE_RE = /Sorry, this page isn'?t available|Page Not Found|isn'?t available|The link you followed may be broken/i;

export function parseFollowerCount(text) {
  if (!text || typeof text !== 'string') return null;
  const clean = text.trim().toUpperCase().replace(/,/g, '');
  const m = clean.match(/^([\d.]+)\s*([KM])?$/);
  if (!m) {
    const digits = parseInt(clean.replace(/[^\d]/g, ''), 10);
    return Number.isFinite(digits) ? digits : null;
  }
  const num = parseFloat(m[1]);
  if (isNaN(num)) return null;
  if (m[2] === 'M') return Math.round(num * 1000000);
  if (m[2] === 'K') return Math.round(num * 1000);
  return Math.round(num);
}

/**
 * Pure classifier over a page snapshot, so it is testable without a browser.
 * snap = { url, buttons: string[], bodyText, dialogText, hasLoginForm, followsYou, isPrivate, isVerified, followersCount, followersText }
 * Order matters: login > safety > unavailable > relationship button. Never guesses from a failed selector.
 */
export function classify(snap) {
  const buttons = snap.buttons || [];
  const following = buttons.some(b => FOLLOWING_RE.test(b));
  const requested = buttons.some(b => REQUESTED_RE.test(b));
  const follow = buttons.some(b => FOLLOW_RE.test(b));
  const hasRel = following || requested || follow;
  const info = {
    followsYou: !!snap.followsYou,
    isPrivate: !!snap.isPrivate,
    isVerified: !!snap.isVerified,
    followersCount: snap.followersCount ?? null,
    followersText: snap.followersText || null
  };

  if (snap.hasLoginForm || /\/accounts\/(login|emailsignup)/.test(snap.url || '')) return { state: REL.LOGIN_REQUIRED, ...info };
  // Dialog text always counts; page text only when no profile buttons are present (a bio may contain these words)
  const safetyText = `${snap.dialogText || ''}\n${hasRel ? '' : snap.bodyText || ''}`;
  if (SAFETY.captcha.test(safetyText)) return { state: REL.CAPTCHA, ...info };
  if (SAFETY.blocked.test(safetyText)) return { state: REL.ACTION_BLOCKED, ...info };
  if (!hasRel && UNAVAILABLE_RE.test(snap.bodyText || '')) return { state: REL.UNAVAILABLE, ...info };
  if (following) return { state: REL.FOLLOWING, ...info };
  if (requested) return { state: REL.REQUESTED, ...info };
  if (follow) return { state: REL.NOT_FOLLOWING, ...info };
  return { state: REL.LOADING, ...info };
}

export function takeSnapshot(page) {
  return page.evaluate(() => {
    const label = e => (e.innerText || e.getAttribute('aria-label') || '').trim().split('\n')[0].trim();
    const btnsOf = r => [...r.querySelectorAll('button,[role=button]')].map(label).filter(Boolean);
    const header = document.querySelector('main header') || document.querySelector('header');
    let buttons = header ? btnsOf(header) : [];
    if (!buttons.some(b => /^(Following|Requested|Follow|Siguiendo|Solicitado|Angefragt|Demand[eé])/i.test(b))) {
      buttons = [...new Set([...buttons, ...btnsOf(document)])];
    }
    const body = (document.body && document.body.innerText) || '';

    // Verified badge (Blue Tick)
    const isVerified = !!(
      header?.querySelector('svg[aria-label*="Verified" i], [title*="Verified" i]') ||
      document.querySelector('header svg[aria-label*="Verified" i], svg[aria-label*="Verified" i], [title*="Verified" i]')
    );

    // Follower count extraction
    let followersText = '';
    let followersCount = null;
    const metaDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
                     document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
    const m = metaDesc.match(/([\d.,]+[KMkm]?)\s+Followers/i);
    if (m) {
      followersText = m[1];
    } else {
      const followersLink = document.querySelector('a[href$="/followers/"], a[href*="/followers"]');
      if (followersLink) {
        followersText = followersLink.innerText.split('\n')[0].replace(/followers/i, '').trim();
      }
    }
    if (followersText) {
      const clean = followersText.trim().toUpperCase().replace(/,/g, '');
      const numMatch = clean.match(/^([\d.]+)\s*([KM])?$/);
      if (numMatch) {
        const val = parseFloat(numMatch[1]);
        if (!isNaN(val)) {
          followersCount = numMatch[2] === 'M' ? Math.round(val * 1000000) : numMatch[2] === 'K' ? Math.round(val * 1000) : Math.round(val);
        }
      } else {
        followersCount = parseInt(clean.replace(/[^\d]/g, ''), 10) || null;
      }
    }

    return {
      url: location.href, buttons, bodyText: body.slice(0, 6000),
      dialogText: [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].map(d => d.innerText).join('\n').slice(0, 3000),
      hasLoginForm: !!document.querySelector('input[name=password]'),
      followsYou: /Follows you/i.test(body), isPrivate: /This account is private/i.test(body),
      isVerified, followersCount, followersText: followersText || (followersCount ? String(followersCount) : null)
    };
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Poll until the page shows a decisive state. After `timeout` the answer is AMBIGUOUS (never a guess). */
export async function waitForState(page, { timeout = 15000, interval = 400 } = {}) {
  const end = Date.now() + timeout;
  let last = { state: REL.LOADING };
  while (Date.now() < end) {
    try {
      last = classify(await takeSnapshot(page));
      if (last.state !== REL.LOADING) return last;
    } catch (e) {
      if (/closed/i.test(e.message)) throw e;   // navigation in flight is fine, a closed page is not
    }
    await sleep(interval);
  }
  return { ...last, state: REL.AMBIGUOUS };
}

/** Fast-path profile inspection for VIP scanner: returns as soon as followers count or verified badge is parsed. */
export async function waitForScannerProfile(page, { timeout = 4000, interval = 200 } = {}) {
  const end = Date.now() + timeout;
  let last = { state: REL.LOADING, followersCount: null, isVerified: false, followersText: null };
  while (Date.now() < end) {
    try {
      const snap = await takeSnapshot(page);
      last = classify(snap);
      if (last.followersCount !== null || last.isVerified || (last.state !== REL.LOADING && last.state !== REL.AMBIGUOUS)) {
        return last;
      }
    } catch (e) {
      if (/closed/i.test(e.message)) throw e;
    }
    await sleep(interval);
  }
  return last;
}
