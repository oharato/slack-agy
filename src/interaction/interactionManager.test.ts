import { describe, it, expect, vi } from "vitest";
import { InteractionManager } from "./interactionManager.js";
import type { SlackClient } from "./interactionManager.js";

describe("InteractionManager", () => {
  function createMockSlackClient() {
    const messages = new Map<string, { channel: string; thread_ts?: string; text?: string }>();
    const reactions = new Map<string, string[]>();

    const client = {
      chat: {
        postMessage: vi.fn(async ({ channel, thread_ts, text }) => {
          const ts = `${Date.now()}.${Math.random().toString().slice(2, 6)}`;
          messages.set(ts, { channel, thread_ts, text });
          reactions.set(ts, []);
          return { ok: true, ts };
        }),
        update: vi.fn(async ({ ts, text }) => {
          const existing = messages.get(ts);
          if (existing) existing.text = text;
          return { ok: true, ts, text };
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
    } as unknown as SlackClient;

    return { client, messages, reactions };
  }

  it("should request approval, add reactions, and resolve on authorized approval reaction", async () => {
    const manager = new InteractionManager();
    const { client, messages, reactions } = createMockSlackClient();

    let resultPromise = manager.requestApproval(client, {
      channelId: "C_MAIN",
      threadTs: "1700.123",
      allowedSlackUserId: "U_ALICE",
      osUser: "alice",
      title: "デプロイを実行しますか？",
    });

    // Wait for postMessage
    await new Promise((r) => setTimeout(r, 20));

    const messageTs = Array.from(messages.keys())[0];
    expect(messageTs).toBeDefined();
    expect(reactions.get(messageTs)).toEqual(["white_check_mark", "x"]);

    // Unauthorized user reaction should be ignored
    const bobResult = await manager.handleReactionAdded(client, {
      user: "U_BOB",
      reaction: "white_check_mark",
      item: { type: "message", channel: "C_MAIN", ts: messageTs },
    });
    expect(bobResult).toBe(false);

    // Authorized user reaction should be accepted
    const aliceResult = await manager.handleReactionAdded(client, {
      user: "U_ALICE",
      reaction: "white_check_mark",
      item: { type: "message", channel: "C_MAIN", ts: messageTs },
    });
    expect(aliceResult).toBe(true);

    const result = await resultPromise;
    expect(result.selectedOption.value).toBe("approve");
    expect(result.selectedOption.isApproval).toBe(true);
    expect(result.selectedByUserId).toBe("U_ALICE");
    expect(result.timedOut).toBe(false);

    expect(client.chat.update).toHaveBeenCalled();
  });

  it("should handle question selection correctly", async () => {
    const manager = new InteractionManager();
    const { client, messages, reactions } = createMockSlackClient();

    let resultPromise = manager.requestQuestion(client, {
      channelId: "C_MAIN",
      threadTs: "1700.123",
      allowedSlackUserId: "U_ALICE",
      osUser: "alice",
      question: "保存先ストレージ",
      options: ["S3", "GCS", "Local"],
    });

    await new Promise((r) => setTimeout(r, 20));

    const messageTs = Array.from(messages.keys())[0];
    expect(reactions.get(messageTs)).toEqual(["one", "two", "three"]);

    // Alice selects Option 2 (GCS)
    const handled = await manager.handleReactionAdded(client, {
      user: "U_ALICE",
      reaction: "two",
      item: { type: "message", channel: "C_MAIN", ts: messageTs },
    });
    expect(handled).toBe(true);

    const result = await resultPromise;
    expect(result.selectedOption.value).toBe("2");
    expect(result.selectedOption.label).toBe("GCS");
  });

  it("should time out if no reaction is received", async () => {
    const manager = new InteractionManager();
    const { client } = createMockSlackClient();

    const resultPromise = manager.requestApproval(client, {
      channelId: "C_MAIN",
      threadTs: "1700.123",
      allowedSlackUserId: "U_ALICE",
      osUser: "alice",
      title: "タイムアウトテスト",
      timeoutMs: 50, // Short timeout for test
    });

    const result = await resultPromise;
    expect(result.timedOut).toBe(true);
    expect(result.selectedOption.value).toBe("deny");
  });
});
