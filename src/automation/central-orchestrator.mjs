import EventEmitter from 'events';
import crypto from 'crypto';
import path from 'path';
import { readJson, atomicWriteJson } from '../utils/file-manager.mjs';

export const JOB_STATUS = {
  QUEUED: 'QUEUED',
  APPROVED: 'APPROVED',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  STOPPED: 'STOPPED',
  INTERRUPTED: 'INTERRUPTED'
};

export const JOB_TYPES = {
  UNFOLLOW: 'unfollow',
  CANCEL: 'cancel',
  ARCHIVE: 'archive',
  STORY_HIGHLIGHTS: 'story_highlights'
};

/**
 * Central Job Orchestrator enforcing:
 * 1. Single Mutating Worker rule (only 1 job active at any time).
 * 2. Explicit User Approval rule (mutations require approval before execution).
 * 3. Crash recovery & audit history.
 */
export class CentralJobOrchestrator extends EventEmitter {
  constructor({ queueFile, auditFile, engines = {}, logger }) {
    super();
    this.queueFile = queueFile;
    this.auditFile = auditFile;
    this.engines = engines; // { unfollow, cancel, archive, story_highlights }
    this.logger = logger;
    this.activeJobId = null;
    this.state = this.loadQueue();
    this.auditHistory = this.loadAudit();
    this.recoverInterrupted();
  }

  loadQueue() {
    const s = readJson(this.queueFile, null);
    if (s && Array.isArray(s.jobs)) return s;
    return { version: 1, activeJobId: null, jobs: [] };
  }

  saveQueue() {
    atomicWriteJson(this.queueFile, {
      version: 1,
      activeJobId: this.activeJobId,
      jobs: this.state.jobs
    });
  }

  loadAudit() {
    const s = readJson(this.auditFile, null);
    if (s && Array.isArray(s.history)) return s;
    return { version: 1, history: [] };
  }

