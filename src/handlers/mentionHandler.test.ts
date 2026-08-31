import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerMentionHandler } from "./mentionHandler.js";
import { UserMapper } from "../config/userMap.js";
import { sessionStore } from "../session/sessionStore.js";
import { agentRegistry } from "../agent/agentRegistry.js";
import type { AppConfig } from "../config/schema.js";

describe("mentionHandler", () => {
  let mockApp: any;
  let mockClient: any;
  let userMapper: UserMapper;
  let config: AppConfig;
  let eventHandler: (args: any) => Promise<void>;

  beforeEach(() => {
    mockClient = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ok: true, ts: "msg_123.456" }),
        update: vi.fn().mockResolvedValue({ ok: true }),
      },
      files: {
        uploadV2: vi.fn().mockResolvedValue({ ok: true }),
      },
    };

    mockApp = {
      event: vi.fn((name: string, handler: any) => {
        if (name === "app_mention") {
          eventHandler = handler;
        }
      }),
    };

    userMapper = new UserMapper({ U_ALICE: "alice" });
    config = {
      SLACK_BOT_TOKEN: "xoxb-test",
      SLACK_APP_TOKEN: "xapp-test",
      SLACK_USER_OS_MAPPINGS: { U_ALICE: "alice" },
      ALLOWED_CHANNEL_IDS: [],
      SHARED_WORKSPACE_ROOT: "/tmp/workspace",
      DEFAULT_REPO: "",
      DEFAULT_BASE_BRANCH: "main",
      DEFAULT_AGENT: "agy",
      MAX_CONCURRENT_TASKS: 2,
      TASK_TIMEOUT_MS: 5000,
      PROGRESS_THROTTLE_MS: 800,
      WORKTREE_TTL_HOURS: 168,
      LOG_DIR: "./logs",
      LOG_LEVEL: "info",
      LOG_STDOUT: false,
      LOG_AUDIT_ENABLED: false,
      DATA_DIR: "./data",
    };

    registerMentionHandler(mockApp, { userMapper, config });
  });

  it("should reject unauthorized slack users", async () => {
    await eventHandler({
      event: {
        channel: "C123",
        user: "U_UNKNOWN",
        ts: `ts_${Date.now()}`,
        text: "<@BOT> こんにちは",
      },
      client: mockClient,
    });

    expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("アクセス拒否"),
      }),
    );
  });

  it("should process mention and run agent with agent:codex prompt option", async () => {
    const mockAgent = {
      id: "codex",
      run: vi.fn().mockResolvedValue({
        status: "SUCCESS",
        response: "Codex finished task",
        sessionId: "codex_sess_1",
        durationMs: 1200,
      }),
      cancel: vi.fn().mockReturnValue(true),
      isRunning: vi.fn().mockReturnValue(false),
    };

    agentRegistry.register(mockAgent);

    const ts = `ts_${Date.now()}`;
    await eventHandler({
      event: {
        channel: "C123",
        user: "U_ALICE",
        ts,
        text: "<@BOT> agent:codex バグを調査して",
      },
      client: mockClient,
    });

    // Wait for queue async execution
    await new Promise((r) => setTimeout(r, 50));

    expect(mockAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "バグを調査して",
        osUser: "alice",
      }),
    );

    const session = sessionStore.getSessionByThread("C123", ts);
    expect(session?.agentId).toBe("codex");
    expect(session?.conversationId).toBe("codex_sess_1");
  });
});
