import { ChildProcess, spawn } from "node:child_process";
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEvent,
  AgentRunOptions,
  AgentRunResult,
} from "../types.js";
import { CodexStreamParser } from "./codexStreamParser.js";
import { logger } from "../../logger/index.js";
import { auditLogger } from "../../logger/auditLogger.js";

export interface CodexCliAdapterOptions {
  command?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  autoApprove?: boolean;
  useSudo?: boolean;
}

interface ActiveCodexProcess {
  process: ChildProcess;
  cancel: () => void;
}

export class CodexCliAdapter implements AgentAdapter {
  public readonly id = "codex";
  public readonly capabilities: AgentCapabilities = {
    resumable: true,
    streamsProgress: true,
    interactiveInput: false,
  };

  private readonly command: string;
  private readonly sandbox: "read-only" | "workspace-write" | "danger-full-access";
  private readonly autoApprove: boolean;
  private readonly useSudo: boolean;
  private readonly active = new Map<string, ActiveCodexProcess>();

  constructor(options: CodexCliAdapterOptions = {}) {
    this.command = options.command ?? "codex";
    this.sandbox = options.sandbox ?? "workspace-write";
    this.autoApprove = options.autoApprove ?? true;
    this.useSudo = options.useSudo ?? process.env.NODE_ENV !== "test";
  }

  public run(options: AgentRunOptions): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const isResume = Boolean(options.sessionId);
    const codexArgs = isResume
      ? ["exec", "resume", "--json", options.sessionId!, options.prompt]
      : [
          "exec",
          "--json",
          "--cd",
          options.cwd,
          "--skip-git-repo-check",
          ...(this.autoApprove ? ["--approve-for-me"] : ["--sandbox", this.sandbox]),
          options.prompt,
        ];

    const runWithSudo =
      this.useSudo && Boolean(options.osUser && options.osUser !== process.env.USER);
    const userHome = options.osUser ? `/home/${options.osUser}` : process.env.HOME || "/root";
    const userPath = `${userHome}/.local/bin:${userHome}/.local/share/mise/shims:${userHome}/.cargo/bin:/usr/local/bin:/usr/bin:/bin`;
    const cmd = runWithSudo ? "sudo" : this.command;
    const args = runWithSudo
      ? [
          "-u",
          options.osUser,
          "-H",
          "env",
          `PATH=${userPath}`,
          `HOME=${userHome}`,
          `USER=${options.osUser}`,
          `LOGNAME=${options.osUser}`,
          `XDG_CONFIG_HOME=${userHome}/.config`,
          this.command,
          ...codexArgs,
        ]
      : codexArgs;

    logger.info("spawning_codex_process", {
      taskId: options.taskId,
      osUser: options.osUser,
      cwd: options.cwd,
      sessionId: options.sessionId,
      isResume,
      command: `${cmd} ${args.join(" ")}`,
    });

    auditLogger.record({
      traceId: `codex_${startedAt}`,
      action: "command_execution",
      status: "STARTED",
      slackUserId: "SYSTEM",
      osUser: options.osUser,
      channelId: options.taskId.split(":")[0] || "",
      threadTs: options.taskId.split(":")[1] || "",
      worktreePath: options.cwd,
      commandText: options.prompt,
      metadata: { agentId: "codex", sessionId: options.sessionId },
    });

