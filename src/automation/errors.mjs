export const ERR = Object.freeze({
  ELEMENT_NOT_FOUND: 'ELEMENT_NOT_FOUND', ELEMENT_NOT_VISIBLE: 'ELEMENT_NOT_VISIBLE', ELEMENT_NOT_ENABLED: 'ELEMENT_NOT_ENABLED',
  NAVIGATION_TIMEOUT: 'NAVIGATION_TIMEOUT', PROFILE_UNAVAILABLE: 'PROFILE_UNAVAILABLE', LOGIN_REQUIRED: 'LOGIN_REQUIRED',
  SESSION_DISCONNECTED: 'SESSION_DISCONNECTED', RELATIONSHIP_AMBIGUOUS: 'RELATIONSHIP_AMBIGUOUS',
  INSTAGRAM_SECURITY_WARNING: 'INSTAGRAM_SECURITY_WARNING', UNKNOWN: 'UNKNOWN',
});

export class AutomationError extends Error {
  constructor(code, message) { super(message); this.name = 'AutomationError'; this.code = code; }
}

/** Maps any thrown error to one of the ERR codes (or BROWSER_LAUNCH for a browser that could not start). */
export function classifyError(e) {
  if (e?.code === 'BROWSER_LAUNCH') return 'BROWSER_LAUNCH';
  if (e?.code && ERR[e.code]) return e.code;
  const m = String(e?.message || '');
  if (/Target (page, context or browser )?has been closed|browser has been closed|has been disconnected|Target closed|Browser closed|connection closed/i.test(m)) return ERR.SESSION_DISCONNECTED;
  if (/page\.goto|page\.reload|net::ERR_|Navigation (timeout|failed)/i.test(m)) return ERR.NAVIGATION_TIMEOUT;
  if (/not visible|outside of the viewport|intercepts pointer events/i.test(m)) return ERR.ELEMENT_NOT_VISIBLE;
  if (/not enabled|disabled/i.test(m)) return ERR.ELEMENT_NOT_ENABLED;
  if (/strict mode violation/i.test(m)) return ERR.RELATIONSHIP_AMBIGUOUS;
  if (/locator\.|waiting for (locator|getBy)|Timeout .* exceeded/i.test(m)) return ERR.ELEMENT_NOT_FOUND;
  return ERR.UNKNOWN;
}

// Problems with the page layout, not with the network: never retried blindly, sent to manual review instead.
export const REVIEW_CODES = new Set([ERR.ELEMENT_NOT_FOUND, ERR.ELEMENT_NOT_VISIBLE, ERR.ELEMENT_NOT_ENABLED, ERR.RELATIONSHIP_AMBIGUOUS]);
