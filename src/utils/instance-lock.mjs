import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { ensureDir, readJson } from './file-manager.mjs';

export const isAlive = pid => {
  try {
    process.kill(pid, 0);
    if (process.platform === 'win32') {
      try {
        const out = execFileSync('tasklist.exe', ['/fi', `PID eq ${pid}`, '/fo', 'csv', '/nh'], { encoding: 'utf8', timeout: 1500, windowsHide: true });
        if (!out || out.includes('No tasks')) return false;
        return /node\.exe/i.test(out);
      } catch {
        return true;
      }
    }
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

/**
 * Single-instance lock. The file is created exclusively, so two processes can never both hold it.
 * A lock whose process is gone is stale and is replaced.
 * @returns {{ok: true, release: Function} | {ok: false, holder: object|null}}
 */
export function acquireAppLock(file, info = {}) {
  ensureDir(path.dirname(file));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), ...info }));
      fs.closeSync(fd);
      return { ok: true, release: () => { try { if (readJson(file, {}).pid === process.pid) fs.unlinkSync(file); } catch { /* already gone */ } } };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let holder = readJson(file, null);
      if (!holder?.pid) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        holder = readJson(file, null);
      }
      if (holder?.pid && holder.pid !== process.pid && isAlive(holder.pid)) return { ok: false, holder };
      if (holder?.pid && !isAlive(holder.pid)) {
        try { fs.unlinkSync(file); } catch { /* raced with another cleaner */ }
      }
    }
  }
  return { ok: false, holder: readJson(file, null) };
}

export function removeAppLock(file) { try { fs.unlinkSync(file); } catch { /* none */ } }
