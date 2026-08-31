import { describe, it, expect, vi } from "vitest";
import { ProgressThrottler } from "../../src/formatter/progressThrottler.js";
import { MessageChunker } from "../../src/formatter/messageChunker.js";
import { ProgressCard } from "../../src/formatter/progressCard.js";
import { SlackFormatter } from "../../src/formatter/slackFormatter.js";
import type { SlackClient } from "../../src/interaction/interactionManager.js";


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

  it("should support messages up to 10,000 characters as text", () => {
    const text8k = "A".repeat(8000);
    const result = MessageChunker.processMessage(text8k);
    expect(result.type).toBe("text");
    expect(result.content.length).toBe(8000);
  });

  it("should convert long messages (>10000 chars) to file upload type", () => {
    const longText = "A".repeat(12000);
    const result = MessageChunker.processMessage(longText, {
      defaultFilename: "diff.patch",
      title: "Git Diff",
    });

    expect(result.type).toBe("file");
    expect(result.filename).toBe("diff.patch");
    expect(result.content.length).toBe(12000);
    expect(result.previewText).toContain("...（省略");
  });

  it("should split long content into chunks", () => {
    const text = "Line 1\nLine 2\nLine 3\nLine 4";
    const chunks = MessageChunker.splitIntoChunks(text, 15);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("\n")).toBe(text);
  });

  it("should split markdown into chunks without breaking tables or code blocks", () => {
    const tableMd = [
      "# Header",
      "",
      "| Col1 | Col2 |",
      "| ---- | ---- |",
      "| Val1 | Val2 |",
      "| Val3 | Val4 |",
      "",
      "```python",
      "def test():",
      "    return True",
      "```",
    ].join("\n");

    const chunks = MessageChunker.splitIntoMarkdownChunks(tableMd, 50);
    expect(chunks.length).toBeGreaterThan(1);
    // テーブル行が途中で欠けずに含まれていること
    const tableChunk = chunks.find((c) => c.includes("| Col1 | Col2 |"));
    expect(tableChunk).toBeDefined();
    expect(tableChunk).toContain("| Val1 | Val2 |");
    expect(tableChunk).toContain("| Val3 | Val4 |");
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
  it("should format execution results with Slack Block Kit markdown blocks (enabling tables)", () => {
    const tableResponse = [
      "## 実行結果サマリー",
      "",
      "| 項目 | ステータス | 備考 |",
      "| :--- | :--- | :--- |",
      "| 単体テスト | ✅ 成功 (Pass) | 10/10 通過 |",
      "| テーブル表示 | 🟢 対応 | Block Kit markdown ブロック利用 |",
      "",
      "### シンタックスハイライト",
      "```python",
      "def hello():",
      "    print('Hello Slack Markdown!')",
      "```",
      "",
      "### タスクリスト",
      "- [x] Markdownブロックの導入",
      "- [ ] 動作確認",
      "",
      "> [!TIP] プレビューサーバーで Markdown を閲覧できます。",
    ].join("\n");

    const result = SlackFormatter.formatResultBlocks({
      response: tableResponse,
      osUser: "bob",
      agentId: "codex",
      durationMs: 14200,
      branchName: "feat/table-display",
      conversationId: "conv_123456789",
    });

    expect(result.blocks.length).toBeGreaterThan(0);

    // 先頭ブロックが type: "markdown" であること
    const firstBlock = result.blocks[0];
    expect(firstBlock.type).toBe("markdown");
    const markdownContent = firstBlock.text as string;

    // テーブル構文がそのまま保持されていること
    expect(markdownContent).toContain("| 項目 | ステータス | 備考 |");
    expect(markdownContent).toContain("| 単体テスト | ✅ 成功 (Pass) | 10/10 通過 |");

    // シンタックスハイライト、タスクリスト、見出しが保持されていること
    expect(markdownContent).toContain("## 実行結果サマリー");
    expect(markdownContent).toContain("```python");
    expect(markdownContent).toContain("- [x] Markdownブロックの導入");
    expect(markdownContent).toContain("- [ ] 動作確認");
    expect(markdownContent).toContain(
      "💡 **[TIP]** プレビューサーバーで Markdown を閲覧できます。",
    );

    // メタ情報の context ブロックが付与されていること
    const lastBlock = result.blocks[result.blocks.length - 1];
    expect(lastBlock.type).toBe("context");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contextText = (lastBlock.elements as any[])[0].text;
    expect(contextText).toContain("👤 実行者: `bob`");
    expect(contextText).toContain("⏱️ 14.2s");
    expect(contextText).toContain("🤖 `codex`");
    expect(contextText).toContain("🌿 `feat/table-display`");
  });

  it("should format help and status text", () => {
    const help = SlackFormatter.formatHelp();
    expect(help).toContain("!help");
    expect(help).toContain("!agent");
    expect(help).toContain("!repo");
    expect(help).toContain("!pr");
    expect(help).toContain("!status");
    expect(help).toContain("!clean");

    const unauth = SlackFormatter.formatUnauthorizedUser("U12345");
    expect(unauth).toContain("<@U12345>");
    expect(unauth).toContain("SLACK_USER_OS_MAPPINGS");
  });

  it("should optimize local file links in prepareMarkdownForSlack while keeping markdown structure", () => {
    const md = [
      "# Header 1",
      "| ファイル | 概要 |",
      "| --- | --- |",
      "| [README.md](file:///path/to/repo/README.md) | 説明書 |",
      "| **[docs.md](file:///path/to/repo/docs.md)** | 詳細仕様 |",
    ].join("\n");

    const prepared = SlackFormatter.prepareMarkdownForSlack(md);
    expect(prepared).toContain("| `README.md` | 説明書 |");
    expect(prepared).toContain("| **`docs.md`** | 詳細仕様 |");
    expect(prepared).toContain("# Header 1");
  });

  it("should convert markdown to Slack mrkdwn for legacy compatibility", () => {
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
      "• Node.js LTS 準拠 / `pnpm` 利用（`https://npm.flatt.tech`・7日間クールダウン） / `preview-server.mjs` プレビュー",
    ].join("\n");

    const mrkdwn = SlackFormatter.markdownToMrkdwn(md);
    expect(mrkdwn).toContain("*Header 1*");
    expect(mrkdwn).toContain("*Header 2*");
    expect(mrkdwn).toContain("*bold text*");
    expect(mrkdwn).toContain("• item 1");
    expect(mrkdwn).toContain("• *CraftCommerce 総合技術比較* (`report.md`)");
    expect(mrkdwn).toContain("  • *内容*: *NuxtHub* と *Modern Rails* の比較");
    expect(mrkdwn).not.toContain("***");
    expect(mrkdwn).not.toContain("INLINE_CODE");
    expect(mrkdwn).toContain("`pnpm`");
    expect(mrkdwn).toContain("`https://npm.flatt.tech`");
    expect(mrkdwn).toContain("`preview-server.mjs`");
    expect(mrkdwn).toContain("<https://example.com|Docs>");
    expect(mrkdwn).toContain("README.md");
    expect(mrkdwn).toContain("💡 *[TIP]* Helpful tip");
    expect(mrkdwn).toContain("────────────────────────────────────");
  });
});
