import { SessionInfo } from "../session/types.js";
import { MessageChunker } from "./messageChunker.js";

export interface FormatResultParams {
  response: string;
  osUser: string;
  durationMs: number;
  branchName?: string;
  conversationId?: string;
  showPrHint?: boolean;
}

export class SlackFormatter {
  /**
   * AGY 実行結果メッセージを Slack Block Kit (section + mrkdwn 形式) でフォーマット
   */
  public static formatResultBlocks(params: FormatResultParams): {
    text: string;
    blocks: Array<Record<string, unknown>>;
  } {
    const durationSec = (params.durationMs / 1000).toFixed(1);
    const metaParts: string[] = [`👤 実行者: \`${params.osUser}\``, `⏱️ ${durationSec}s`];

    if (params.branchName) {
      metaParts.push(`🌿 \`${params.branchName}\``);
    }

    if (params.conversationId) {
      metaParts.push(`🆔 \`${params.conversationId.slice(0, 8)}...\``);
    }

    const metaLine = metaParts.join(" | ");
    const prHint =
      params.showPrHint !== false
        ? "\n💡 `!pr [タイトル]` で GitHub に Pull Request を作成できます。"
        : "";

    const formattedBody = this.markdownToMrkdwn(params.response.trim());
    const fullText = `${formattedBody}\n\n────────────────────────────────────\n${metaLine}${prHint}`;

    // 2,500文字ごとに section ブロックに安全分割 (Slack section 上限 3,000 文字)
    const bodyChunks = MessageChunker.splitIntoChunks(formattedBody, 2500);
    const blocks: Array<Record<string, unknown>> = bodyChunks.map((chunk) => ({
      type: "section",
      text: {
        type: "mrkdwn",
        text: chunk,
      },
    }));

    // メタ情報コンテキストブロック
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${metaLine}${prHint}`,
        },
      ],
    });

    return {
      text: fullText,
      blocks,
    };
  }

  /**
   * AGY 実行結果メッセージをプレーンテキスト用にフォーマット
   */
  public static formatResult(params: FormatResultParams): string {
    const durationSec = (params.durationMs / 1000).toFixed(1);
    const metaParts: string[] = [`👤 実行者: \`${params.osUser}\``, `⏱️ ${durationSec}s`];

    if (params.branchName) {
      metaParts.push(`🌿 \`${params.branchName}\``);
    }

    if (params.conversationId) {
      metaParts.push(`🆔 \`${params.conversationId.slice(0, 8)}...\``);
    }

    const divider = "────────────────────────────────────";
    const formattedBody = this.markdownToMrkdwn(params.response.trim());
    const lines = [formattedBody, "", divider, metaParts.join(" | ")];

    if (params.showPrHint !== false) {
      lines.push("💡 `!pr [タイトル]` で GitHub に Pull Request を作成できます。");
    }

