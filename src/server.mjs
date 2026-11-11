import http from 'http';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { ROOT, PATHS, ENGINE } from './utils/constants.mjs';
import { atomicWriteJson, readJson, ensureDir } from './utils/file-manager.mjs';
import { validateSettings, loadSettings } from './utils/validators.mjs';
import { acquireAppLock, removeAppLock } from './utils/instance-lock.mjs';
import { Logger } from './services/logger-service.mjs';
import { CheckpointService } from './services/checkpoint-service.mjs';
import { PendingRequestStateService } from './services/pending-request-state.mjs';
import { AccountService } from './services/account-service.mjs';
import { normalizeUsername } from './services/export-parser.mjs';
import { BrowserSessionManager } from './automation/browser-session-manager.mjs';
import { AutomationController } from './automation/automation-controller.mjs';
import { PendingRequestCancellationEngine } from './automation/pending-request-cancellation.mjs';
import { PairingService } from './services/pairing-service.mjs';
import { CentralJobOrchestrator, JOB_TYPES, JOB_STATUS } from './automation/central-orchestrator.mjs';
import { PostArchiveService } from './services/post-archive-service.mjs';
import { StoriesHighlightsService } from './services/stories-highlights-service.mjs';
import { FollowersIntelligenceService } from './services/followers-intelligence-service.mjs';
import { ProfileSyncService } from './services/profile-sync-service.mjs';
import { WhitelistService } from './services/whitelist-service.mjs';
import { ProfileMetadataService } from './services/profile-metadata-service.mjs';
import { VipScannerEngine } from './automation/vip-scanner.mjs';

