import { ChildProcess, spawn } from "node:child_process";
import { AgentAdapter, AgentEvent, AgentRunOptions, AgentRunResult } from "../types.js";
import { CodexStreamParser } from "./codexStreamParser.js";

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
          "--sandbox",
          this.sandbox,
          ...(this.autoApprove ? ["--approve-for-me"] : []),
          options.prompt,
        ];
    const runWithSudo =
      this.useSudo && Boolean(options.osUser && options.osUser !== process.env.USER);
    const userHome = `/home/${options.osUser}`;
    const cmd = runWithSudo ? "sudo" : this.command;
    const args = runWithSudo
      ? [
          "-u",
          options.osUser,
          "-H",
          "env",
          `HOME=${userHome}`,
          `USER=${options.osUser}`,
          this.command,
          ...codexArgs,
        ]
      : codexArgs;

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
        resolve({
          status,
          response: message.trim(),
          sessionId,
          durationMs: Date.now() - startedAt,
          errorMessage,
        });
      };
      const proc = spawn(cmd, args, {
        cwd: options.cwd,
        env: runWithSudo
          ? { ...process.env, HOME: userHome, USER: options.osUser, LOGNAME: options.osUser }
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
        const normalized = normalizeCodexEvent(event);
        if (normalized.sessionId) sessionId = normalized.sessionId;
        for (const item of normalized.events) {
          options.onEvent?.(item);
          if (item.type === "progress") response += item.text;
          if (item.type === "completed") response = item.response;
        }
      });
      parser.on("raw", (text: string) => {
        response += `${text}\n`;
      });
      proc.stdout?.on("data", (chunk) => parser.push(chunk));
      proc.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("error", (error) => finish("ERROR", response, error.message));
      proc.on("close", (code) => {
        parser.end();
        if (settled) return;
        if (code === 0) finish("SUCCESS");
        else
          finish(
            "ERROR",
            response || stderr || `Process exited with code ${code}`,
            stderr || `Process exited with code ${code}`,
          );
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
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (!proc.killed) proc.kill("SIGKILL");
    }, 3_000);
  }
}

function normalizeCodexEvent(event: Record<string, unknown>): {
  sessionId?: string;
  events: AgentEvent[];
} {
  const sessionId =
    stringValue(event.thread_id) ?? stringValue(event.session_id) ?? stringValue(event.id);
  const type = stringValue(event.type);
  const item = objectValue(event.item);
  const text = stringValue(event.delta) ?? stringValue(event.text) ?? stringValue(item?.text);
  if (type?.includes("agent_message") && text)
    return { sessionId, events: [{ type: "progress", text }] };
  if (type?.includes("command") && item) {
    const command = stringValue(item.command) ?? stringValue(item.name) ?? "command";
    return { sessionId, events: [{ type: "tool_call", name: command }] };
  }
  if (type?.includes("completed")) {
    return {
      sessionId,
      events: [
        { type: "completed", response: text ?? "Execution completed successfully.", sessionId },
      ],
    };
  }
  if (type?.includes("failed"))
    return { sessionId, events: [{ type: "failed", message: text ?? "Codex execution failed" }] };
  if (type?.includes("started") || type?.includes("thread"))
    return { sessionId, events: [{ type: "started", sessionId }] };
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
