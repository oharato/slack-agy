import fs from "node:fs";
import path from "node:path";
import { CreateSessionParams, SessionInfo } from "./types.js";
import { logger } from "../logger/index.js";

export interface SessionStoreOptions {
  dataDir?: string;
  persistToFile?: boolean;
}

export class SessionStore {
  private sessions = new Map<string, SessionInfo>();
  private readonly dataDir: string;
  private readonly filePath: string;
  private readonly persistToFile: boolean;

  constructor(options: SessionStoreOptions = {}) {
    this.dataDir = options.dataDir ?? process.env.DATA_DIR ?? "./data";
    this.filePath = path.join(this.dataDir, "sessions.json");
    this.persistToFile = options.persistToFile ?? true;

    if (this.persistToFile) {
      this.loadFromFile();
    }
  }

  public static getThreadKey(channelId: string, threadTs: string): string {
    return `${channelId}:${threadTs}`;
  }

  private loadFromFile(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const data = JSON.parse(raw);
        if (typeof data === "object" && data !== null) {
          for (const [key, session] of Object.entries(data)) {
            // 起動時は status が running だったものは idle にリセット
            const s = session as SessionInfo;
            if (s.status === "running") {
              s.status = "idle";
              delete s.activePid;
            }
            this.sessions.set(key, s);
          }
        }
      }
    } catch (err) {
      logger.error("failed_to_load_sessions_from_file", err);
    }
  }

  private saveToFile(): void {
    if (!this.persistToFile) return;
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      const data = Object.fromEntries(this.sessions.entries());
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      logger.error("failed_to_save_sessions_to_file", err);
    }
  }

  public getSession(threadKey: string): SessionInfo | undefined {
    return this.sessions.get(threadKey);
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

    this.sessions.set(threadKey, session);
    this.saveToFile();

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
    const session = this.sessions.get(threadKey);
    if (!session) return undefined;

    const updated: SessionInfo = {
      ...session,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.sessions.set(threadKey, updated);
    this.saveToFile();
    return updated;
  }

  public resetConversationId(threadKey: string): boolean {
    const session = this.sessions.get(threadKey);
    if (!session) return false;

    delete session.conversationId;
    session.updatedAt = new Date().toISOString();
    this.saveToFile();

    logger.info("session_conversation_reset", { threadKey });
    return true;
  }

  public deleteSession(threadKey: string): boolean {
    const deleted = this.sessions.delete(threadKey);
    if (deleted) {
      this.saveToFile();
      logger.info("session_deleted", { threadKey });
    }
    return deleted;
  }

  public getAllSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }
}

export const sessionStore = new SessionStore();