const PORT = Number(process.env.PORT) || 4173;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function createApp({ dataDir = PATHS.data, logsDir = PATHS.logs, ig, testSettings, onShutdown } = {}) {
  ensureDir(dataDir);
  const logger = new Logger(logsDir);
  const whitelist = new WhitelistService(path.join(dataDir, 'whitelist.json'));
  const profileMeta = new ProfileMetadataService(path.join(dataDir, 'profile-metadata.json'));
  const checkpoints = {
    unfollow: new CheckpointService(path.join(dataDir, 'execution-state.json')),
    cancel: new PendingRequestStateService(path.join(dataDir, 'pending-request-state.json')),
    follow: new CheckpointService(path.join(dataDir, 'follow-execution-state.json'))
  };
  const accounts = new AccountService(path.join(dataDir, 'import.json'), checkpoints, whitelist, profileMeta);
  const pairing = new PairingService(path.join(dataDir, 'pairing.json'));
  const settingsFile = path.join(dataDir, 'settings.json');
  const loaded = loadSettings(readJson(settingsFile, {}));
  let settings = loaded.settings;
  loaded.notes.forEach(n => logger.warn(n));
  if (testSettings) settings = { ...settings, ...testSettings };   // tests only: allows values below the UI minimums
  const session = ig || new BrowserSessionManager({ logger, channel: settings.browserChannel, lockFile: path.join(dataDir, '.browser.lock') });
  const engines = {
    unfollow: new AutomationController({ ig: session, checkpoint: checkpoints.unfollow, logger, getSettings: () => settings, job: 'unfollow', whitelist, profileMeta }),
    cancel: new PendingRequestCancellationEngine({ ig: session, checkpoint: checkpoints.cancel, logger, getSettings: () => settings, accountService: accounts, whitelist }),
    follow: new AutomationController({ ig: session, checkpoint: checkpoints.follow, logger, getSettings: () => settings, job: 'follow', whitelist, profileMeta }),
  };
  const vipScanner = new VipScannerEngine({ ig: session, profileMeta, whitelist, logger, getSettings: () => settings });
  const orchestrator = new CentralJobOrchestrator({
    queueFile: path.join(dataDir, 'central-queue-state.json'),
    auditFile: path.join(dataDir, 'audit-history.json'),
    engines,
    logger
  });
  const postArchive = new PostArchiveService(path.join(dataDir, 'post-archive.json'));
  const profileSync = new ProfileSyncService({ session, postArchive, dataDir, logger });
  const storiesHighlights = new StoriesHighlightsService(path.join(dataDir, 'stories-highlights.json'));
  const intelligence = new FollowersIntelligenceService(accounts, checkpoints);
  let lastJob = 'unfollow';
  const activeEngine = () => Object.values(engines).find(e => e.active);

  // one-time migration of the old done.json
  const old = [path.join(dataDir, 'done.json'), path.join(ROOT, 'done.json')].find(f => fs.existsSync(f));
  if (old) { const n = checkpoints.unfollow.importDone(readJson(old, [])); if (n) logger.info(`Imported ${n} accounts from the old done.json.`); }
  for (const [job, cp] of Object.entries(checkpoints)) { const n = cp.recoverInterrupted(); if (n) logger.warn(`${n} ${job} account(s) were interrupted by the last shutdown and are queued again.`); }

  const clients = new Set();
  const send = (event, data) => { const m = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(m); };
  for (const [job, e] of Object.entries(engines)) {
    e.on('state', s => { lastJob = job; send('state', s); });
    e.on('account', a => send('account', { ...a, job }));
  }
  orchestrator.on('queueUpdated', q => send('queue', q));
  logger.on('log', e => send('log', e));
  vipScanner.on('state', s => send('vipScanner', s));
  vipScanner.on('scanned', a => send('vipScanned', a));

  const shownEngine = () => activeEngine() || engines[lastJob];
  const state = async () => ({
    engine: shownEngine().snapshot(), engines: Object.fromEntries(Object.entries(engines).map(([k, e]) => [k, e.snapshot()])),
    settings, kpis: accounts.kpis(), summary: accounts.summary(),
    browser: (await session.health?.()) || { open: !!session.open, browser: session.open ? 'connected' : 'closed', tabs: [], session: { state: 'UNVERIFIED' } },
    queue: orchestrator.getSnapshot(),
    pairing: pairing.getStatus(),
    intelligence: intelligence.getIntelligence(),
    profile: profileSync.getProfile(),
    postArchive: postArchive.summary(),
    storiesHighlights: storiesHighlights.summary(),
    whitelist: whitelist.list(),
    vipScanner: vipScanner.snapshot(),
    influencersSummary: profileMeta.summary()
  });

  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const body = (req, limit = 80e6) => new Promise((ok, bad) => {
    const parts = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { bad(new Error('Body too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => ok(Buffer.concat(parts).toString('utf8')));
    req.on('error', bad);
  });
  const opts = () => ({ navTimeout: settings.navigationTimeoutSec * 1000, elementTimeout: settings.elementTimeoutSec * 1000 });

  /** Start a job. Only ONE automation may run at a time, whichever kind it is. */
  async function startJob(job, usernames, includeRetry = false, order = 'oldest') {
    const busy = activeEngine();
    if (busy) throw new Error(`Another automation is already running (${busy.job.name}, ${busy.status.toLowerCase().replace('_', ' ')}).`);
    return engines[job].start(usernames, { includeRetry, order });
  }

  async function api(req, res, url) {
    const q = Object.fromEntries(url.searchParams);
    const route = `${req.method} ${url.pathname}`;
    switch (route) {
      case 'GET /api/ping': return json(res, 200, {
        app: 'nofollow-web',
        pid: process.pid,
        status: 'ok',
        version: '2.0.0',
        pairing: {
          paired: pairing.getStatus().paired,
          activeSessions: pairing.getStatus().activeSessions
        }
      });
      case 'GET /api/health': return json(res, 200, {
        status: 'ok',
        app: 'nofollow-web',
        pid: process.pid,
        uptime: process.uptime(),
        browser: (await session.health?.()) || { open: !!session.open, browser: session.open ? 'connected' : 'closed', tabs: [], session: { state: 'UNVERIFIED' } },
        pairing: pairing.getStatus()
      });
      case 'GET /api/pairing/status': return json(res, 200, pairing.getStatus());
      case 'POST /api/pairing/pair': {
        const b = JSON.parse(await body(req));
        if (!pairing.verifyPin(b.pin)) {
          return json(res, 400, { error: 'Invalid or expired pairing PIN. Check the console or local dashboard.' });
        }
        const sess = pairing.createSession({ origin: req.headers.origin, userAgent: req.headers['user-agent'] });
        return json(res, 200, { ok: true, token: sess.token, expiresAt: sess.expiresAt });
      }
      case 'POST /api/pairing/revoke': {
        const auth = req.headers.authorization;
        if (auth) pairing.revokeSession(auth);
        return json(res, 200, { ok: true });
      }
      case 'POST /api/pairing/code': return json(res, 200, { pin: pairing.getOrCreatePin() });
      case 'GET /api/queue': return json(res, 200, orchestrator.getSnapshot());
      case 'POST /api/queue/create': {
        const b = JSON.parse(await body(req));
        const job = orchestrator.createJob({
          type: b.type,
          title: b.title,
          usernames: b.usernames,
          options: b.options,
          approved: b.confirm === true
        });
        return json(res, 200, job);
      }
      case 'POST /api/queue/approve': {
        const b = JSON.parse(await body(req));
        return json(res, 200, orchestrator.approveJob(b.jobId));
      }
      case 'POST /api/queue/pause': return json(res, 200, orchestrator.pauseActive() || { ok: true });
      case 'POST /api/queue/resume': return json(res, 200, (await orchestrator.resumeActive()) || { ok: true });
      case 'POST /api/queue/stop': return json(res, 200, orchestrator.stopActive() || { ok: true });
      case 'POST /api/queue/cancel': {
        const b = JSON.parse(await body(req));
        return json(res, 200, orchestrator.cancelJob(b.jobId));
      }
      case 'GET /api/audit': return json(res, 200, orchestrator.getAuditHistory(Number(q.limit || 100)));
      case 'GET /api/intelligence': return json(res, 200, intelligence.getIntelligence());
      case 'GET /api/profile': return json(res, 200, profileSync.getProfile());
      case 'POST /api/profile/sync': {
        try {
          const synced = await profileSync.syncProfile();
          return json(res, 200, synced);
        } catch (e) {
          logger.error(`Profile sync error: ${e.message}`, { error: e.message });
          return json(res, 400, { error: e.message });
        }
      }
      case 'GET /api/posts': return json(res, 200, postArchive.getPosts(q));
      case 'POST /api/posts/archive': {
        const b = JSON.parse(await body(req));
        if (b.confirm !== true) return json(res, 400, { error: 'Confirmation required before archiving posts.' });
        const job = orchestrator.createJob({
          type: 'archive',
          title: `Archive Post ${b.postId}`,
          usernames: [b.postId],
          approved: true
        });
        return json(res, 200, job);
      }
      case 'GET /api/stories': return json(res, 200, storiesHighlights.getStories(q));
      case 'GET /api/highlights': return json(res, 200, storiesHighlights.getHighlights());
      case 'GET /api/state': return json(res, 200, await state());
      case 'GET /api/accounts': return json(res, 200, accounts.query({ ...q, ids: q.ids === '1' }));
      case 'GET /api/history': return json(res, 200, Object.values(checkpoints).flatMap(c => c.state.runs).sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
      case 'GET /api/logs': return json(res, 200, logger.recent.slice(-Number(q.n || 200)));
      case 'GET /api/tabs': return json(res, 200, (await session.health?.())?.tabs || []);
      case 'GET /api/cancel/preview': {
        const olderThanDays = +q.olderThanDays || 0;
        const all = accounts.list('pending'); const eligible = accounts.cancelEligible({ olderThanDays });
        const cancelKpis = accounts.kpis()?.cancel || {};
        return json(res, 200, {
          total: all.length,
          imported: cancelKpis.imported ?? all.length,
          eligible: eligible.length,
          alreadyDone: all.length - eligible.length,
          cancelled: cancelKpis.cancelled ?? 0,
          alreadyCancelled: cancelKpis.alreadyCancelled ?? 0,
          accepted: cancelKpis.accepted ?? 0,
          unavailable: cancelKpis.unavailable ?? 0,
          needsReview: cancelKpis.needsReview ?? 0,
          failed: cancelKpis.failed ?? 0,
          remaining: cancelKpis.remaining ?? eligible.length,
          order: 'OLDEST_FIRST',
          olderThanDays,
          oldestUser: eligible[0] || null,
          oldestDate: eligible[0] && accounts.model?.requestDates?.[eligible[0]] ? new Date(accounts.model.requestDates[eligible[0]]).toISOString() : null
        });
      }
      case 'GET /api/report': {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="nofollow-error-report.json"' });
        const bad = Object.entries(checkpoints).flatMap(([job, c]) => Object.values(c.state.accounts).filter(a => ['FAILED', 'NEEDS_REVIEW', 'PROFILE_UNAVAILABLE', 'ACTION_BLOCKED'].includes(a.status)).map(a => ({ job, ...a })));
        return res.end(JSON.stringify({ generatedAt: new Date().toISOString(), accounts: bad, log: logger.errorReport() }, null, 1));
      }
      case 'GET /api/whitelist': return json(res, 200, whitelist.list());
      case 'POST /api/whitelist/add': {
        const b = JSON.parse(await body(req));
        if (Array.isArray(b.usernames)) {
          return json(res, 200, whitelist.addMany(b.usernames));
        }
        return json(res, 200, whitelist.add(b.username));
      }
      case 'POST /api/whitelist/remove': {
        const b = JSON.parse(await body(req));
        if (Array.isArray(b.usernames)) {
          return json(res, 200, whitelist.removeMany(b.usernames));
        }
        return json(res, 200, whitelist.remove(b.username));
      }
      case 'POST /api/whitelist/toggle': {
        const u = JSON.parse(await body(req)).username;
        return json(res, 200, whitelist.toggle(u));
      }
      case 'POST /api/whitelist/clear': {
        return json(res, 200, whitelist.clear());
      }
      case 'GET /api/influencers': {
        return json(res, 200, {
          summary: profileMeta.summary(),
          profiles: profileMeta.query({
            q: q.q || '',
            verified: q.verified === '1',
            minFollowers: +q.minFollowers || 0,
            minRatio: +q.minRatio || 0,
            sort: q.sort || 'followers',
            dir: q.dir || 'desc'
          })
        });
      }
      case 'POST /api/scan/vip/start': {
        const b = JSON.parse(await body(req));
        let list = b.usernames;
        if (!list || !list.length) {
          const listKind = b.list || 'following';
          list = accounts.list(listKind);
        }
        const totalInList = list.length;
        const rescanAll = !!b.rescanAll;
        if (!rescanAll) {
          list = list.filter(u => !profileMeta.has(u));
          const skipped = totalInList - list.length;
          if (skipped > 0) logger.info(`VIP Scanner: skipping ${skipped} already-scanned profiles. ${list.length} unscanned remaining.`);
        }
        const limit = +b.limit || 0;
        if (limit > 0) list = list.slice(0, limit);
        if (!list.length) {
          return json(res, 200, { ok: true, total: 0, skipped: totalInList, message: 'All profiles in this list have already been scanned!' });
        }
        vipScanner.scan(list, {
          intervalSec: +b.intervalSec || 3,
          autoWhitelistVerified: !!b.autoWhitelistVerified,
          autoWhitelistMin: +b.autoWhitelistMin || 0
        }).catch(e => logger.error(`VIP Scanner error: ${e.message}`));
        return json(res, 200, { ok: true, total: list.length, skipped: totalInList - list.length });
      }
      case 'POST /api/scan/vip/queue': {
        const b = JSON.parse(await body(req));
        const usernames = (b.usernames || []).map(normalizeUsername).filter(Boolean);
        const resQueue = vipScanner.enqueue(usernames);
        return json(res, 200, { ok: true, ...resQueue });
      }
      case 'POST /api/scan/vip/stop': {
        vipScanner.stop();
        return json(res, 200, { ok: true });
      }
      case 'POST /api/whitelist/bulk-by-criteria': {
        const b = JSON.parse(await body(req));
        const minFollowers = +b.minFollowers || 0;
        const minRatio = +b.minRatio || 0;
        const verifiedOnly = !!b.verified;
        const matches = profileMeta.query({ verified: verifiedOnly, minFollowers, minRatio });
        const usernames = matches.map(m => m.username);
        if (!usernames.length) return json(res, 400, { error: 'No scanned profiles matched the criteria.' });
        const resWl = whitelist.addMany(usernames);
        return json(res, 200, { ok: true, added: resWl.addedCount, total: resWl.total });
      }
      case 'GET /api/export/csv': {
        const targetJob = q.job;
        const entries = [];
        const targets = targetJob && checkpoints[targetJob] ? { [targetJob]: checkpoints[targetJob] } : checkpoints;
        for (const [j, cp] of Object.entries(targets)) {
          for (const a of Object.values(cp.state.accounts || {})) {
            entries.push({
              job: j,
              username: a.username,
              status: a.status,
              previousStatus: a.previousStatus || '',
              reason: (a.reason || '').replace(/"/g, '""'),
              attempts: a.attempts || 1,
              lastAttemptAt: a.lastAttemptAt || ''
            });
          }
        }
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="nofollow-actions-export.csv"'
        });
        const header = 'Job,Username,Status,PreviousStatus,Reason,Attempts,LastAttemptAt\n';
        const rows = entries.map(e => `"${e.job}","${e.username}","${e.status}","${e.previousStatus}","${e.reason}",${e.attempts},"${e.lastAttemptAt}"`).join('\n');
        return res.end(header + rows);
      }
      case 'POST /api/import/file': {
        const name = q.name; if (!name) return json(res, 400, { error: 'name required' });
        return json(res, 200, accounts.addFile(path.basename(name), await body(req)));
      }
      case 'POST /api/import/commit': return json(res, 200, accounts.commit());
      case 'GET /api/export/diff': {
        return json(res, 200, {
          latest: accounts.getLatestDiff(),
          history: accounts.getDiffHistory()
        });
      }
      case 'POST /api/export/diff/clear': {
        return json(res, 200, accounts.clearDiffHistory());
      }
      case 'GET /api/export/diff/csv': {
        const diff = accounts.getLatestDiff();
        if (!diff) return json(res, 404, { error: 'No export diff available yet.' });
        const rows = [
          'ChangeType,Username,DetectedAt'
        ];
        for (const u of diff.lostFollowers || []) rows.push(`"UNFOLLOWED_YOU","${u}","${diff.timestamp}"`);
        for (const u of diff.gainedFollowers || []) rows.push(`"NEW_FOLLOWER","${u}","${diff.timestamp}"`);
        for (const u of diff.unfollowedByYou || []) rows.push(`"UNFOLLOWED_BY_YOU","${u}","${diff.timestamp}"`);
        for (const u of diff.newFollowing || []) rows.push(`"NEW_FOLLOWING","${u}","${diff.timestamp}"`);
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="who-unfollowed-me-diff.csv"'
        });
        return res.end(rows.join('\n'));
      }
      case 'POST /api/settings': {
        const r = validateSettings(JSON.parse(await body(req)), settings);
        if (r.errors.length) return json(res, 400, { error: r.errors.join(' ') });
        settings = r.settings; atomicWriteJson(settingsFile, settings);
        logger.info(`Settings saved: interval ${settings.actionIntervalSec} s, navigation timeout ${settings.navigationTimeoutSec} s, element timeout ${settings.elementTimeoutSec} s, retries ${settings.maxAttempts}.`);
        for (const e of Object.values(engines)) e.emit('state', e.snapshot());
        return json(res, 200, settings);
      }
      case 'POST /api/browser/open': await session.ensureBrowser(); await session.openLogin?.(); return json(res, 200, await state());
      case 'POST /api/session/verify': {
        const busy = activeEngine();
        if (busy && busy.status === ENGINE.RUNNING) return json(res, 409, { error: 'The automation is running. Pause it first; Resume verifies the login by itself.' });
        if (busy) return json(res, 409, { error: 'Use Resume: it verifies the login before continuing.' });
        return json(res, 200, await session.verifySession(opts()));
      }
      case 'POST /api/tabs/open': {
        const u = normalizeUsername(JSON.parse(await body(req)).username);
        if (!u) return json(res, 400, { error: 'Invalid username.' });
        return json(res, 200, await session.openManualTab(`https://www.instagram.com/${u}/`));
      }
      case 'POST /api/run/start': {
        const b = JSON.parse(await body(req));
        if (b.confirm !== true) return json(res, 400, { error: 'Confirmation required.' });
        const job = ['cancel', 'follow'].includes(b.mode) ? b.mode : 'unfollow';
        const order = b.order || 'oldest';
        let list = [];

        if (b.custom || job === 'follow') {
          list = Array.from(new Set((b.usernames || []).map(normalizeUsername).filter(Boolean)));
          if (!list.length) return json(res, 400, { error: 'No valid usernames provided in the custom list.' });
        } else if (job === 'cancel') {
          if (!accounts.sets) return json(res, 400, { error: 'Import your data first.' });
          const outgoing = new Set(accounts.list('pending'));   // only requests YOU sent; incoming requests and followings are never touched
          const olderThanDays = +b.olderThanDays || 0;
          list = b.all ? accounts.cancelEligible({ olderThanDays }) : (b.usernames || []).map(normalizeUsername).filter(u => outgoing.has(u));
          const dates = accounts.model?.requestDates || {};
          const isNewest = /new(est)?/i.test(order);
          list.sort((a, b) => isNewest ? (dates[b] || 0) - (dates[a] || 0) : (dates[a] || 0) - (dates[b] || 0));
        } else {
          if (!accounts.sets) return json(res, 400, { error: 'Import your data first.' });
          if (b.list === 'diffStillFollowing') {
            list = accounts.list('diffStillFollowing').filter(u => accounts.sets.following.has(u));
          } else {
            list = (b.usernames || []).map(normalizeUsername).filter(u => accounts.sets.following.has(u));   // can only unfollow accounts you follow
          }
        }
        if (job === 'unfollow' || job === 'cancel') {
          list = list.filter(u => !whitelist.has(u));
        }
        return json(res, 200, await startJob(job, list, !!b.includeRetry, order));
      }
      case 'POST /api/run/retry-failed': {
        const mode = JSON.parse(await body(req) || '{}').mode;
        const job = ['cancel', 'follow'].includes(mode) ? mode : 'unfollow';
        const cp = checkpoints[job];
        const list = Object.values(cp.state.accounts).filter(a => ['FAILED', 'NEEDS_REVIEW'].includes(a.status)).map(a => a.username);
        for (const u of list) cp.set(u, { status: 'RETRY_PENDING', reason: 'retry requested' });
        return json(res, 200, await startJob(job, list));
      }
      case 'POST /api/run/pause': activeEngine()?.pause(); return json(res, 200, shownEngine().snapshot());
      case 'POST /api/run/resume': { const e = activeEngine(); if (e) await e.resume(); return json(res, 200, shownEngine().snapshot()); }
      case 'POST /api/run/stop': activeEngine()?.stop(); return json(res, 200, shownEngine().snapshot());
      case 'POST /api/run/reset': {
        if (activeEngine()) return json(res, 409, { error: 'Stop the run first.' });
        const mode = JSON.parse(await body(req) || '{}').mode;
        const job = ['cancel', 'follow'].includes(mode) ? mode : 'unfollow';
        checkpoints[job].reset(); return json(res, 200, { ok: true });
      }
      case 'POST /api/shutdown': {
        json(res, 200, { ok: true });
        setTimeout(() => onShutdown?.(), 100);
        return;
      }
      default: return json(res, 404, { error: 'Not found' });
    }
  }

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const isLoopbackHost = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '');

    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-NoFollow');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    try {
      if (!isLoopbackHost && !origin) return json(res, 403, { error: 'Bad host' });
      if (url.pathname.startsWith('/api/')) {
        const isCrossOrigin = origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
        if (isCrossOrigin) {
          const publicRoutes = ['GET /api/ping', 'GET /api/health', 'GET /api/pairing/status', 'POST /api/pairing/pair'];
          const routeKey = `${req.method} ${url.pathname}`;
          if (!publicRoutes.includes(routeKey)) {
            const token = req.headers.authorization;
            if (!token || !pairing.validateToken(token)) {
              return json(res, 401, { error: 'Unauthorized: Pairing session required. Please connect with your local PIN.' });
            }
          }
        }
        if (req.method === 'POST' && req.headers['x-nofollow'] !== '1') return json(res, 403, { error: 'Missing header' });
        if (url.pathname === '/api/events') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            ...(origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' } : {})
          });
          res.write(': ok\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
        }
        return await api(req, res, url);
      }
      let rel = decodeURIComponent(url.pathname); if (rel === '/') rel = '/index.html';
      const file = path.join(ROOT, rel);
      const allowed = rel === '/index.html' || rel.startsWith('/assets/') || rel.startsWith('/pages/') || (rel.startsWith('/shots/') && fs.existsSync(path.join(PATHS.logs, rel)));
      if (!allowed || !path.resolve(file).startsWith(ROOT)) return json(res, 404, { error: 'Not found' });
      const target = rel.startsWith('/shots/') ? path.join(PATHS.logs, rel) : file;
      fs.readFile(target, (e, buf) => {
        if (e) return json(res, 404, { error: 'Not found' });
        res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(buf);
      });
    } catch (e) {
      logger.error(`API error ${req.method} ${url.pathname}: ${e.message}`, { error: e.message });
      json(res, /already|Another automation|Nothing to do|Pause it first|Use Resume/.test(e.message) ? 409 : e.code === 'BROWSER_LAUNCH' ? 503 : 500, { error: e.message });
    }
  });

  return { server, engines, engine: engines.unfollow, checkpoints, checkpoint: checkpoints.unfollow, accounts, logger, session, pairing, orchestrator, postArchive, storiesHighlights, intelligence, profileSync, getSettings: () => settings };
}

