import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { CodexCliAdapter, normalizeCodexEvent } from "./codexCliAdapter.js";

// Mock child_process spawn
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";

describe("CodexCliAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correct id and capabilities", () => {
    const adapter = new CodexCliAdapter();
    expect(adapter.id).toBe("codex");
    expect(adapter.capabilities).toEqual({
      resumable: true,
      streamsProgress: true,
      interactiveInput: false,
    });
  });

  it("should spawn codex exec for new session with --approve-for-me and --skip-git-repo-check", async () => {
    const mockProc = new EventEmitter() as any;
    mockProc.stdout = new EventEmitter();
    mockProc.stderr = new EventEmitter();
    mockProc.kill = vi.fn();
    mockProc.pid = 12345;

    vi.mocked(spawn).mockReturnValue(mockProc);

    const adapter = new CodexCliAdapter({ useSudo: false });
    const events: any[] = [];

    const runPromise = adapter.run({
      taskId: "t1",
      prompt: "Fix the bug",
      cwd: "/tmp/workspace",
      osUser: "testuser",
      timeoutMs: 5000,
      onEvent: (e) => events.push(e),
    });

    expect(spawn).toHaveBeenCalledWith(
      "codex",
      ["exec", "--json", "--cd", "/tmp/workspace", "--skip-git-repo-check", "--approve-for-me", "Fix the bug"],
      expect.objectContaining({ cwd: "/tmp/workspace" }),
    );

    // Simulate stdout events
    mockProc.stdout.emit(
      "data",
      Buffer.from('{"type":"thread.started","thread_id":"thread_123"}\n'),
    );
    mockProc.stdout.emit(
      "data",
      Buffer.from('{"type":"agent_message.delta","delta":"Analyzing files..."}\n'),
    );
    mockProc.stdout.emit(
      "data",
      Buffer.from('{"type":"item.started","item":{"type":"command_execution","command":"pnpm test"}}\n'),
    );
    mockProc.stdout.emit(
      "data",
      Buffer.from('{"type":"completed","response":"All tests passed."}\n'),
    );

    mockProc.emit("close", 0);

    const result = await runPromise;
    expect(result.status).toBe("SUCCESS");
    expect(result.sessionId).toBe("thread_123");
    expect(result.response).toBe("All tests passed.");
    expect(events).toEqual([
      { type: "started", sessionId: "thread_123" },
      { type: "progress", text: "Analyzing files..." },
      { type: "tool_call", name: "pnpm test" },
      { type: "completed", response: "All tests passed.", sessionId: "thread_123" },
    ]);
  });

  it("should spawn codex exec resume when sessionId is provided", async () => {
    const mockProc = new EventEmitter() as any;
    mockProc.stdout = new EventEmitter();
    mockProc.stderr = new EventEmitter();
    mockProc.kill = vi.fn();
    mockProc.pid = 12345;

    vi.mocked(spawn).mockReturnValue(mockProc);

    const adapter = new CodexCliAdapter({ useSudo: false });
    const runPromise = adapter.run({
      taskId: "t2",
      prompt: "Continue the fix",
      cwd: "/tmp/workspace",
      osUser: "testuser",
      sessionId: "thread_123",
      timeoutMs: 5000,
    });

    expect(spawn).toHaveBeenCalledWith(
      "codex",
      ["exec", "resume", "--json", "thread_123", "Continue the fix"],
      expect.objectContaining({ cwd: "/tmp/workspace" }),
    );

    mockProc.emit("close", 0);
    const result = await runPromise;
    expect(result.status).toBe("SUCCESS");
    expect(result.sessionId).toBe("thread_123");
  });

  it("should handle error exit code and capture stderr", async () => {
    const mockProc = new EventEmitter() as any;
    mockProc.stdout = new EventEmitter();
    mockProc.stderr = new EventEmitter();
    mockProc.kill = vi.fn();
    mockProc.pid = 12345;

    vi.mocked(spawn).mockReturnValue(mockProc);

    const adapter = new CodexCliAdapter({ useSudo: false });
    const runPromise = adapter.run({
      taskId: "t3",
      prompt: "Fail this",
      cwd: "/tmp/workspace",
      osUser: "testuser",
      timeoutMs: 5000,
    });

    mockProc.stderr.emit("data", Buffer.from("Fatal error: cannot connect"));
    mockProc.emit("close", 1);

    const result = await runPromise;
    expect(result.status).toBe("ERROR");
    expect(result.errorMessage).toContain("Fatal error: cannot connect");
  });

  it("should cancel active process", async () => {
    const mockProc = new EventEmitter() as any;
    mockProc.stdout = new EventEmitter();
    mockProc.stderr = new EventEmitter();
    mockProc.kill = vi.fn();
    mockProc.pid = 12345;

    vi.mocked(spawn).mockReturnValue(mockProc);

    const adapter = new CodexCliAdapter({ useSudo: false });
    const runPromise = adapter.run({
      taskId: "t4",
      prompt: "Long task",
      cwd: "/tmp/workspace",
      osUser: "testuser",
      timeoutMs: 5000,
    });

    expect(adapter.isRunning("t4")).toBe(true);
    const cancelled = adapter.cancel("t4");
    expect(cancelled).toBe(true);
    expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");

    const result = await runPromise;
    expect(result.status).toBe("CANCELLED");
    expect(adapter.isRunning("t4")).toBe(false);
  });
});

describe("normalizeCodexEvent", () => {
  it("should normalize thread.started and thread_id", () => {
    const event = { type: "thread.started", thread_id: "th_001" };
    const norm = normalizeCodexEvent(event);
    expect(norm.sessionId).toBe("th_001");
    expect(norm.events).toEqual([{ type: "started", sessionId: "th_001" }]);
  });

  it("should normalize turn.failed / error events", () => {
    const event = { type: "turn.failed", error: { message: "Rate limit exceeded" } };
    const norm = normalizeCodexEvent(event);
    expect(norm.events).toEqual([{ type: "failed", message: "Rate limit exceeded" }]);
  });

  it("should normalize tool call from item", () => {
    const event = {
      type: "item.completed",
      item: { type: "command_execution", command: "git status" },
    };
    const norm = normalizeCodexEvent(event);
    expect(norm.events).toEqual([{ type: "tool_call", name: "git status" }]);
  });
});
