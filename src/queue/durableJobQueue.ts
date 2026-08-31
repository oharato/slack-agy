import { SqliteStore, type PersistedJob } from "../storage/sqliteStore.js";
import { logger } from "../logger/index.js";

export interface DurableJobQueueOptions {
  maxConcurrent?: number;
  leaseMs?: number;
  pollIntervalMs?: number;
}

export interface EnqueueDurableJobParams<TPayload> {
  id?: string;
  threadKey: string;
  type: string;
  payload: TPayload;
  runAfter?: string;
}

export type DurableJobHandler = (job: PersistedJob, signal: AbortSignal) => Promise<void>;

/**
 * SQLite-backed queue for serializable jobs. A job remains queued across a restart;
 * an already running job becomes `interrupted` and needs an explicit user resume.
 */
export class DurableJobQueue {
  private readonly maxConcurrent: number;
  private readonly leaseMs: number;
  private readonly pollIntervalMs: number;
  private readonly handlers = new Map<string, DurableJobHandler>();
  private readonly active = new Map<string, AbortController>();
  private timer: NodeJS.Timeout | undefined;
  private draining = false;

  constructor(
    private readonly store: SqliteStore,
    options: DurableJobQueueOptions = {},
  ) {
    this.maxConcurrent = options.maxConcurrent ?? 2;
    this.leaseMs = options.leaseMs ?? 15 * 60 * 1000;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
  }

  public register(type: string, handler: DurableJobHandler): void {
    if (this.handlers.has(type)) {
      throw new Error(`A durable job handler is already registered for '${type}'`);
    }
    this.handlers.set(type, handler);
  }

  public start(): void {
    const interrupted = this.store.interruptExpiredOrRunningJobs();
    if (interrupted > 0) {
      logger.warn("durable_jobs_interrupted_on_startup", { count: interrupted });
    }
    this.timer = setInterval(() => this.drain(), this.pollIntervalMs);
    this.drain();
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  public enqueue<TPayload>(params: EnqueueDurableJobParams<TPayload>): PersistedJob {
    const id = params.id ?? `job_${crypto.randomUUID()}`;
    const job = this.store.createJob({ ...params, id });
    logger.info("durable_job_enqueued", {
      jobId: job.id,
      threadKey: job.threadKey,
      type: job.type,
    });
    void this.drain();
    return job;
  }

  public cancel(jobId: string): boolean {
    const active = this.active.get(jobId);
    if (active) active.abort();
    const job = this.store.getJob(jobId);
    if (!job || !["queued", "running", "waiting_approval"].includes(job.status)) return false;
    this.store.updateJob(jobId, "cancelled");
    return true;
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.active.size < this.maxConcurrent) {
        const job = this.store.claimNextJob(this.leaseMs);
        if (!job) return;
        const handler = this.handlers.get(job.type);
        if (!handler) {
          this.store.updateJob(job.id, "failed", {
            errorMessage: `No durable job handler registered for '${job.type}'`,
          });
          continue;
        }
        void this.run(job, handler);
      }
    } finally {
      this.draining = false;
    }
  }

  private async run(job: PersistedJob, handler: DurableJobHandler): Promise<void> {
    const controller = new AbortController();
    this.active.set(job.id, controller);
    try {
      await handler(job, controller.signal);
      const current = this.store.getJob(job.id);
      if (current?.status === "running") this.store.updateJob(job.id, "succeeded");
    } catch (error) {
      const current = this.store.getJob(job.id);
      if (current?.status !== "cancelled") {
        this.store.updateJob(job.id, "failed", { errorMessage: String(error) });
      }
    } finally {
      this.active.delete(job.id);
      void this.drain();
    }
  }
}
