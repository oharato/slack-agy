import { describe, it, expect, vi } from "vitest";
import { ProgressThrottler } from "./progressThrottler.js";
import { MessageChunker } from "./messageChunker.js";
import { ProgressCard } from "./progressCard.js";
import { SlackFormatter } from "./slackFormatter.js";
import type { SlackClient } from "../interaction/interactionManager.js";

describe("ProgressThrottler", () => {
  it("should throttle frequent updates to minimum interval", async () => {
    const updateFn = vi.fn().mockResolvedValue({ ok: true });
    const mockClient = {
      chat: { update: updateFn },
    } as unknown as SlackClient;

    const throttler = new ProgressThrottler(mockClient, {
      channelId: "C123",
      messageTs: "1700.001",
      minIntervalMs: 50,
    });

    // 連続して複数回呼び出し
    throttler.update("Update 1");
    throttler.update("Update 2");
    throttler.update("Update 3");

    // 最初の呼び出しは即時実行
    expect(updateFn).toHaveBeenCalledTimes(1);
    expect(updateFn).toHaveBeenCalledWith({
      channel: "C123",
      ts: "1700.001",
      text: "Update 1",
    });

    // インターバル経過待機
    await new Promise((r) => setTimeout(r, 80));

    // 最新の Update 3 が送信される
    expect(updateFn).toHaveBeenCalledTimes(2);
    expect(updateFn).toHaveBeenLastCalledWith({
      channel: "C123",
      ts: "1700.001",
      text: "Update 3",
    });
  });
});

describe("MessageChunker", () => {
  it("should treat short messages as text", () => {
    const result = MessageChunker.processMessage("Short message");
    expect(result.type).toBe("text");
    expect(result.content).toBe("Short message");
  });

  it("should convert long messages (>3800 chars) to file upload type", () => {
    const longText = "A".repeat(5000);
    const result = MessageChunker.processMessage(longText, {
      defaultFilename: "diff.patch",
      title: "Git Diff",
    });

    expect(result.type).toBe("file");
    expect(result.filename).toBe("diff.patch");
    expect(result.content.length).toBe(5000);
  });

  it("should split long content into chunks", () => {
    const text = "Line 1\nLine 2\nLine 3\nLine 4";
    const chunks = MessageChunker.splitIntoChunks(text, 15);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("\n")).toBe(text);
  });
});

describe("ProgressCard", () => {
  it("should render real-time progress card with branch, tools, and reasoning", () => {
    const text = ProgressCard.render({
      osUser: "alice",
      repoName: "web-app",
      branchName: "feat/login",
      worktreePath: "/tmp/worktrees/wt_1",
      startedAt: Date.now() - 5000,
      reasoningSnippet: "Checking login flow",
      activeTool: "run_command (pnpm test)",
      recentTools: ["find_by_name", "grep_search"],
    });

    expect(text).toContain("AGY 実行中...");
    expect(text).toContain("alice");
    expect(text).toContain("feat/login");
    expect(text).toContain("Checking login flow");
    expect(text).toContain("run_command (pnpm test)");
  });
});

describe("SlackFormatter", () => {
  it("should format execution results with metadata and footer", () => {
    const formatted = SlackFormatter.formatResult({
      response: "Tests passed successfully.",
      osUser: "bob",
      durationMs: 14200,
      branchName: "feat/api",
      conversationId: "conv_123456789",
    });

    expect(formatted).toContain("Tests passed successfully.");
    expect(formatted).toContain("👤 実行者: `bob`");
    expect(formatted).toContain("⏱️ 14.2s");
    expect(formatted).toContain("🌿 `feat/api`");
    expect(formatted).toContain("💡 `!pr [タイトル]`");
  });

  it("should format help and status text", () => {
    const help = SlackFormatter.formatHelp();
    expect(help).toContain("!help");
    expect(help).toContain("!repo");
    expect(help).toContain("!pr");
    expect(help).toContain("!status");
    expect(help).toContain("!clean");

    const unauth = SlackFormatter.formatUnauthorizedUser("U12345");
    expect(unauth).toContain("<@U12345>");
    expect(unauth).toContain("SLACK_USER_OS_MAPPINGS");
  });

  it("should convert markdown to Slack mrkdwn", () => {
    const md = [
      "# Header 1",
      "## Header 2",
      "**bold text** and __also bold__",
      "- item 1",
      "- item 2",
      "* **[CraftCommerce 総合技術比較](file:///var/workspace/docs/report.md)**",
      "  * **内容**: **NuxtHub** と **Modern Rails** の比較",
      "[Docs](https://example.com)",
      "[local file](file:///var/workspace/shared/worktrees/docs-repo/README.md)",
      "> [!TIP] Helpful tip",
      "---",
    ].join("\n");

    const mrkdwn = SlackFormatter.markdownToMrkdwn(md);
    expect(mrkdwn).toContain("*Header 1*");
    expect(mrkdwn).toContain("*Header 2*");
    expect(mrkdwn).toContain("*bold text*");
    expect(mrkdwn).toContain("• item 1");
    expect(mrkdwn).toContain("• *CraftCommerce 総合技術比較* (`report.md`)");
    expect(mrkdwn).toContain("  • *内容*: *NuxtHub* と *Modern Rails* の比較");
    expect(mrkdwn).not.toContain("***");
    expect(mrkdwn).toContain("<https://example.com|Docs>");
    expect(mrkdwn).toContain("README.md");
    expect(mrkdwn).toContain("💡 *[TIP]* Helpful tip");
    expect(mrkdwn).toContain("────────────────────────────────────");
  });
});
