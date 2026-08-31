import { describe, it, expect, vi } from "vitest";
import { AgyAdapter } from "../../../src/agent/agy/agyAdapter.js";
import { privilegeRunner } from "../../../src/runner/privilegeRunner.js";

describe("AgyAdapter", () => {
  it("should have correct id and capabilities", () => {
    const adapter = new AgyAdapter();
    expect(adapter.id).toBe("agy");
    expect(adapter.capabilities).toEqual({
      resumable: true,
      streamsProgress: true,
      interactiveInput: false,
    });
  });

  it("should delegate run to privilegeRunner.runAgy", async () => {
    const adapter = new AgyAdapter();
    vi.spyOn(privilegeRunner, "runAgy").mockResolvedValue({
      status: "SUCCESS",
      response: "Agy output",
      conversationId: "conv-123",
      durationMs: 500,
    });

    const result = await adapter.run({
      taskId: "task-1",
      prompt: "hello",
      cwd: "/tmp",
      osUser: "alice",
      timeoutMs: 10000,
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.response).toBe("Agy output");
    expect(result.sessionId).toBe("conv-123");
  });

  it("should delegate cancel and isRunning to privilegeRunner", () => {
    const adapter = new AgyAdapter();
    vi.spyOn(privilegeRunner, "cancel").mockReturnValue(true);
    vi.spyOn(privilegeRunner, "isRunning").mockReturnValue(true);

    expect(adapter.cancel("task-1")).toBe(true);
    expect(adapter.isRunning("task-1")).toBe(true);
  });
});
