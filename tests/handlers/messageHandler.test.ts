import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerMessageHandler } from "../../src/handlers/messageHandler.js";
import { UserMapper } from "../../src/config/userMap.js";
import { sessionStore } from "../../src/session/sessionStore.js";
import { agentRegistry } from "../../src/agent/agentRegistry.js";
import type { AppConfig } from "../../src/config/schema.js";


describe("messageHandler", () => {
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
        if (name === "message") {
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

    registerMessageHandler(mockApp, { userMapper, config });
  });

  it("should ignore messages when no thread session exists", async () => {
    await eventHandler({
      event: {
        channel: "C123",
        user: "U_ALICE",
        ts: "1700.999",
        thread_ts: "1700.000",
        text: "既存スレッドのないメッセージ",
      },
      client: mockClient,
    });

    expect(mockClient.chat.postMessage).not.toHaveBeenCalled();
  });

  it("should resume session with saved agentId in thread", async () => {
    const threadTs = `thread_${Date.now()}`;
    sessionStore.createSession({
      channelId: "C123",
      threadTs,
      slackUserId: "U_ALICE",
      osUser: "alice",
      agentId: "codex",
      worktreePath: "/tmp/workspace",
      conversationId: "codex_sess_old",
    });

    const mockAgent = {
      id: "codex",
      run: vi.fn().mockResolvedValue({
        status: "SUCCESS",
        response: "Follow-up completed",
        sessionId: "codex_sess_new",
        durationMs: 900,
      }),
      cancel: vi.fn().mockReturnValue(true),
      isRunning: vi.fn().mockReturnValue(false),
    };

    agentRegistry.register(mockAgent);

    await eventHandler({
      event: {
        channel: "C123",
        user: "U_ALICE",
        ts: `msg_${Date.now()}`,
        thread_ts: threadTs,
        text: "追加でテストを書いて",
      },
      client: mockClient,
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "追加でテストを書いて",
        sessionId: "codex_sess_old",
      }),
    );

    const session = sessionStore.getSessionByThread("C123", threadTs);
    expect(session?.conversationId).toBe("codex_sess_new");
  });
});
