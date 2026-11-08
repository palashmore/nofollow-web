import { waitForState } from './relationship-detector.mjs';

/** Opens a profile in the work page and returns the verified relationship state. */
export async function openProfile(page, username, { timeout = 30000, stateTimeout = 15000 } = {}) {
  await page.goto(`https://www.instagram.com/${encodeURIComponent(username)}/`, { waitUntil: 'domcontentloaded', timeout });
  return waitForState(page, { timeout: stateTimeout });
}