    return new Promise<AgentRunResult>((resolve) => {
      let settled = false;
      let response = "";
      let sessionId = options.sessionId;
      let stderr = "";

      const finish = (
        status: AgentRunResult["status"],
        message = response || (status === "SUCCESS" ? "Execution completed successfully." : ""),
        errorMessage?: string,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.active.delete(options.taskId);

        const durationMs = Date.now() - startedAt;
        const auditStatus =
          status === "SUCCESS" ? "SUCCESS" : status === "CANCELLED" ? "CANCELLED" : "FAILED";

        auditLogger.record({
          traceId: `codex_${startedAt}`,
          action: "command_execution",
          status: auditStatus,
          slackUserId: "SYSTEM",
          osUser: options.osUser,
          channelId: options.taskId.split(":")[0] || "",
          threadTs: options.taskId.split(":")[1] || "",
          worktreePath: options.cwd,
          commandText: options.prompt,
          durationMs,
          errorMessage: errorMessage || (status !== "SUCCESS" ? message : undefined),
          metadata: { agentId: "codex", sessionId },
        });

        resolve({
          status,
          response: message.trim(),
          sessionId,
          durationMs,
          errorMessage,
        });
      };

      const proc = spawn(cmd, args, {
        cwd: options.cwd,
        env: runWithSudo
          ? {
              ...process.env,
              HOME: userHome,
              USER: options.osUser,
              LOGNAME: options.osUser,
              XDG_CONFIG_HOME: `${userHome}/.config`,
            }
          : process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        this.kill(proc);
        finish("TIMEOUT", response || "Execution timed out", "Task timed out");
      }, options.timeoutMs);

      this.active.set(options.taskId, {
        process: proc,
        cancel: () => finish("CANCELLED", "Process cancelled by user", "Cancelled"),
      });

      const parser = new CodexStreamParser();
      parser.on("event", (event: Record<string, unknown>) => {
        const normalized = normalizeCodexEvent(event, sessionId);
        if (normalized.sessionId) sessionId = normalized.sessionId;
        for (const item of normalized.events) {
          options.onEvent?.(item);
          if (item.type === "progress") response += item.text;
          if (item.type === "completed") response = item.response;
        }
      });

      parser.on("raw", (text: string) => {
        if (!response) {
          response += `${text}\n`;
        }
      });

      proc.stdout?.on("data", (chunk) => parser.push(chunk));
      proc.stderr?.on("data", (chunk) => {
        const text = chunk.toString();
        stderr += text;
        logger.debug("codex_process_stderr", { taskId: options.taskId, text: text.trim() });
      });

      proc.on("error", (error) => finish("ERROR", response, error.message));
      proc.on("close", (code) => {
        parser.end();
        if (settled) return;
        if (code === 0) {
          finish("SUCCESS");
        } else {
          const detail = stderr.trim() || `Process exited with code ${code}`;
          finish("ERROR", response.trim() || `エラーが発生しました: ${detail}`, detail);
        }
      });
    });
  }

  public cancel(taskId: string): boolean {
    const active = this.active.get(taskId);
    if (!active) return false;
    this.kill(active.process);
    active.cancel();
    return true;
  }

  public isRunning(taskId: string): boolean {
    return this.active.has(taskId);
  }

  private kill(proc: ChildProcess): void {
    try {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 3_000);
    } catch (err) {
      logger.warn("failed_to_kill_codex_process", { error: String(err) });
    }
  }
}

export function normalizeCodexEvent(
  event: Record<string, unknown>,
  currentSessionId?: string,
): {
  sessionId?: string;
  events: AgentEvent[];
} {
  const explicitSessionId =
    stringValue(event.thread_id) ??
    stringValue(event.session_id) ??
    stringValue(event.id) ??
    (objectValue(event.thread) ? stringValue(objectValue(event.thread)?.id) : undefined);
  const sessionId = explicitSessionId ?? currentSessionId;

  const type = stringValue(event.type);
  const item = objectValue(event.item);
  const text =
    stringValue(event.delta) ??
    stringValue(event.text) ??
    stringValue(event.message) ??
    stringValue(event.response) ??
    stringValue(item?.text) ??
    stringValue(item?.content) ??
    stringValue(item?.response);

  if (!type) {
    return { sessionId, events: text ? [{ type: "progress", text }] : [] };
  }

  // Session / Thread started
  if (type.includes("thread.started") || type.includes("session.started")) {
    return { sessionId, events: [{ type: "started", sessionId }] };
  }

  // Message delta / progress
  if (
    type.includes("agent_message") ||
    type.includes("message.delta") ||
    type.includes("text_delta") ||
    type === "message"
  ) {
    if (text) return { sessionId, events: [{ type: "progress", text }] };
  }

  // Tool / command execution
  if (
    type.includes("command") ||
    type.includes("tool_call") ||
    type.includes("item.started") ||
    type.includes("item.completed")
  ) {
    const command =
      stringValue(item?.command) ??
      stringValue(item?.name) ??
      stringValue(event.command) ??
      stringValue(event.name) ??
      (type.includes("command") ? "command_execution" : undefined);
    if (command) {
      return { sessionId, events: [{ type: "tool_call", name: command }] };
    }
  }

  // Error / failure
  if (type.includes("failed") || type.includes("error")) {
    const errorObj = objectValue(event.error);
    const errorMsg =
      stringValue(errorObj?.message) ??
      stringValue(event.message) ??
      text ??
      "Codex execution failed";
    return { sessionId, events: [{ type: "failed", message: errorMsg }] };
  }

  // Completion
  if (type.includes("completed") || type.includes("turn.finished")) {
    return {
      sessionId,
      events: [
        {
          type: "completed",
          response: text ?? "Execution completed successfully.",
          sessionId,
        },
      ],
    };
  }

  return { sessionId, events: [] };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
