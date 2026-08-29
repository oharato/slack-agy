import { ChildProcess } from "node:child_process";

export type AgyEventType =
  | "step_start"
  | "step_update"
  | "reasoning"
  | "tool_call"
  | "result"
  | "error"
  | "unknown";

export interface AgyEvent {
  event: string;
  step_index?: number;
  type?: string;
  status?: "SUCCESS" | "ERROR" | "RUNNING" | string;
  response?: string;
  content?: string;
  thinking?: string;
  reasoning?: string;
  tool_name?: string;
  tool_calls?: Array<{
    name: string;
    arguments?: Record<string, unknown>;
  }>;
  conversation_id?: string;
  error?: {
    message?: string;
    code?: string | number;
  };
  [key: string]: unknown;
}

export interface RunAgyOptions {
  prompt: string;
  cwd: string;
  osUser: string;
  conversationId?: string;
  timeoutMs?: number;
  useSudo?: boolean;
  onEvent?: (event: AgyEvent) => void;
  onProgress?: (progressText: string) => void;
  onReasoning?: (reasoningText: string) => void;
  onToolCall?: (toolName: string, args?: Record<string, unknown>) => void;
}

export interface RunAgyResult {
  status: "SUCCESS" | "ERROR" | "CANCELLED" | "TIMEOUT";
  response: string;
  conversationId?: string;
  durationMs: number;
  errorMessage?: string;
}

export interface ActiveProcess {
  pid: number;
  process: ChildProcess;
  cancel: () => void;
}