const openUrl = url => { if (!process.env.NO_OPEN) exec(`start "" "${url}"`); };

async function pingHolder(port) {
  for (let i = 0; i < 4; i++) {          // a busy or just-started instance may need a moment to answer
    try { const r = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(2000) }); if ((await r.json()).app === 'nofollow-web') return true; } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
}
const portOpen = port => new Promise(res => { const s = net.connect({ port, host: '127.0.0.1' }, () => { s.destroy(); res(true); }); s.on('error', () => res(false)); s.setTimeout(1500, () => { s.destroy(); res(false); }); });

export async function main() {
  const lockFile = path.join(PATHS.data, '.app.lock');
  let lock = acquireAppLock(lockFile, { port: PORT });
  if (!lock.ok && lock.holder) {
    const h = lock.holder, url = `http://127.0.0.1:${h.port}`;
    if (await pingHolder(h.port)) {
      console.log(`
  NoFollow Web is already running on this machine (pid ${h.pid}).
  Opening the existing dashboard instead: ${url}
`);
      openUrl(url);
      process.exit(0);
    }
    if (await portOpen(h.port)) {          // the holder is alive and its port is open: never take its lock
      console.error(`
  NoFollow Web is already running on this machine (pid ${h.pid}) but did not answer. Open ${url} or end that process first.
`);
      process.exit(1);
    }
    removeAppLock(lockFile);               // process id alive, but nothing listens: a stale lock (pid reused by another program)
    lock = acquireAppLock(lockFile, { port: PORT });
  }
  if (!lock.ok) { console.error('Could not take the application lock. Delete data\.app.lock if no NoFollow Web is running.'); process.exit(1); }

  let app, down = false;
  const shutdown = async () => {
    if (down) return; down = true;
    try { if (app) { for (const e of Object.values(app.engines)) if (e.active) { e.stop(); } await new Promise(r => setTimeout(r, 1200)); await app.session.close(); app.server.closeAllConnections?.(); app.server.close(); } } finally { lock.release(); process.exit(0); }
  };
  app = createApp({ onShutdown: shutdown });
  process.on('unhandledRejection', e => app.logger.error(`Unhandled rejection: ${e?.message || e}`, { error: String(e?.message || e) }));
  app.server.on('error', e => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is used by another program (not NoFollow Web). Set a different port: $env:PORT=4180; node unfollow.mjs` : e.message);
    lock.release(); process.exit(1);
  });
  app.server.listen(PORT, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${PORT}`;
    const pin = app.pairing.getOrCreatePin();
    app.logger.info(`NoFollow Web running at ${url}`);
    console.log(`\n  ==============================================================`);
    console.log(`  NoFollow Web Local Agent: ${url}`);
    console.log(`  Pairing PIN for Vercel Dashboard: ${pin}`);
    console.log(`  Press Ctrl+C to stop cleanly.`);
    console.log(`  ==============================================================\n`);
    openUrl(url);
  });
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown); process.on('exit', () => lock.release());
}
