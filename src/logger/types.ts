import { z } from "zod";

export const LogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface SlackContext {
  userId?: string;
  userName?: string;
  channelId?: string;
  threadTs?: string;
}

export interface ErrorInfo {
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  traceId?: string;
  event: string;
  message?: string;
  slack?: SlackContext;
  osUser?: string;
  worktreePath?: string;
  repoName?: string;
  conversationId?: string;
  durationMs?: number;
  data?: Record<string, unknown>;
  error?: ErrorInfo;
}

export interface AuditLogEntry {
  timestamp: string;
  traceId: string;
  action:
    | "command_execution"
    | "agy_invocation"
    | "worktree_creation"
    | "worktree_deletion"
    | "pr_creation"
    | "privilege_switch";
  status: "STARTED" | "SUCCESS" | "FAILED" | "CANCELLED";
  slackUserId: string;
  slackUserName?: string;
  osUser: string;
  channelId: string;
  threadTs: string;
  repoName?: string;
  branchName?: string;
  worktreePath?: string;
  commandText?: string;
  durationMs?: number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface LoggerOptions {
  logDir?: string;
  minLevel?: LogLevel;
  enableStdout?: boolean;
  enableFile?: boolean;
  enableAuditFile?: boolean;
}
