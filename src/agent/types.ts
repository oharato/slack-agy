export type AgentEvent =
  | { type: "started"; sessionId?: string }
  | { type: "progress"; text: string }
  | { type: "tool_call"; name: string; arguments?: Record<string, unknown> }
  | { type: "notice"; text: string }
  | { type: "completed"; response: string; sessionId?: string }
  | { type: "failed"; message: string; retryable?: boolean };

export interface AgentCapabilities {
  resumable: boolean;
  streamsProgress: boolean;
  interactiveInput: boolean;
}

export interface AgentRunOptions {
  taskId: string;
  prompt: string;
  cwd: string;
  osUser: string;
  sessionId?: string;
  timeoutMs: number;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentRunResult {
  status: "SUCCESS" | "ERROR" | "CANCELLED" | "TIMEOUT";
  response: string;
  sessionId?: string;
  durationMs: number;
  errorMessage?: string;
}

export interface AgentAdapter {
  readonly id: string;
  readonly capabilities?: AgentCapabilities;
  run(options: AgentRunOptions): Promise<AgentRunResult>;
  cancel(taskId: string): boolean;
  isRunning(taskId: string): boolean;
}
