import { DEFAULT_SETTINGS, SETTING_LIMITS, PROFILES } from './constants.mjs';

const LABELS = {
  actionIntervalSec: 'Action interval (seconds)', navigationTimeoutSec: 'Navigation timeout (seconds)',
  elementTimeoutSec: 'Element detection timeout (seconds)', maxAttempts: 'Retries per account',
  maxPerRun: 'Max accounts per run', errorThreshold: 'Failure streak limit',
};
export const settingLabel = k => LABELS[k] || k;
export const profileFor = n => Object.keys(PROFILES).find(k => PROFILES[k].intervalSec === n) || 'custom';

/**
 * Validates a settings change. Invalid values are REJECTED with a message, never clamped,
 * so the app can never end up with a value the user did not choose.
 * @returns {{settings?: object, errors: string[]}}
 */
export function validateSettings(patch = {}, current = DEFAULT_SETTINGS) {
  const errors = [];
  const next = { ...current };
  if (patch.executionProfile !== undefined && patch.executionProfile !== 'custom') {
    if (!PROFILES[patch.executionProfile]) errors.push(`Unknown execution profile "${patch.executionProfile}".`);
    else next.actionIntervalSec = PROFILES[patch.executionProfile].intervalSec;
  }
  for (const [k, [lo, hi]] of Object.entries(SETTING_LIMITS)) {
    if (patch[k] === undefined) continue;
    const n = Number(patch[k]);
    if (!Number.isInteger(n)) errors.push(`${LABELS[k]} must be a whole number.`);
    else if (n < lo || n > hi) errors.push(`${LABELS[k]} must be between ${lo} and ${hi}.`);
    else next[k] = n;
  }
  if (patch.theme !== undefined) { if (['dark', 'light'].includes(patch.theme)) next.theme = patch.theme; else errors.push('Theme must be dark or light.'); }
  if (patch.browserChannel !== undefined) { if (['chrome', 'msedge', ''].includes(patch.browserChannel)) next.browserChannel = patch.browserChannel; else errors.push('Unknown browser.'); }
  if (errors.length) return { errors };
  next.executionProfile = profileFor(next.actionIntervalSec);
  return { settings: next, errors: [] };
}

/** Reads settings from disk. Returns notes for anything that had to be replaced, so the caller can tell the user. */
export function loadSettings(raw) {
  const notes = [];
  let src = raw && typeof raw === 'object' ? { ...raw } : {};
  if (src.actionIntervalSec === undefined && src.delayMax !== undefined) {
    src.actionIntervalSec = src.delayMax;                         // older versions: keep the slower end of the old range
    notes.push(`Settings migrated from an older version: action interval set to ${src.delayMax} s (the old maximum delay).`);
  }
  let settings = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (src[k] === undefined) continue;
    const r = validateSettings({ [k]: src[k] }, settings);
    if (r.errors.length) notes.push(`Saved ${settingLabel(k)} was invalid and the default is used.`);
    else settings = r.settings;
  }
  settings.executionProfile = profileFor(settings.actionIntervalSec);
  return { settings, notes };
}
