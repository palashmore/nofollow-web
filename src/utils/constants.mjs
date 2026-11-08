import path from 'path';
import { fileURLToPath } from 'url';

const env = process.env;
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const logs = env.NF_LOGS_DIR || path.join(ROOT, 'logs');
export const PATHS = {
  data: env.NF_DATA_DIR || path.join(ROOT, 'data'),
  logs,
  profile: env.NF_PROFILE_DIR || path.join(ROOT, 'profile'),
  shots: path.join(logs, 'shots'),
};

// Per-account status (unfollow and cancel-request jobs share one vocabulary)
export const STATUS = Object.freeze({
  PENDING: 'PENDING', IN_PROGRESS: 'IN_PROGRESS', UNFOLLOWED: 'UNFOLLOWED',
  ALREADY_UNFOLLOWED: 'ALREADY_UNFOLLOWED', CANCELLED: 'CANCELLED', ALREADY_CANCELLED: 'ALREADY_CANCELLED', ACCEPTED: 'ACCEPTED',
  PROFILE_UNAVAILABLE: 'PROFILE_UNAVAILABLE', SKIPPED: 'SKIPPED', RETRY_PENDING: 'RETRY_PENDING', NEEDS_REVIEW: 'NEEDS_REVIEW',
  FAILED: 'FAILED', PAUSED: 'PAUSED', ACTION_BLOCKED: 'ACTION_BLOCKED',
});
// Never processed again unless the user resets history
export const FINAL = new Set([STATUS.UNFOLLOWED, STATUS.ALREADY_UNFOLLOWED, STATUS.CANCELLED, STATUS.ALREADY_CANCELLED, STATUS.ACCEPTED, STATUS.PROFILE_UNAVAILABLE, STATUS.SKIPPED]);

// What the page says about the relationship
export const REL = Object.freeze({
  FOLLOWING: 'FOLLOWING', NOT_FOLLOWING: 'NOT_FOLLOWING', REQUESTED: 'REQUESTED',
  UNAVAILABLE: 'UNAVAILABLE', ACTION_BLOCKED: 'ACTION_BLOCKED', CAPTCHA: 'CAPTCHA',
  LOGIN_REQUIRED: 'LOGIN_REQUIRED', AMBIGUOUS: 'AMBIGUOUS', LOADING: 'LOADING',
});

// Automation engine state machine. Every change goes through TRANSITIONS.
export const ENGINE = Object.freeze({
  IDLE: 'IDLE', STARTING: 'STARTING', CHECKING_SESSION: 'CHECKING_SESSION', RUNNING: 'RUNNING', PAUSED: 'PAUSED',
  LOGIN_REQUIRED: 'LOGIN_REQUIRED', RECOVERING: 'RECOVERING', SAFETY_PAUSED: 'SAFETY_PAUSED', STOPPING: 'STOPPING',
  COMPLETED: 'COMPLETED', FAILED: 'FAILED',
});
const E = ENGINE;
const WAITING = [E.PAUSED, E.LOGIN_REQUIRED, E.RECOVERING, E.SAFETY_PAUSED];
export const TRANSITIONS = Object.freeze({
  [E.IDLE]: [E.STARTING],
  [E.STARTING]: [E.CHECKING_SESSION, E.STOPPING, E.FAILED],
  [E.CHECKING_SESSION]: [E.RUNNING, E.LOGIN_REQUIRED, E.RECOVERING, E.SAFETY_PAUSED, E.STOPPING, E.FAILED],
  [E.RUNNING]: [...WAITING, E.STOPPING, E.COMPLETED, E.FAILED],
  [E.PAUSED]: [E.CHECKING_SESSION, E.STOPPING, E.FAILED],
  [E.LOGIN_REQUIRED]: [E.CHECKING_SESSION, E.STOPPING, E.FAILED],
  [E.RECOVERING]: [E.CHECKING_SESSION, E.STOPPING, E.FAILED],
  [E.SAFETY_PAUSED]: [E.CHECKING_SESSION, E.STOPPING, E.FAILED],
  [E.STOPPING]: [E.IDLE, E.FAILED],
  [E.COMPLETED]: [E.STARTING, E.IDLE],
  [E.FAILED]: [E.STARTING, E.IDLE],
});
export const ACTIVE_STATES = new Set([E.STARTING, E.CHECKING_SESSION, E.RUNNING, ...WAITING, E.STOPPING]);
export const RESUMABLE = new Set(WAITING);

// Execution profiles: only the fixed wait between actions differs. There is no randomisation.
export const PROFILES = Object.freeze({
  safe: { name: 'Safe', intervalSec: 30, note: 'Lowest chance of restrictions' },
  balanced: { name: 'Balanced', intervalSec: 15, note: 'Moderate' },
  fast: { name: 'Fast', intervalSec: 8, note: 'Higher chance of restrictions' },
});

export const DEFAULT_SETTINGS = Object.freeze({
  executionProfile: 'balanced',
  actionIntervalSec: 15,           // fixed wait between accounts (one action worker, no randomisation)
  navigationTimeoutSec: 30,        // opening a profile
  elementTimeoutSec: 10,           // waiting for the page / buttons to appear
  maxAttempts: 2,                  // bounded retries per account
  maxPerRun: 800,
  errorThreshold: 8,               // consecutive FAILED accounts before a safety pause
  browserChannel: 'chrome',
  theme: 'dark',
});
export const SETTING_LIMITS = Object.freeze({
  actionIntervalSec: [2, 600], navigationTimeoutSec: [10, 120], elementTimeoutSec: [3, 60],
  maxAttempts: [1, 5], maxPerRun: [1, 5000], errorThreshold: [2, 50],
});