  logAudit(action, details = {}) {
    const entry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      action,
      ...details
    };
    this.auditHistory.history.unshift(entry);
    if (this.auditHistory.history.length > 500) {
      this.auditHistory.history.length = 500;
    }
    atomicWriteJson(this.auditFile, this.auditHistory);
    this.logger?.info(`[Audit] ${action}: ${JSON.stringify(details)}`);
  }

  recoverInterrupted() {
    let recovered = 0;
    for (const job of this.state.jobs) {
      if (job.status === JOB_STATUS.RUNNING) {
        job.status = JOB_STATUS.INTERRUPTED;
        job.endedAt = new Date().toISOString();
        job.reason = 'Interrupted by system restart';
        recovered++;
        this.logAudit('JOB_INTERRUPTED_RECOVERED', { jobId: job.id, type: job.type });
      }
    }
    this.activeJobId = null;
    if (recovered > 0) {
      this.saveQueue();
    }
  }

  /**
   * Enqueues a new job.
   * If approved: true, the job is marked APPROVED and eligible for execution.
   * If approved: false, the job waits in QUEUED state until approved.
   */
  createJob({ type, title, usernames = [], options = {}, approved = false }) {
    if (!Object.values(JOB_TYPES).includes(type)) {
      throw new Error(`Unsupported job type: ${type}`);
    }

    const job = {
      id: crypto.randomUUID(),
      type,
      title: title || `${type.toUpperCase()} Batch (${usernames.length} accounts)`,
      usernames: Array.from(new Set(usernames.map(u => String(u).trim().toLowerCase()))),
      options,
      status: approved ? JOB_STATUS.APPROVED : JOB_STATUS.QUEUED,
      createdAt: new Date().toISOString(),
      approvedAt: approved ? new Date().toISOString() : null,
      startedAt: null,
      endedAt: null,
      progress: { total: usernames.length, processed: 0, successful: 0, failed: 0 },
      error: null
    };

    this.state.jobs.unshift(job);
    this.saveQueue();
    this.logAudit('JOB_CREATED', { jobId: job.id, type: job.type, count: job.usernames.length, approved });
    this.emit('queueUpdated', this.getSnapshot());

    if (approved && !this.activeJobId) {
      this.processNext();
    }

    return job;
  }

  /**
   * Approves a queued job. Required before any mutation can run.
   */
  approveJob(jobId) {
    const job = this.state.jobs.find(j => j.id === jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    if (job.status !== JOB_STATUS.QUEUED) {
      throw new Error(`Job is not in QUEUED state (current: ${job.status})`);
    }

    job.status = JOB_STATUS.APPROVED;
    job.approvedAt = new Date().toISOString();
    this.saveQueue();
    this.logAudit('JOB_APPROVED', { jobId: job.id, type: job.type });
    this.emit('queueUpdated', this.getSnapshot());

    if (!this.activeJobId) {
      this.processNext();
    }

    return job;
  }

  /**
   * Worker loop: executes the next APPROVED job.
   */
  async processNext() {
    if (this.activeJobId) return; // Single mutating worker rule

    const nextJob = this.state.jobs
      .slice()
      .reverse()
      .find(j => j.status === JOB_STATUS.APPROVED);

    if (!nextJob) return;

    const engine = this.engines[nextJob.type];
    if (!engine) {
      nextJob.status = JOB_STATUS.FAILED;
      nextJob.error = `No execution engine registered for job type: ${nextJob.type}`;
      this.saveQueue();
      this.emit('queueUpdated', this.getSnapshot());
      return;
    }

    this.activeJobId = nextJob.id;
    nextJob.status = JOB_STATUS.RUNNING;
    nextJob.startedAt = new Date().toISOString();
    this.saveQueue();
    this.logAudit('JOB_STARTED', { jobId: nextJob.id, type: nextJob.type });
    this.emit('queueUpdated', this.getSnapshot());

    try {
      // Execute the job through its registered engine
      await engine.start(nextJob.usernames, nextJob.options);
      
      // Wait until the engine finishes
      const checkDone = () => {
        if (!engine.active) {
          nextJob.status = JOB_STATUS.COMPLETED;
          nextJob.endedAt = new Date().toISOString();
          const snap = engine.snapshot ? engine.snapshot() : {};
          nextJob.progress.processed = snap.processed || nextJob.usernames.length;
          nextJob.progress.successful = snap.unfollowed || snap.successful || 0;
          this.activeJobId = null;
          this.saveQueue();
          this.logAudit('JOB_COMPLETED', { jobId: nextJob.id, progress: nextJob.progress });
          this.emit('queueUpdated', this.getSnapshot());
          // Check for next job
          this.processNext();
        } else {
          setTimeout(checkDone, 20);
        }
      };
      setTimeout(checkDone, 20);
    } catch (err) {
      nextJob.status = JOB_STATUS.FAILED;
      nextJob.endedAt = new Date().toISOString();
      nextJob.error = err.message;
      this.activeJobId = null;
      this.saveQueue();
      this.logAudit('JOB_FAILED', { jobId: nextJob.id, error: err.message });
      this.emit('queueUpdated', this.getSnapshot());
    }
  }

  pauseActive() {
    if (!this.activeJobId) return null;
    const job = this.state.jobs.find(j => j.id === this.activeJobId);
    if (!job) return null;

    const engine = this.engines[job.type];
    engine?.pause();
    job.status = JOB_STATUS.PAUSED;
    this.saveQueue();
    this.logAudit('JOB_PAUSED', { jobId: job.id });
    this.emit('queueUpdated', this.getSnapshot());
    return job;
  }

  async resumeActive() {
    if (!this.activeJobId) {
      // Check if there is a paused job
      const paused = this.state.jobs.find(j => j.status === JOB_STATUS.PAUSED);
      if (paused) {
        this.activeJobId = paused.id;
        paused.status = JOB_STATUS.RUNNING;
        const engine = this.engines[paused.type];
        await engine?.resume();
        this.saveQueue();
        this.logAudit('JOB_RESUMED', { jobId: paused.id });
        this.emit('queueUpdated', this.getSnapshot());
        return paused;
      }
      return null;
    }
    const job = this.state.jobs.find(j => j.id === this.activeJobId);
    if (job) {
      const engine = this.engines[job.type];
      await engine?.resume();
      job.status = JOB_STATUS.RUNNING;
      this.saveQueue();
      this.logAudit('JOB_RESUMED', { jobId: job.id });
      this.emit('queueUpdated', this.getSnapshot());
    }
    return job;
  }

  stopActive() {
    if (!this.activeJobId) return null;
    const job = this.state.jobs.find(j => j.id === this.activeJobId);
    if (!job) return null;

    const engine = this.engines[job.type];
    engine?.stop();
    job.status = JOB_STATUS.STOPPED;
    job.endedAt = new Date().toISOString();
    this.activeJobId = null;
    this.saveQueue();
    this.logAudit('JOB_STOPPED', { jobId: job.id });
    this.emit('queueUpdated', this.getSnapshot());
    return job;
  }

  cancelJob(jobId) {
    if (this.activeJobId === jobId) {
      return this.stopActive();
    }
    const job = this.state.jobs.find(j => j.id === jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    job.status = JOB_STATUS.STOPPED;
    job.endedAt = new Date().toISOString();
    job.reason = 'Cancelled by user before execution';
    this.saveQueue();
    this.logAudit('JOB_CANCELLED', { jobId: job.id });
    this.emit('queueUpdated', this.getSnapshot());
    return job;
  }

  getSnapshot() {
    return {
      activeJobId: this.activeJobId,
      isBusy: !!this.activeJobId,
      queueLength: this.state.jobs.filter(j => j.status === JOB_STATUS.QUEUED || j.status === JOB_STATUS.APPROVED).length,
      jobs: this.state.jobs.slice(0, 50)
    };
  }

  getAuditHistory(limit = 100) {
    return this.auditHistory.history.slice(0, limit);
  }
}
