import { REL } from '../utils/constants.mjs';
import { FOLLOWING_BTN, REQUESTED_BTN, classify, takeSnapshot } from './relationship-detector.mjs';
import { AutomationError, ERR } from './errors.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const UNFOLLOW_ITEM = /^Unfollow$/;
// "Cancel" alone is the dismiss button of the dialog and is deliberately NOT matched.
const CANCEL_ITEM = /^(Unfollow|Cancel request|Cancel follow request)$/i;

/**
 * Finds the one relationship button and proves it is safe to click before clicking:
 * present, exactly one visible match, enabled. Anything else is a classified error, never a blind 8-second click timeout.
 */
export async function pickButton(page, pattern, timeout) {
  // includeHidden: a hidden button must be reported as ELEMENT_NOT_VISIBLE, not mistaken for a missing one
  const find = root => root.getByRole('button', { name: pattern, includeHidden: true });
  const scoped = find(page.locator('header'));
  const loc = (await scoped.count()) ? scoped : find(page);
  try { await loc.first().waitFor({ state: 'attached', timeout }); }
  catch { throw new AutomationError(ERR.ELEMENT_NOT_FOUND, 'The relationship button is not on the page.'); }
  const visible = loc.filter({ visible: true });
  const n = await visible.count();
  if (n === 0) throw new AutomationError(ERR.ELEMENT_NOT_VISIBLE, 'The relationship button exists but is not visible.');
  if (n > 1) throw new AutomationError(ERR.RELATIONSHIP_AMBIGUOUS, `${n} visible buttons match; refusing to guess which one to click.`);
  if (!(await visible.isEnabled())) throw new AutomationError(ERR.ELEMENT_NOT_ENABLED, 'The relationship button is disabled.');
  return visible;
}

/**
 * Click the relationship button, then the confirmation item of the menu that opens, then report the state the page shows.
 * The caller treats success as "page now shows Follow" only.
 */
async function act(page, { button, item, elementTimeout = 10000 }) {
  const btn = await pickButton(page, button, elementTimeout);
  await page.bringToFront().catch(() => {});   // the action tab must be in front for the click, whatever manual tabs are open
  await btn.click({ timeout: elementTimeout });

  const end = Date.now() + elementTimeout + 4000;
  let clicks = 0, last = { state: REL.LOADING };
  while (Date.now() < end) {
    last = classify(await takeSnapshot(page));
    if ([REL.NOT_FOLLOWING, REL.ACTION_BLOCKED, REL.CAPTCHA, REL.LOGIN_REQUIRED].includes(last.state)) return last;
    if (clicks < 2) {
      const dialog = page.locator('[role=dialog], [role=alertdialog]');
      let target = null;
      if (await dialog.count() > 0) {
        const dialogBtns = dialog.locator('button, [role=button]').filter({ hasText: item }).filter({ visible: true });
        if (await dialogBtns.count() > 0) target = dialogBtns.first();
      }
      if (!target) {
        const entry = page.getByText(item).filter({ visible: true });
        if (await entry.count() >= 1) target = entry.first();
      }
      if (target) {
        await target.click({ timeout: elementTimeout });
        clicks++;
      }
    }
    await sleep(400);
  }
  if (!clicks) throw new AutomationError(ERR.ELEMENT_NOT_FOUND, 'The confirmation option did not appear after opening the menu.');
  return last;
}

export const unfollow = (page, opts = {}) => act(page, { button: FOLLOWING_BTN, item: UNFOLLOW_ITEM, ...opts });
export const cancelRequest = (page, opts = {}) => act(page, { button: REQUESTED_BTN, item: CANCEL_ITEM, ...opts });
