import { describe, it, expect } from "vitest";
import { agentRegistry } from "./agentRegistry.js";

describe("AgentRegistry", () => {
  it("should have agy and codex adapters registered", () => {
    expect(agentRegistry.has("agy")).toBe(true);
    expect(agentRegistry.has("codex")).toBe(true);
    expect(agentRegistry.has("AGY")).toBe(true);
    expect(agentRegistry.has("CODEX")).toBe(true);
  });

  it("should list available adapter ids", () => {
    const list = agentRegistry.list();
    expect(list).toContain("agy");
    expect(list).toContain("codex");
  });

  it("should get adapter by id", () => {
    const agy = agentRegistry.get("agy");
    expect(agy.id).toBe("agy");
    expect(agy.capabilities).toEqual({
      resumable: true,
      streamsProgress: true,
      interactiveInput: false,
    });

    const codex = agentRegistry.get("codex");
    expect(codex.id).toBe("codex");
    expect(codex.capabilities).toEqual({
      resumable: true,
      streamsProgress: true,
      interactiveInput: false,
    });
  });

  it("should throw error for unsupported agent", () => {
    expect(() => agentRegistry.get("unsupported")).toThrow("Unsupported agent: unsupported");
  });

  it("should report running status and handle cancellation across adapters", () => {
    expect(agentRegistry.isRunning("non-existent-task")).toBe(false);
    expect(agentRegistry.cancel("non-existent-task")).toBe(false);
  });
});
