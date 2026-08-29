import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommandRouter } from "./commandRouter.js";
import { sessionStore } from "../session/sessionStore.js";
import type { SlackClient } from "../interaction/interactionManager.js";

describe("CommandRouter", () => {
  let router: CommandRouter;
  let mockPostMessage: ReturnType<typeof vi.fn>;
  let mockClient: SlackClient;

  beforeEach(() => {
    router = new CommandRouter();
    mockPostMessage = vi.fn().mockResolvedValue({ ok: true, ts: "12345.6789" });
    mockClient = {
      chat: {
        postMessage: mockPostMessage,
      },
    } as unknown as SlackClient;
  });

  it("should handle !help command", async () => {
    const handled = await router.handleIfCommand({
      client: mockClient,
      channelId: "C123",
      threadTs: "1700.001",
      slackUserId: "U_ALICE",
      osUser: "alice",
      text: "!help",
    });

    expect(handled).toBe(true);
    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    expect(mockPostMessage.mock.calls[0][0].text).toContain("Slack-AGY Bridge ヘルプ");
  });

  it("should handle !status command", async () => {
    const handled = await router.handleIfCommand({
      client: mockClient,
      channelId: "C123",
      threadTs: "1700.001",
      slackUserId: "U_ALICE",
      osUser: "alice",
      text: "!status",
    });

    expect(handled).toBe(true);
    expect(mockPostMessage).toHaveBeenCalledTimes(1);
  });

  it("should handle !reset command", async () => {
    sessionStore.createSession({
      channelId: "C123",
      threadTs: "1700.001",
      slackUserId: "U_ALICE",
      osUser: "alice",
      repoName: "sample",
      branchName: "main",
      worktreePath: "/tmp/wt",
      conversationId: "conv_old",
    });

    const handled = await router.handleIfCommand({
      client: mockClient,
      channelId: "C123",
      threadTs: "1700.001",
      slackUserId: "U_ALICE",
      osUser: "alice",
      text: "!reset",
    });

    expect(handled).toBe(true);
    const session = sessionStore.getSessionByThread("C123", "1700.001");
    expect(session?.conversationId).toBeUndefined();
  });

  it("should return false for regular natural language prompts", async () => {
    const handled = await router.handleIfCommand({
      client: mockClient,
      channelId: "C123",
      threadTs: "1700.001",
      slackUserId: "U_ALICE",
      osUser: "alice",
      text: "認証APIのバグを修正してください",
    });

    expect(handled).toBe(false);
    expect(mockPostMessage).not.toHaveBeenCalled();
  });
});
