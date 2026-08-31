import { privilegeRunner } from "../../runner/privilegeRunner.js";
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentRunOptions,
  AgentRunResult,
} from "../types.js";

export interface AgyAdapterOptions {
  agyPath?: string;
  useSudo?: boolean;
}

export class AgyAdapter implements AgentAdapter {
  public readonly id = "agy";
  public readonly capabilities: AgentCapabilities = {
    resumable: true,
    streamsProgress: true,
    interactiveInput: false,
  };

  public async run(options: AgentRunOptions): Promise<AgentRunResult> {
    return privilegeRunner
      .runAgy(options.taskId, {
        prompt: options.prompt,
        cwd: options.cwd,
        osUser: options.osUser,
        conversationId: options.sessionId,
        timeoutMs: options.timeoutMs,
        onReasoning: (text) => options.onEvent?.({ type: "progress", text }),
        onProgress: (text) => options.onEvent?.({ type: "progress", text }),
        onToolCall: (name, arguments_) =>
          options.onEvent?.({ type: "tool_call", name, arguments: arguments_ }),
      })
      .then((result) => ({ ...result, sessionId: result.conversationId }));
  }

  public cancel(taskId: string): boolean {
    return privilegeRunner.cancel(taskId);
  }

  public isRunning(taskId: string): boolean {
    return privilegeRunner.isRunning(taskId);
  }
}
