import fs from 'fs';
import path from 'path';

export function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

// Write to a temp file, keep the previous copy as .bak, then rename over the target,
// so an interrupted write can never leave a half-written JSON file.
export function atomicWriteJson(file, obj) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, `${file}.bak`); } catch {}
  }
  for (let i = 0; i < 5; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if ((e.code === 'EPERM' || e.code === 'EBUSY') && i < 4) {
        const end = Date.now() + 25;
        while (Date.now() < end) {}
      } else if (i === 4) {
        fs.copyFileSync(tmp, file);
        try { fs.unlinkSync(tmp); } catch {}
        return;
      } else {
        throw e;
      }
    }
  }
}

// Reads the file, falls back to the .bak copy if the main file is corrupt, else `fallback`.
export function readJson(file, fallback = null) {
  for (const f of [file, `${file}.bak`]) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* try next */ }
  }
  return fallback;
}
