import { spawn, ChildProcess } from "node:child_process";
import { AgyEvent, ActiveProcess, RunAgyOptions, RunAgyResult } from "./types.js";
import { StreamParser } from "./streamParser.js";
import { logger } from "../logger/index.js";
import { auditLogger } from "../logger/auditLogger.js";

export interface PrivilegeRunnerOptions {
  agyPath?: string;
  useSudo?: boolean;
}

export class PrivilegeRunner {
  private readonly agyPath: string;
  private readonly useSudo: boolean;
  private activeProcesses = new Map<string, ActiveProcess>();

  constructor(options: PrivilegeRunnerOptions = {}) {
    this.agyPath = options.agyPath ?? "agy";
    this.useSudo = options.useSudo ?? (process.env.NODE_ENV !== "test");
  }

  /**
   * OS ユーザー権限で agy CLI を実行
   */
  public async runAgy(threadKey: string, options: RunAgyOptions): Promise<RunAgyResult> {
    const {
      prompt,
      cwd,
      osUser,
      conversationId,
      timeoutMs = 600000, // 10 minutes
      useSudo = (this.useSudo && Boolean(osUser && osUser !== process.env.USER)),
      onEvent,
      onProgress,
      onReasoning,
      onToolCall,
    } = options;

    const startTime = Date.now();
    const args: string[] = [];

    if (conversationId) {
      args.push("--conversation", conversationId);
    }
    args.push("-p", prompt, "--output-format", "stream-json", "--dangerously-skip-permissions");

    let cmd = this.agyPath;
    let spawnArgs = args;

    const userHome = osUser ? `/home/${osUser}` : (process.env.HOME || "/root");
    const userPath = `${userHome}/.local/bin:${userHome}/.local/share/mise/shims:${userHome}/.cargo/bin:/usr/local/bin:/usr/bin:/bin`;

    if (useSudo && osUser) {
      cmd = "sudo";
      spawnArgs = [
        "-u",
        osUser,
        "-H",
        "env",
        `PATH=${userPath}`,
        `HOME=${userHome}`,
        `USER=${osUser}`,
        `LOGNAME=${osUser}`,
        `XDG_CONFIG_HOME=${userHome}/.config`,
        this.agyPath,
        ...args,
      ];
    }

    logger.info("spawning_agy_process", {
      threadKey,
      osUser,
      cwd,
      conversationId,
      command: `${cmd} ${spawnArgs.join(" ")}`,
    });

    auditLogger.record({
      traceId: `agy_${Date.now()}`,
      action: "agy_invocation",
      status: "STARTED",
      slackUserId: "SYSTEM",
      osUser,
      channelId: threadKey.split(":")[0] || "",
      threadTs: threadKey.split(":")[1] || "",
      worktreePath: cwd,
      commandText: prompt,
      metadata: { conversationId },
    });

    return new Promise<RunAgyResult>((resolve) => {
      let finalResponse = "";
      let accumulatedText = "";
      let capturedConvId = conversationId;
      let finalStatus: "SUCCESS" | "ERROR" | "CANCELLED" | "TIMEOUT" = "SUCCESS";
      let errorMessage: string | undefined;
      let isSettled = false;

      const proc: ChildProcess = spawn(cmd, spawnArgs, {
        cwd,
        env: osUser
          ? {
              ...process.env,
              HOME: `/home/${osUser}`,
              USER: osUser,
              LOGNAME: osUser,
              XDG_CONFIG_HOME: `/home/${osUser}/.config`,
            }
          : process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const parser = new StreamParser();

      const finish = (
        status: "SUCCESS" | "ERROR" | "CANCELLED" | "TIMEOUT",
        resp: string,
        err?: string,
      ) => {
        if (isSettled) return;
        isSettled = true;

        if (timer) clearTimeout(timer);
        this.activeProcesses.delete(threadKey);

        const durationMs = Date.now() - startTime;
        const auditStatus =
          status === "SUCCESS" ? "SUCCESS" : status === "CANCELLED" ? "CANCELLED" : "FAILED";

        auditLogger.record({
          traceId: `agy_${Date.now()}`,
          action: "agy_invocation",
          status: auditStatus,
          slackUserId: "SYSTEM",
          osUser,
          channelId: threadKey.split(":")[0] || "",
          threadTs: threadKey.split(":")[1] || "",
          worktreePath: cwd,
          commandText: prompt,
          durationMs,
          errorMessage: err,
          metadata: { conversationId: capturedConvId },
        });

        resolve({
          status,
          response: resp,
          conversationId: capturedConvId,
          durationMs,
          errorMessage: err,
        });
      };

      // Timeout Timer
      const timer = setTimeout(() => {
        logger.warn("agy_process_timeout", { threadKey, osUser, timeoutMs });
        this.killProcess(proc);
        finish("TIMEOUT", finalResponse || "Execution timed out", "Task timed out");
      }, timeoutMs);

      // Register active process
      if (proc.pid) {
        this.activeProcesses.set(threadKey, {
          pid: proc.pid,
          process: proc,
          cancel: () => {
            logger.info("cancelling_agy_process", { threadKey, pid: proc.pid });
            this.killProcess(proc);
            finish("CANCELLED", "Process cancelled by user", "Cancelled");
          },
        });
      }

      // Stream events
      parser.on("event", (event: AgyEvent) => {
        if (onEvent) onEvent(event);

        const convId =
          event.conversation_id ||
          event.result?.conversation_id ||
          event.step_update?.conversation_id ||
          event.init?.conversation_id;
        if (convId) {
          capturedConvId = convId;
        }

        // Reasoning / Thinking
        const thinkingText =
          event.step_update?.thinking ||
          (typeof event.thinking === "string" ? event.thinking : undefined) ||
          (typeof event.reasoning === "string" ? event.reasoning : undefined);
        if (thinkingText && onReasoning) {
          onReasoning(thinkingText);
        }

        // Tool Calls
        if (event.step_update?.tool_call?.name) {
          if (onToolCall) onToolCall(event.step_update.tool_call.name, event.step_update.tool_call.arguments);
        } else if (event.tool_name) {
          if (onToolCall) onToolCall(event.tool_name, event);
        } else if (event.tool_calls && event.tool_calls.length > 0) {
          for (const tc of event.tool_calls) {
            if (onToolCall) onToolCall(tc.name, tc.arguments);
          }
        }

        // Progress text / Streaming text
        const textChunk =
          event.step_update?.text_delta ||
          (typeof event.content === "string" ? event.content : undefined) ||
          (typeof event.response === "string" ? event.response : undefined);
        if (textChunk) {
          accumulatedText += textChunk;
          if (onProgress) onProgress(textChunk);
        }

        // Result event
        if (event.event === "result" || event.result) {
          const resp = event.result?.response || event.response || accumulatedText;
          if (resp) {
            finalResponse = resp;
          }
          const resStatus = event.result?.status || event.status;
          if (resStatus === "ERROR") {
            finalStatus = "ERROR";
            errorMessage = event.error?.message || "AGY execution returned error";
          }
        }
      });

      parser.on("raw", (text: string) => {
        // Collect raw stdout as response if no structured response received
        if (!finalResponse) {
          finalResponse += text + "\n";
        }
      });

      let stderrBuffer = "";

      proc.stdout?.on("data", (chunk) => {
        parser.push(chunk);
      });

      proc.stderr?.on("data", (chunk) => {
        const text = chunk.toString();
        stderrBuffer += text;
        logger.debug("agy_process_stderr", { threadKey, text: text.trim() });
      });

      proc.on("error", (err) => {
        logger.error("agy_process_error", err, { threadKey, osUser });
        finish("ERROR", finalResponse, err.message);
      });

      proc.on("close", (code) => {
        parser.end();
        if (isSettled) return;

        if (code === 0) {
          finish(
            finalStatus,
            finalResponse.trim() || "Execution completed successfully.",
            errorMessage,
          );
        } else {
          const detail = errorMessage || stderrBuffer.trim() || `Process exited with code ${code}`;
          finish("ERROR", finalResponse.trim() || `エラーが発生しました: ${detail}`, detail);
        }
      });
    });
  }

  private killProcess(proc: ChildProcess): void {
    try {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 3000);
    } catch (err) {
      logger.warn("failed_to_kill_process", { error: String(err) });
    }
  }

  /**
   * 指定したスレッドで実行中のプロセスをキャンセル
   */
  public cancel(threadKey: string): boolean {
    const active = this.activeProcesses.get(threadKey);
    if (active) {
      active.cancel();
      return true;
    }
    return false;
  }

  /**
   * 実行中プロセスがあるか確認
   */
  public isRunning(threadKey: string): boolean {
    return this.activeProcesses.has(threadKey);
  }
}

export const privilegeRunner = new PrivilegeRunner();
