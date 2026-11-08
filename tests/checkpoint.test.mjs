import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CheckpointService } from '../src/services/checkpoint-service.mjs';
import { atomicWriteJson, readJson } from '../src/utils/file-manager.mjs';
import { validateSettings, loadSettings } from '../src/utils/validators.mjs';
import { DEFAULT_SETTINGS } from '../src/utils/constants.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nf-cp-'));

test('results survive a restart and are written atomically (no .tmp left)', () => {
  const dir = tmp(), file = path.join(dir, 's.json');
  const a = new CheckpointService(file);
  a.set('amy', { status: 'UNFOLLOWED', attempts: 1 });
  a.set('bob', { status: 'FAILED', reason: 'x' });
  const b = new CheckpointService(file);
  assert.equal(b.statusOf('amy'), 'UNFOLLOWED');
  assert.equal(b.isFinal('amy'), true);
  assert.equal(b.isFinal('bob'), false);
  assert.equal(b.statusOf('nobody'), 'PENDING');
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), []);
});

test('a corrupted main file falls back to the .bak copy', () => {
  const dir = tmp(), file = path.join(dir, 's.json');
  const a = new CheckpointService(file);
  a.set('amy', { status: 'UNFOLLOWED' }); a.set('bob', { status: 'UNFOLLOWED' });
  fs.writeFileSync(file, '{"accounts": {"amy": {"sta');     // simulated interrupted write
  const b = new CheckpointService(file);
  assert.equal(b.statusOf('amy'), 'UNFOLLOWED');
});

test('interrupted accounts are re-queued, interrupted runs are marked', () => {
  const file = path.join(tmp(), 's.json');
  const a = new CheckpointService(file);
  a.startRun(['x']); a.set('x', { status: 'IN_PROGRESS' });
  const b = new CheckpointService(file);
  assert.equal(b.recoverInterrupted(), 1);
  assert.equal(b.statusOf('x'), 'RETRY_PENDING');
  assert.equal(b.state.runs[0].status, 'INTERRUPTED');
});

test('done.json import is idempotent and reset keeps a backup and the run history', () => {
  const file = path.join(tmp(), 's.json');
  const c = new CheckpointService(file);
  assert.equal(c.importDone(['a', 'b']), 2);
  assert.equal(c.importDone(['a', 'b', 'c']), 1);
  c.startRun(['a']);
  c.reset();
  assert.equal(c.statusOf('a'), 'PENDING');
  assert.equal(c.state.runs.length, 1);
  assert.ok(readJson(`${file}.before-reset`).accounts.a);
});

test('atomicWriteJson replaces the file', () => {
  const f = path.join(tmp(), 'x.json');
  atomicWriteJson(f, { a: 1 }); atomicWriteJson(f, { a: 2 });
  assert.equal(readJson(f).a, 2);
  assert.equal(readJson(`${f}.bak`).a, 1);
});

test('settings: invalid values are REJECTED with a reason, never silently clamped', () => {
  const ok = validateSettings({ actionIntervalSec: 20, navigationTimeoutSec: 45, elementTimeoutSec: 12, maxAttempts: 3, theme: 'light' }, DEFAULT_SETTINGS);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual([ok.settings.actionIntervalSec, ok.settings.navigationTimeoutSec, ok.settings.elementTimeoutSec, ok.settings.maxAttempts, ok.settings.theme], [20, 45, 12, 3, 'light']);
  assert.equal(ok.settings.executionProfile, 'custom');
  for (const bad of [{ actionIntervalSec: 1 }, { actionIntervalSec: 'x' }, { maxAttempts: 99 }, { navigationTimeoutSec: 2 }, { theme: 'blue' }, { browserChannel: 'ie' }, { executionProfile: 'turbo' }]) {
    const r = validateSettings(bad, DEFAULT_SETTINGS);
    assert.ok(r.errors.length && !r.settings, JSON.stringify(bad));
  }
});

test('settings: execution profiles set the interval, and the profile is derived from the interval', () => {
  const safe = validateSettings({ executionProfile: 'safe' }, DEFAULT_SETTINGS).settings;
  assert.equal(safe.actionIntervalSec, 30);
  assert.equal(safe.executionProfile, 'safe');
  assert.equal(validateSettings({ actionIntervalSec: 15 }, safe).settings.executionProfile, 'balanced');
});

test('settings persistence: values survive a load; old files are migrated with a visible note; bad saved values are reported', () => {
  const { settings, notes } = loadSettings({ actionIntervalSec: 20, elementTimeoutSec: 15, maxAttempts: 3 });
  assert.deepEqual(notes, []);
  assert.equal(settings.actionIntervalSec, 20); assert.equal(settings.maxAttempts, 3);
  const old = loadSettings({ delayMin: 12, delayMax: 25, parallelTabs: 3 });
  assert.equal(old.settings.actionIntervalSec, 25);
  assert.ok(old.notes.some(n => /migrated/.test(n)));
  assert.ok(!('parallelTabs' in old.settings));
  const bad = loadSettings({ actionIntervalSec: 1 });
  assert.equal(bad.settings.actionIntervalSec, 15);
  assert.ok(bad.notes.some(n => /invalid/.test(n)));
});