    return lines.join("\n");
  }

  /**
   * 標準 Markdown (CommonMark/GFM) を Slack の mrkdwn 構文に変換
   */
  public static markdownToMrkdwn(text: string): string {
    if (!text) return "";

    // 1. コードブロック (```lang ... ```) をプレースホルダに退避
    const codeBlocks: string[] = [];
    let converted = text.replace(/```([\s\S]*?)```/g, (match) => {
      codeBlocks.push(match);
      return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });

    // 2. インラインコード (`...`) をプレースホルダに退避
    const inlineCodes: string[] = [];
    converted = converted.replace(/`([^`\n]+)`/g, (match) => {
      inlineCodes.push(match);
      return `__INLINE_CODE_${inlineCodes.length - 1}__`;
    });

    // 3. ローカルファイルリンク [Title](file:///path/to/file.ext) の変換
    converted = converted.replace(/\[([^\]]+)\]\(file:\/\/\/([^)]+)\)/g, (_match, label, filePath) => {
      // ファイル名のみまたは末尾のパスを抽出
      const parts = filePath.split("/");
      const fileName = parts[parts.length - 1] || filePath;
      if (label === fileName || label.includes(fileName)) {
        return `\`${label}\``;
      }
      return `*${label}* (\`${fileName}\`)`;
    });

    // 4. Web リンク [Title](https://...) の変換 -> <https://...|Title>
    converted = converted.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "<$2|$1>");

    // 5. 見出し (# Header, ## Header, ### Header) -> *Header*
    converted = converted.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

    // 6. 太字 (**bold** または __bold__) -> *bold*
    converted = converted.replace(/\*\*([^*\n]+)\*\*/g, "*$1*");
    converted = converted.replace(/__([^_\n]+)__/g, "*$1*");

    // 7. GitHub Style Alert (> [!TIP], > [!NOTE], etc.)
    converted = converted.replace(
      /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/gim,
      (_m, type, rest) => {
        const icon = type.toUpperCase() === "WARNING" || type.toUpperCase() === "CAUTION" ? "⚠️" : "💡";
        return `> ${icon} *[${type.toUpperCase()}]* ${rest}`;
      },
    );

    // 8. 区切り線 (---, ***, ___) -> Slack 区切り実線
    converted = converted.replace(/^(\s*[-*_]\s*){3,}$/gm, "────────────────────────────────────");

    // 9. 箇条書きリスト (- item, + item, * item) -> • item
    converted = converted.replace(/^(\s*)[-+*]\s+(.+)$/gm, "$1• $2");

    // 10. インラインコードとコードブロックを復元
    converted = converted.replace(/__INLINE_CODE_(\d+)__/g, (_match, idx) => {
      return inlineCodes[Number(idx)] || "";
    });

    converted = converted.replace(/__CODE_BLOCK_(\d+)__/g, (_match, idx) => {
      return codeBlocks[Number(idx)] || "";
    });

    return converted;
  }

  /**
   * !help コマンド用の利用ガイドメッセージ
   */
  public static formatHelp(): string {
    return [
      "🤖 *Slack-AGY Bridge ヘルプ & コマンドガイド*",
      "",
      "Slack から Google Antigravity CLI (`agy`) を呼び出し、安全かつ自律的に開発タスクを実行します。",
      "",
      "*【利用可能なコマンド一覧】*",
      "• `!help` : このヘルプメッセージを表示します。",
      "• `!repo <repo_name | git_url>` : スレッドの作業対象リポジトリを指定します（初回は自動クローン & Worktree 作成）。",
      "• `!pr [title]` : 現在のブランチをプッシュし、GitHub に Pull Request を作成します。",
      "• `!status` / `!info` : 現在のスレッドの作業状態（OS ユーザー、Worktree パス、ブランチ、差分概要等）を表示します。",
      "• `!clean` / `!done` : 現在の Git Worktree を削除し、ディスク容量を解放します。",
      "• `!reset` : 現在のスレッドの対話履歴（conversation_id）を破棄し、新規セッションを開始します。",
      "• `!cancel` : 現在実行中の AGY タスクを緊急停止します。",
      "",
      "*【スタンプ（絵文字リアクション）連携】*",
      "• ⚠️ *確認・承認*: デプロイや危険操作の確認時、Bot が付与した ✅ / ❌ スタンプを押すことで実行を許可/中止できます。",
      "• ❓ *選択肢の回答*: 実装方針などの質問時、番号スタンプ（1️⃣, 2️⃣, 3️⃣）を押して回答を選択できます。",
      "",
      "※ 指示を送信する際は、このスレッド内で直接メッセージを入力するか、Bot をメンション（`@agy <指示>`）してください。",
    ].join("\n");
  }

  /**
   * !status コマンド用のスレッド状態表示
   */
  public static formatStatus(session?: SessionInfo, diffStat?: string): string {
    if (!session) {
      return "ℹ️ このスレッドには現在アクティブなセッションがありません。\n`@agy <リポジトリ名>` または `@agy !repo <リポジトリ名>` で作業を開始できます。";
    }

    const lines: string[] = [
      "📋 *【スレッド作業状態】*",
      `• *Slack ユーザー*: <@${session.slackUserId}>`,
      `• *OS ユーザー*: \`${session.osUser}\``,
      `• *対象リポジトリ*: \`${session.repoName}\``,
      `• *作業ブランチ*: \`${session.branchName}\``,
      `• *Worktree パス*: \`${session.worktreePath}\``,
      `• *ステータス*: \`${session.status}\``,
      `• *Conversation ID*: \`${session.conversationId || "未設定 (初回実行待ち)"}\``,
    ];

    if (diffStat && diffStat.trim()) {
      lines.push("", "*【変更差分概要】*", "```", diffStat.trim(), "```");
    } else {
      lines.push("", "• *差分*: 未コミットの変更はありません。");
    }

    return lines.join("\n");
  }

  /**
   * 未登録ユーザー向けの権限エラーメッセージ
   */
  public static formatUnauthorizedUser(slackUserId: string): string {
    return [
      `⚠️ *【アクセス拒否】* <@${slackUserId}>`,
      "あなたの Slack アカウントは Linux OS ユーザーと紐付けられていません。",
      "管理者に連絡して `SLACK_USER_OS_MAPPINGS` への登録を依頼してください。",
    ].join("\n");
  }

  /**
   * 一般エラーメッセージ
   */
  public static formatError(message: string, details?: string): string {
    const lines = [`❌ *【エラー】* ${message}`];
    if (details) {
      lines.push("```", details.trim(), "```");
    }
    return lines.join("\n");
  }
}
