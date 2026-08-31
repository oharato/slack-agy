import fs from "node:fs";
import path from "node:path";
import { CreateSessionParams, SessionInfo } from "./types.js";
import { logger } from "../logger/index.js";
import { SqliteStore } from "../storage/sqliteStore.js";

export interface SessionStoreOptions {
  dataDir?: string;
  persistToFile?: boolean;
}

export class SessionStore {
  private readonly dataDir: string;
  private readonly legacyFilePath: string;
  private readonly store: SqliteStore;

  constructor(options: SessionStoreOptions = {}) {
    this.dataDir = options.dataDir ?? process.env.DATA_DIR ?? "./data";
    this.legacyFilePath = path.join(this.dataDir, "sessions.json");
    this.store = new SqliteStore({
      dataDir: this.dataDir,
      databasePath: options.persistToFile === false ? ":memory:" : undefined,
    });
    this.migrateLegacySessions();
    this.recoverRunningSessions();
  }

  public static getThreadKey(channelId: string, threadTs: string): string {
    return `${channelId}:${threadTs}`;
  }

  private migrateLegacySessions(): void {
    try {
      if (this.store.getAllSessions().length === 0 && fs.existsSync(this.legacyFilePath)) {
        const raw = fs.readFileSync(this.legacyFilePath, "utf-8");
        const data = JSON.parse(raw);
        if (typeof data === "object" && data !== null) {
          for (const session of Object.values(data)) {
            this.store.saveSession(session as SessionInfo);
          }
          logger.info("legacy_sessions_migrated_to_sqlite", { source: this.legacyFilePath });
        }
      }
    } catch (err) {
      logger.error("failed_to_migrate_legacy_sessions", err);
    }
  }

  private recoverRunningSessions(): void {
    for (const session of this.store.getAllSessions()) {
      if (session.status === "running") {
        session.status = "idle";
        delete session.activePid;
        session.updatedAt = new Date().toISOString();
        this.store.saveSession(session);
      }
    }
  }

  public getSession(threadKey: string): SessionInfo | undefined {
    return this.store.getSession(threadKey);
  }

  public getSessionByThread(channelId: string, threadTs: string): SessionInfo | undefined {
    return this.getSession(SessionStore.getThreadKey(channelId, threadTs));
  }

  public createSession(params: CreateSessionParams): SessionInfo {
    const threadKey = SessionStore.getThreadKey(params.channelId, params.threadTs);
    const now = new Date().toISOString();

    const session: SessionInfo = {
      threadKey,
      channelId: params.channelId,
      threadTs: params.threadTs,
      slackUserId: params.slackUserId,
      osUser: params.osUser,
      repoName: params.repoName,
      branchName: params.branchName,
      worktreePath: params.worktreePath,
      conversationId: params.conversationId,
      status: "idle",
      createdAt: now,
      updatedAt: now,
    };

    this.store.saveSession(session);

    logger.info("session_created", {
      threadKey,
      osUser: session.osUser,
      repoName: session.repoName,
      worktreePath: session.worktreePath,
    });

    return session;
  }

  public updateSession(
    threadKey: string,
    updates: Partial<Omit<SessionInfo, "threadKey" | "channelId" | "threadTs" | "createdAt">>,
  ): SessionInfo | undefined {
    const session = this.store.getSession(threadKey);
    if (!session) return undefined;

    const updated: SessionInfo = {
      ...session,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.store.saveSession(updated);
    return updated;
  }

  public resetConversationId(threadKey: string): boolean {
    const session = this.store.getSession(threadKey);
    if (!session) return false;

    delete session.conversationId;
    session.updatedAt = new Date().toISOString();
    this.store.saveSession(session);

    logger.info("session_conversation_reset", { threadKey });
    return true;
  }

  public deleteSession(threadKey: string): boolean {
    const deleted = this.store.deleteSession(threadKey);
    if (deleted) {
      logger.info("session_deleted", { threadKey });
    }
    return deleted;
  }

  public getAllSessions(): SessionInfo[] {
    return this.store.getAllSessions();
  }
}

export const sessionStore = new SessionStore();
