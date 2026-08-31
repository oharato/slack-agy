import { privilegeRunner } from "../runner/privilegeRunner.js";
import type { AgentAdapter, AgentCapabilities, AgentRunOptions, AgentRunResult } from "./types.js";
import { CodexCliAdapter } from "./codex/codexCliAdapter.js";

class AgyAdapter implements AgentAdapter {
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

export class AgentRegistry {
  private readonly adapters = new Map<string, AgentAdapter>([
    ["agy", new AgyAdapter()],
    ["codex", new CodexCliAdapter()],
  ]);

  public get(id: string): AgentAdapter {
    const adapter = this.adapters.get(id.toLowerCase());
    if (!adapter) throw new Error(`Unsupported agent: ${id}`);
    return adapter;
  }

  public has(id: string): boolean {
    return this.adapters.has(id.toLowerCase());
  }

  public list(): string[] {
    return Array.from(this.adapters.keys());
  }

  public register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.id.toLowerCase(), adapter);
  }

  public cancel(taskId: string): boolean {
    let anyCancelled = false;
    for (const adapter of this.adapters.values()) {
      if (adapter.cancel(taskId)) {
        anyCancelled = true;
      }
    }
    return anyCancelled;
  }

  public isRunning(taskId: string): boolean {
    for (const adapter of this.adapters.values()) {
      if (adapter.isRunning(taskId)) {
        return true;
      }
    }
    return false;
  }
}

export const agentRegistry = new AgentRegistry();

