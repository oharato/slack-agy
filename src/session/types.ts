export type SessionStatus = "idle" | "running" | "waiting_input";

export interface SessionInfo {
  threadKey: string; // `${channelId}:${threadTs}`
  channelId: string;
  threadTs: string;
  slackUserId: string;
  osUser: string;
  repoName: string;
  branchName: string;
  worktreePath: string;
  conversationId?: string;
  status: SessionStatus;
  activePid?: number;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface CreateSessionParams {
  channelId: string;
  threadTs: string;
  slackUserId: string;
  osUser: string;
  repoName: string;
  branchName: string;
  worktreePath: string;
  conversationId?: string;
}
