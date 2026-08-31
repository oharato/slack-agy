import { describe, it, expect, vi } from "vitest";
import { AgentExecutor } from "./agentExecutor.js";
import { agentRegistry } from "../agent/agentRegistry.js";
import { sessionStore } from "../session/sessionStore.js";
import type { SlackClient } from "../interaction/interactionManager.js";
import type { AppConfig } from "../config/schema.js";

describe("AgentExecutor", () => {
  const mockConfig: AppConfig = {
    SLACK_BOT_TOKEN: "xoxb-mock",
    SLACK_APP_TOKEN: "xapp-mock",
    SLACK_SIGNING_SECRET: "mock-secret",
    SHARED_WORKSPACE_ROOT: "/tmp/workspace",
    DEFAULT_REPO: "my-repo",
    DEFAULT_BASE_BRANCH: "main",
    DEFAULT_AGENT: "agy",
    MAX_CONCURRENT_TASKS: 2,
    TASK_TIMEOUT_MS: 30000,
    WORKTREE_TTL_HOURS: 24,
    PROGRESS_THROTTLE_MS: 100,
    LOG_DIR: "./logs",
    LOG_LEVEL: "info",
    LOG_STDOUT: false,
    LOG_AUDIT_ENABLED: true,
    DATA_DIR: "./data",
    SLACK_USER_OS_MAPPINGS: { U_ALICE: "alice" },
    ALLOWED_CHANNEL_IDS: [],
  };


  function createMockSlackClient() {
    const messages = new Map<string, { channel: string; thread_ts?: string; text?: string; blocks?: unknown[] }>();
    const reactions = new Map<string, string[]>();

    const client = {
      chat: {
        postMessage: vi.fn(async ({ channel, thread_ts, text, blocks }) => {
          const ts = `${Date.now()}.${Math.random().toString().slice(2, 6)}`;
          messages.set(ts, { channel, thread_ts, text, blocks });
          reactions.set(ts, []);
          return { ok: true, ts };
        }),
        update: vi.fn(async ({ ts, text, blocks }) => {
          const existing = messages.get(ts);
          if (existing) {
            existing.text = text;
            existing.blocks = blocks;
          }
          return { ok: true, ts, text, blocks };
        }),
      },
      reactions: {
        add: vi.fn(async ({ timestamp, name }) => {
          const list = reactions.get(timestamp) || [];
          list.push(name);
          reactions.set(timestamp, list);
          return { ok: true };
        }),
      },
      files: {
        uploadV2: vi.fn(async () => ({ ok: true })),
      },
    } as unknown as SlackClient;

    return { client, messages, reactions };
  }

  it("executes agent turn and detects options, adding reactions to Slack", async () => {
    const { client, reactions } = createMockSlackClient();

    // Mock agent in registry
    vi.spyOn(agentRegistry, "get").mockReturnValue({
      id: "agy",
      run: vi.fn().mockResolvedValue({
        status: "SUCCESS",
        response: `
調査が完了しました。以下の方針から選択してください：
1. Redis キャッシュを導入する
2. インメモリ Map を使用する
3. キャッシュなしで毎回計算する
`,
        durationMs: 1200,
        sessionId: "sess-123",
      }),
      cancel: vi.fn(),
      isRunning: vi.fn(),
    });

    const session = sessionStore.createSession({
      channelId: "C_TEST",
      threadTs: "1700.100",
      slackUserId: "U_ALICE",
      osUser: "alice",
      agentId: "agy",
      worktreePath: "/tmp/worktrees/test",
    });

    await AgentExecutor.executeAgentTurn({
      client,
      session,
      prompt: "キャッシュの導入方法を検討して",
      slackUserId: "U_ALICE",
      config: mockConfig,
    });

    expect(client.chat.update).toHaveBeenCalled();
    // 3 reactions (one, two, three) should have been added to the message
    const allReactions = Array.from(reactions.values()).flat();
    expect(allReactions).toContain("one");
    expect(allReactions).toContain("two");
    expect(allReactions).toContain("three");
  });
});
