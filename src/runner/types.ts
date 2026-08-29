import { ChildProcess } from "node:child_process";

export type AgyEventType =
  | "init"
  | "step_update"
  | "result"
  | "error"
  | "unknown";

export interface AgyEvent {
  event: string;
  conversation_id?: string;
  init?: {
    cwd?: string;
    tools?: string[];
    permission_mode?: string;
    conversation_id?: string;
  };
  step_update?: {
    conversation_id?: string;
    step_index?: number;
    state?: string;
    step_type?: string;
    text_delta?: string;
    thinking?: string;
    tool_call?: {
      name: string;
      arguments?: Record<string, unknown>;
    };
    [key: string]: unknown;
  };
  result?: {
    conversation_id?: string;
    status?: "SUCCESS" | "ERROR" | string;
    response?: string;
    duration_seconds?: number;
    num_turns?: number;
    [key: string]: unknown;
  };
  // フラットなフォールバック用プロパティ
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
