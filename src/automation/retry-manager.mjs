const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Bounded retry. Never loops forever: at most `attempts` calls, then rethrows the last error. */
export async function retry(fn, { attempts = 2, delayMs = 1500, shouldRetry = () => true, onRetry } = {}) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(i); } catch (e) {
      last = e;
      if (i === attempts || !shouldRetry(e)) break;
      onRetry?.(e, i);
      await sleep(delayMs * i);
    }
  }
  throw last;
}

export const isBrowserClosed = e => /Target (page, context or browser )?has been closed|Browser has been closed|browser has disconnected|Target closed/i.test(e?.message || '');
