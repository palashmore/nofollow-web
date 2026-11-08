import { chromium } from 'playwright-core';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve('docs/screenshots/obsidian');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const resolutions = [
  { name: '1080p', width: 1920, height: 1080 },
  { name: 'laptop-hi', width: 1536, height: 864 },
  { name: 'laptop-std', width: 1366, height: 768 }
];

const pages = [
  { name: 'dashboard', path: '#/dashboard' },
  { name: 'non-followers', path: '#/non-followers' },
  { name: 'pending-requests', path: '#/pending-requests' },
  { name: 'queue', path: '#/queue' },
  { name: 'analytics', path: '#/analytics' },
  { name: 'settings', path: '#/settings' }
];

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
  
  for (const res of resolutions) {
    const context = await browser.newContext({
      viewport: { width: res.width, height: res.height },
      deviceScaleFactor: 1
    });
    const page = await context.newPage();
    
    // Visit root first
    await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    for (const p of pages) {
      await page.goto(`http://127.0.0.1:4173/${p.path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      const filePath = path.join(outDir, `${p.name}-${res.name}.png`);
      await page.screenshot({ path: filePath, fullPage: false });
      console.log(`Saved screenshot: ${filePath}`);
    }
    await context.close();
  }

  await browser.close();
  console.log('All screenshots captured successfully.');
}

main().catch(err => {
  console.error('Error capturing screenshots:', err);
  process.exit(1);
});
