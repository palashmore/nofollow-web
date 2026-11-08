// Real processes: starts the actual application twice, checks the single-instance guard and the clean shutdown.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import { spawn } from 'child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const free = () => new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = (env, onOut) => {
  const c = spawn(process.execPath, ['unfollow.mjs'], { cwd: ROOT, env: { ...process.env, NO_OPEN: '1', NF_HEADLESS: '1', ...env } });
  let out = ''; c.stdout.on('data', d => { out += d; onOut?.(out); }); c.stderr.on('data', d => { out += d; });
  const done = new Promise(res => c.on('exit', code => res({ code, out })));
  return { c, done, out: () => out };
};
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return false; };
const ping = async port => { try { return (await (await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(1000) })).json()); } catch { return null; } };
const isAlive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('duplicate application process: the second start is refused, points at the running dashboard, and leaves the first untouched; shutdown is clean', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-inst-'));
  const port = await free();
  const env = { PORT: String(port), NF_DATA_DIR: path.join(dir, 'data'), NF_LOGS_DIR: path.join(dir, 'logs'), NF_PROFILE_DIR: path.join(dir, 'profile') };
  const a = run(env);
  assert.ok(await until(async () => (await ping(port))?.app === 'nofollow-web'), 'first instance did not start: ' + a.out());
  const pidA = (await ping(port)).pid;
  const lockFile = path.join(dir, 'data', '.app.lock');
  assert.equal(JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid, pidA);

  const b = await run(env).done;                           // second start
  assert.equal(b.code, 0);
  assert.match(b.out, /NoFollow Web is already running on this machine/);
  assert.match(b.out, new RegExp(`127\\.0\\.0\\.1:${port}`));
  assert.equal(JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid, pidA, 'the running instance still owns the lock');
  assert.equal((await ping(port)).pid, pidA, 'and is still serving');

  const c = await run(env).done;                           // a third one for good measure
  assert.match(c.out, /already running/);
  assert.equal(JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid, pidA);

  const r = await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { 'X-NoFollow': '1' } });
  assert.equal(r.status, 200);
  assert.equal((await a.done).code, 0, 'clean exit');
  assert.equal(fs.existsSync(lockFile), false, 'lock released on shutdown');
  assert.equal(isAlive(pidA), false);
  assert.equal(await ping(port), null, 'port is free again');
});

test('stale lock from a crashed instance is recovered on the next start', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-inst-'));
  const port = await free();
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', '.app.lock'), JSON.stringify({ pid: 99999999, port }));
  const a = run({ PORT: String(port), NF_DATA_DIR: path.join(dir, 'data'), NF_LOGS_DIR: path.join(dir, 'logs'), NF_PROFILE_DIR: path.join(dir, 'profile') });
  assert.ok(await until(async () => (await ping(port))?.app === 'nofollow-web'), a.out());
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'data', '.app.lock'), 'utf8')).pid, (await ping(port)).pid);
  await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { 'X-NoFollow': '1' } });
  assert.equal((await a.done).code, 0);
});

test('a different program on the port is reported clearly and does not corrupt the lock', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-inst-'));
  const busy = net.createServer().listen(0, '127.0.0.1'); await new Promise(r => busy.once('listening', r));
  const port = busy.address().port;
  const r = await run({ PORT: String(port), NF_DATA_DIR: path.join(dir, 'data'), NF_LOGS_DIR: path.join(dir, 'logs'), NF_PROFILE_DIR: path.join(dir, 'profile') }).done;
  busy.close();
  assert.equal(r.code, 1);
  assert.match(r.out, /used by another program/);
  assert.equal(fs.existsSync(path.join(dir, 'data', '.app.lock')), false, 'lock released after the failed start');
});
