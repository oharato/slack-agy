import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SessionInfo } from "../session/types.js";

export type PersistedJobStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface PersistedJob {
  id: string;
  threadKey: string;
  sequenceNo: number;
  type: string;
  payload: unknown;
  status: PersistedJobStatus;
  runAfter: string;
  leaseExpiresAt?: string;
  attemptCount: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePersistedJobParams {
  id: string;
  threadKey: string;
  type: string;
  payload: unknown;
  runAfter?: string;
}

export interface SqliteStoreOptions {
  dataDir?: string;
  databasePath?: string;
}

type JobRow = Omit<PersistedJob, "payload" | "leaseExpiresAt" | "errorMessage"> & {
  payload_json: string;
  lease_expires_at: string | null;
  error_message: string | null;
  thread_key: string;
  sequence_no: number;
  run_after: string;
  attempt_count: number;
  created_at: string;
  updated_at: string;
};

/**
 * The single persistence boundary for sessions, queued work, and (later) approvals.
 * `DatabaseSync` is intentional: each statement is tiny and never runs while an agent
 * process is active; agent execution itself remains asynchronous.
 */
export class SqliteStore {
  private readonly db: DatabaseSync;
  public readonly databasePath: string;

  constructor(options: SqliteStoreOptions = {}) {
    const dataDir = options.dataDir ?? process.env.DATA_DIR ?? "./data";
    this.databasePath = options.databasePath ?? path.join(dataDir, "bridge.sqlite");
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.db = new DatabaseSync(this.databasePath, { timeout: 5000 });
    this.migrate();
  }

  private migrate(): void {
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        thread_key TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        thread_key TEXT NOT NULL,
        sequence_no INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        run_after TEXT NOT NULL,
        lease_expires_at TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(thread_key, sequence_no)
      )
    `);
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs(status, run_after, thread_key, sequence_no)",
    );
  }

  public getSession(threadKey: string): SessionInfo | undefined {
    const row = this.db
      .prepare("SELECT payload_json FROM sessions WHERE thread_key = ?")
      .get(threadKey) as { payload_json: string } | undefined;
    return row ? (JSON.parse(row.payload_json) as SessionInfo) : undefined;
  }

  public getAllSessions(): SessionInfo[] {
    const rows = this.db
      .prepare("SELECT payload_json FROM sessions ORDER BY updated_at")
      .all() as Array<{
      payload_json: string;
    }>;
    return rows.map((row) => JSON.parse(row.payload_json) as SessionInfo);
  }

  public saveSession(session: SessionInfo): void {
    this.db
      .prepare(
        `INSERT INTO sessions(thread_key, status, payload_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(thread_key) DO UPDATE SET
           status = excluded.status,
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`,
      )
      .run(session.threadKey, session.status, JSON.stringify(session), session.updatedAt);
  }

  public deleteSession(threadKey: string): boolean {
    return this.db.prepare("DELETE FROM sessions WHERE thread_key = ?").run(threadKey).changes > 0;
  }

  public createJob(params: CreatePersistedJobParams): PersistedJob {
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const sequenceRow = this.db
        .prepare(
          "SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_sequence FROM jobs WHERE thread_key = ?",
        )
        .get(params.threadKey) as { next_sequence: number };
      const job: PersistedJob = {
        id: params.id,
        threadKey: params.threadKey,
        sequenceNo: sequenceRow.next_sequence,
        type: params.type,
        payload: params.payload,
        status: "queued",
        runAfter: params.runAfter ?? now,
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      this.db
        .prepare(
          `INSERT INTO jobs(
            id, thread_key, sequence_no, type, payload_json, status, run_after,
            lease_expires_at, attempt_count, error_message, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`,
        )
        .run(
          job.id,
          job.threadKey,
          job.sequenceNo,
          job.type,
          JSON.stringify(job.payload),
          job.status,
          job.runAfter,
          job.attemptCount,
          job.createdAt,
          job.updatedAt,
        );
      this.db.exec("COMMIT");
      return job;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Claims one due job while preserving in-thread execution order. */
  public claimNextJob(leaseMs: number): PersistedJob | undefined {
    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          `SELECT j.* FROM jobs j
           WHERE j.status = 'queued' AND j.run_after <= ?
             AND NOT EXISTS (
               SELECT 1 FROM jobs running
               WHERE running.thread_key = j.thread_key
                 AND running.status IN ('running', 'waiting_approval')
             )
           ORDER BY j.run_after, j.created_at
           LIMIT 1`,
        )
        .get(now) as JobRow | undefined;
      if (!row) {
        this.db.exec("COMMIT");
        return undefined;
      }
      this.db
        .prepare(
          `UPDATE jobs
           SET status = 'running', lease_expires_at = ?, attempt_count = attempt_count + 1, updated_at = ?
           WHERE id = ? AND status = 'queued'`,
        )
        .run(leaseExpiresAt, now, row.id);
      this.db.exec("COMMIT");
      return this.getJob(row.id);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  public getJob(id: string): PersistedJob | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
    return row ? this.mapJob(row) : undefined;
  }

  public updateJob(
    id: string,
    status: PersistedJobStatus,
    options: { errorMessage?: string; leaseMs?: number } = {},
  ): void {
    const now = new Date().toISOString();
    const leaseExpiresAt = options.leaseMs
      ? new Date(Date.now() + options.leaseMs).toISOString()
      : null;
    this.db
      .prepare(
        `UPDATE jobs
         SET status = ?, error_message = ?, lease_expires_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, options.errorMessage ?? null, leaseExpiresAt, now, id);
  }

  /** Do not replay agent work after a crash: require an explicit user resume. */
  public interruptExpiredOrRunningJobs(): number {
    const now = new Date().toISOString();
    const changes = this.db
      .prepare(
        `UPDATE jobs
         SET status = 'interrupted', lease_expires_at = NULL,
             error_message = 'Bridge restarted while the job was active', updated_at = ?
         WHERE status IN ('running', 'waiting_approval')`,
      )
      .run(now).changes;
    return Number(changes);
  }

  public close(): void {
    this.db.close();
  }

  private mapJob(row: JobRow): PersistedJob {
    return {
      id: row.id,
      threadKey: row.thread_key,
      sequenceNo: row.sequence_no,
      type: row.type,
      payload: JSON.parse(row.payload_json),
      status: row.status,
      runAfter: row.run_after,
      leaseExpiresAt: row.lease_expires_at ?? undefined,
      attemptCount: row.attempt_count,
      errorMessage: row.error_message ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
