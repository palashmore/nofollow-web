import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AutomationController } from '../../src/automation/automation-controller.mjs';
import { CheckpointService } from '../../src/services/checkpoint-service.mjs';
import { Logger } from '../../src/services/logger-service.mjs';
import { AutomationError, ERR } from '../../src/automation/errors.mjs';
import { TRANSITIONS, ENGINE } from '../../src/utils/constants.mjs';

export const SETTINGS = { executionProfile: 'custom', actionIntervalSec: 0, navigationTimeoutSec: 30, elementTimeoutSec: 10, maxAttempts: 2, maxPerRun: 1000, errorThreshold: 3 };
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Scripted fake of the browser session. script[user] = state (or array of states consumed in order, or an Error). */
export function fake(script, { unfollowResult = 'NOT_FOLLOWING', followResult = 'FOLLOWING', loggedIn = () => true } = {}) {
  const calls = { inspect: [], unfollow: 0, cancel: 0, follow: 0, verify: 0 };
  const ig = {
    calls, session: { state: 'AUTHENTICATED' },
    async loggedIn() { return loggedIn(); },
    async verifySession() { calls.verify++; const s = typeof ig.session === 'function' ? ig.session() : ig.session; if (s instanceof Error) throw s; return s; },
    async screenshot() { return null; },
    async inspect(u) {
      calls.inspect.push(u);
      const s = script[u]; const v = Array.isArray(s) ? (s.length > 1 ? s.shift() : s[0]) : s;
      if (v instanceof Error) throw v;
      return { state: v };
    },
    async unfollow() { calls.unfollow++; const r = typeof unfollowResult === 'function' ? unfollowResult() : unfollowResult; if (r instanceof Error) throw r; return { state: r }; },
    async cancelRequest() { calls.cancel++; const r = typeof unfollowResult === 'function' ? unfollowResult() : unfollowResult; if (r instanceof Error) throw r; return { state: r }; },
    async follow() { calls.follow++; const r = typeof followResult === 'function' ? followResult() : followResult; if (r instanceof Error) throw r; return { state: r }; },
  };
  return ig;
}
export function setup(script, opts, settings = {}, job = 'unfollow') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-ex-'));
  const checkpoint = new CheckpointService(path.join(dir, 's.json'));
  const ig = fake(script, opts);
  const cfg = { ...SETTINGS, ...settings };
  const engine = new AutomationController({ ig, checkpoint, logger: new Logger(dir), getSettings: () => cfg, job });
  engine.history = []; engine.on('state', s => { if (engine.history.at(-1) !== s.status) engine.history.push(s.status); });
  return { dir, checkpoint, ig, engine, cfg };
}
export async function untilIdle(engine, ms = 8000) {
  const end = Date.now() + ms;
  while (engine.active && Date.now() < end) await sleep(40);
  assert.equal(engine.active, false, `run did not finish (status ${engine.status})`);
}
export async function untilStatus(engine, status, ms = 8000) {
  const end = Date.now() + ms;
  while (engine.status !== status && Date.now() < end) await sleep(40);
  assert.equal(engine.status, status);
}

