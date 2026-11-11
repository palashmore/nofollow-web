#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import http from 'http';
import { normalizeUsername } from '../src/services/export-parser.mjs';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    mode: 'cancel',
    order: 'newest',
    interval: null,
    usernames: [],
    file: null,
    url: 'http://127.0.0.1:4173'
  };

  for (const a of args) {
    if (a.startsWith('--mode=')) opts.mode = a.split('=')[1].toLowerCase();
    else if (a.startsWith('--order=')) opts.order = a.split('=')[1].toLowerCase();
    else if (a.startsWith('--interval=')) opts.interval = Number(a.split('=')[1]);
    else if (a.startsWith('--usernames=')) opts.usernames = a.split('=')[1].split(',').map(s => s.trim());
    else if (a.startsWith('--file=')) opts.file = a.split('=')[1];
    else if (a.startsWith('--url=')) opts.url = a.split('=')[1];
    else if (a === '--help' || a === '-h') {
      console.log(`
NoFollow Web — Custom Target List Runner (CLI)
==============================================
Usage:
  node scripts/run-custom-list.mjs [options]

Options:
  --mode=<follow|cancel|unfollow>   Action to perform (default: cancel)
  --order=<newest|oldest|listed>    Execution order (default: newest)
  --interval=<seconds>              Fixed wait time between actions (e.g. 15)
  --usernames=<u1,u2,u3>            Comma-separated target usernames
  --file=<path>                     Path to .txt or .csv file of handles
  --url=<server_url>                Agent API URL (default: http://127.0.0.1:4173)

Examples:
  node scripts/run-custom-list.mjs --mode=cancel --order=newest --file=targets.txt
  node scripts/run-custom-list.mjs --mode=follow --usernames=natgeo,cristiano --interval=15
  node scripts/run-custom-list.mjs --mode=unfollow --order=oldest --file=old_following.txt
      `);
      process.exit(0);
    }
  }
  return opts;
}

function requestJson(urlStr, method = 'GET', data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const bodyStr = data ? JSON.stringify(data) : null;
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-NoFollow': '1',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...headers
      }
    }, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.error || `HTTP ${res.statusCode}: ${raw}`));
          } else {
            resolve(parsed);
          }
        } catch {
          if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
          else resolve(raw);
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function main() {
  const opts = parseArgs();
  console.log(`\n======================================================`);
  console.log(`  NoFollow Web — Custom Target List Runner`);
  console.log(`======================================================`);

  // 1. Collect usernames
  let rawList = [...opts.usernames];
  if (opts.file) {
    if (!fs.existsSync(opts.file)) {
      console.error(`[Error] File not found: ${opts.file}`);
      process.exit(1);
    }
    const content = fs.readFileSync(opts.file, 'utf8');
    const tokens = content.split(/[\r\n,;\s]+/);
    rawList.push(...tokens);
  }

  const usernames = Array.from(new Set(rawList.map(normalizeUsername).filter(Boolean)));
  if (!usernames.length) {
    console.error(`[Error] No valid usernames found. Provide --usernames="u1,u2" or --file=list.txt.`);
    process.exit(1);
  }

  // 2. Ping agent server
  try {
    const ping = await requestJson(`${opts.url}/api/ping`);
    console.log(`✔ Agent server connected: PID ${ping.pid} (${opts.url})`);
  } catch (e) {
    console.error(`[Error] Could not connect to NoFollow Web server at ${opts.url}.`);
    console.error(`Make sure the application is running: run.bat or node unfollow.mjs`);
    process.exit(1);
  }

  // 3. Optional interval setting
  if (opts.interval && opts.interval >= 2) {
    await requestJson(`${opts.url}/api/settings`, 'POST', { actionIntervalSec: opts.interval });
    console.log(`✔ Action interval configured to ${opts.interval} seconds.`);
  }

  // 4. Confirm plan
  console.log(`\nExecution Plan:`);
  console.log(`  • Mode:      ${opts.mode.toUpperCase()}`);
  console.log(`  • Order:     ${opts.order.toUpperCase()}`);
  console.log(`  • Accounts:  ${usernames.length} targets`);
  console.log(`  • Sample:    ${usernames.slice(0, 5).map(u => '@' + u).join(', ')}${usernames.length > 5 ? ' ...' : ''}`);
  console.log(`\nStarting automation...`);

  try {
    const startRes = await requestJson(`${opts.url}/api/run/start`, 'POST', {
      mode: opts.mode,
      usernames,
      order: opts.order,
      custom: true,
      confirm: true
    });
    console.log(`✔ Job launched (Run ID: ${startRes.runId || 'active'}).`);
  } catch (e) {
    console.error(`[Failed to Start] ${e.message}`);
    process.exit(1);
  }

  // 5. Monitor progress
  let lastProcessed = -1;
  const pollTimer = setInterval(async () => {
    try {
      const state = await requestJson(`${opts.url}/api/state`);
      const engine = state.engines?.[opts.mode] || state.engine;
      if (!engine) return;

      if (engine.processed !== lastProcessed) {
        lastProcessed = engine.processed;
        const op = engine.current ? `@${engine.current} (${engine.operation || 'Working'})` : (engine.operation || engine.status);
        console.log(`[${engine.status}] ${engine.processed}/${engine.selected} processed | ${op}`);
      }

      if (['COMPLETED', 'FAILED', 'IDLE'].includes(engine.status)) {
        clearInterval(pollTimer);
        console.log(`\n======================================================`);
        console.log(`✔ Run Finished with Status: ${engine.status}`);
        console.log(`  • Processed:  ${engine.processed}/${engine.selected}`);
        console.log(`  • Success:    ${engine.unfollowed + (engine.followed || 0)}`);
        console.log(`  • Skipped:    ${engine.alreadyUnfollowed + (engine.alreadyFollowed || 0) + (engine.skipped || 0)}`);
        console.log(`  • Failed:     ${engine.failed}`);
        console.log(`======================================================\n`);
        process.exit(0);
      } else if (engine.status === 'SAFETY_PAUSED') {
        console.log(`\n⚠ RUN PAUSED FOR SAFETY: ${engine.pauseReason}`);
        console.log(`Check browser window and log. Resume from web dashboard http://127.0.0.1:4173`);
        clearInterval(pollTimer);
        process.exit(0);
      }
    } catch (e) {
      // server busy or closing
    }
  }, 2000);
}

main().catch(err => {
  console.error(`[Fatal Error]`, err);
  process.exit(1);
});
