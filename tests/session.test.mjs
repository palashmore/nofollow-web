import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { classifySession, SESSION } from '../src/automation/session-detector.mjs';
import { classifyError, ERR } from '../src/automation/errors.mjs';
import { acquireAppLock, isAlive } from '../src/utils/instance-lock.mjs';

const home = (o = {}) => ({ url: 'https://www.instagram.com/', hasCookie: true, hasLoginForm: false, hasNav: true, bodyText: '', dialogText: '', account: 'tester', ...o });

test('session: authenticated needs the page, a cookie AND the logged-in navigation', () => {
  assert.equal(classifySession(home()).state, SESSION.AUTHENTICATED);
  assert.equal(classifySession(home()).account, 'tester');
  assert.equal(classifySession(home({ hasCookie: false })).state, SESSION.LOGIN_REQUIRED, 'navigation without cookie is not logged in');
  assert.equal(classifySession(home({ hasNav: false })).state, SESSION.UNKNOWN, 'cookie without a rendered logged-in page is not verified');
});

test('session: login page, login url, expired session', () => {
  assert.equal(classifySession(home({ hasLoginForm: true, hasNav: false })).state, SESSION.LOGIN_REQUIRED);
  assert.equal(classifySession(home({ url: 'https://www.instagram.com/accounts/login/?next=/' })).state, SESSION.LOGIN_REQUIRED);
  assert.equal(classifySession(home({ hasCookie: true, hasLoginForm: true })).state, SESSION.LOGIN_REQUIRED, 'cookie present but server shows login = expired');
});

test('session: security verification and challenge redirects', () => {
  assert.equal(classifySession(home({ url: 'https://www.instagram.com/challenge/abc/' })).state, SESSION.SECURITY);
  assert.equal(classifySession(home({ dialogText: 'We restrict certain activity to protect our community' })).state, SESSION.SECURITY);
  assert.equal(classifySession(home({ bodyText: "Please confirm you're a human: security check" })).state, SESSION.SECURITY);
});

test('session: unexpected redirects are not treated as logged in', () => {
  assert.equal(classifySession(home({ url: 'https://evil.example/instagram.com/' })).state, SESSION.UNKNOWN);
  assert.equal(classifySession(home({ url: 'about:blank' })).state, SESSION.UNKNOWN);
  assert.equal(classifySession(home({ url: 'https://www.instagram.com.evil.example/' })).state, SESSION.UNKNOWN);
});

test('errors are classified into the named codes', () => {
  const c = m => classifyError(new Error(m));
  assert.equal(c('locator.click: Timeout 8000ms exceeded.'), ERR.ELEMENT_NOT_FOUND);
  assert.equal(c('page.goto: Timeout 30000ms exceeded'), ERR.NAVIGATION_TIMEOUT);
  assert.equal(c('page.goto: net::ERR_INTERNET_DISCONNECTED'), ERR.NAVIGATION_TIMEOUT);
  assert.equal(c('page.evaluate: Target page, context or browser has been closed'), ERR.SESSION_DISCONNECTED);
  assert.equal(c('Browser has been closed'), ERR.SESSION_DISCONNECTED);
  assert.equal(c('element is not visible'), ERR.ELEMENT_NOT_VISIBLE);
  assert.equal(c('element is not enabled'), ERR.ELEMENT_NOT_ENABLED);
  assert.equal(c('strict mode violation: getByRole resolved to 2 elements'), ERR.RELATIONSHIP_AMBIGUOUS);
  assert.equal(c('something odd'), ERR.UNKNOWN);
  assert.equal(classifyError(Object.assign(new Error('x'), { code: 'BROWSER_LAUNCH' })), 'BROWSER_LAUNCH');
});

test('duplicate application process: the second one cannot take the lock; the holder is reported', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nf-lock-')), '.app.lock');
  const first = acquireAppLock(file, { port: 4173 });
  assert.equal(first.ok, true);
  // simulate another process: a live pid that is not ours (the parent test runner)
  fs.writeFileSync(file, JSON.stringify({ pid: process.ppid, port: 4173 }));
  const second = acquireAppLock(file, { port: 4173 });
  assert.equal(second.ok, false);
  assert.equal(second.holder.pid, process.ppid);
  assert.equal(second.holder.port, 4173);
});

test('stale lock (process gone) is recovered; release only removes our own lock', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nf-lock-')), '.app.lock');
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},50)']);
  const deadPid = child.pid;
  await new Promise(r => child.on('exit', r));
  assert.equal(isAlive(deadPid), false);
  fs.writeFileSync(file, JSON.stringify({ pid: deadPid }));
  const lock = acquireAppLock(file);
  assert.equal(lock.ok, true, 'stale lock replaced');
  fs.writeFileSync(file, JSON.stringify({ pid: 999999 }));
  lock.release();
  assert.equal(fs.existsSync(file), true, 'a lock held by someone else is left alone');
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid }));
  lock.release();
  assert.equal(fs.existsSync(file), false);
});

test('the lock file is created exclusively: two simultaneous attempts, exactly one wins', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nf-lock-')), '.app.lock');
  const code = `import {acquireAppLock} from ${JSON.stringify(new URL('../src/utils/instance-lock.mjs', import.meta.url).href)}; const r=acquireAppLock(${JSON.stringify(file)}); console.log(r.ok?'WON':'LOST'); if(r.ok) setTimeout(()=>{},600);`;
  const run = () => new Promise(res => { let out = ''; const c = spawn(process.execPath, ['--input-type=module', '-e', code]); c.stdout.on('data', d => { out += d; }); c.on('exit', () => res(out.trim())); });
  const results = await Promise.all([run(), run(), run()]);
  assert.equal(results.filter(r => r === 'WON').length, 1, results.join(','));
});
