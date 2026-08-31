import type { AgentAdapter } from "./types.js";
import { AgyAdapter } from "./agy/agyAdapter.js";
import { CodexCliAdapter } from "./codex/codexCliAdapter.js";

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
