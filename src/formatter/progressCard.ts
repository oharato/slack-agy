export interface ProgressCardParams {
  osUser: string;
  repoName?: string;
  branchName?: string;
  worktreePath: string;
  startedAt: number;
  reasoningSnippet?: string;
  activeTool?: string;
  recentTools?: string[];
  lastUpdateSnippet?: string;
}

export class ProgressCard {
  /**
   * AGY 実行中のリアルタイム進捗カードテキストを生成
   */
  public static render(params: ProgressCardParams): string {
    const elapsedSeconds = Math.round((Date.now() - params.startedAt) / 1000);
    const border = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

    const lines: string[] = [
      border,
      `⚙️ *AGY 実行中...* (OS User: \`${params.osUser}\` | 経過時間: ${elapsedSeconds}秒)`,
      border,
    ];

    if (params.branchName) {
      lines.push(`🌿 *Branch*: \`${params.branchName}\``);
    } else {
      lines.push(`💬 *Mode*: \`自由相談・一般調査\``);
    }
    lines.push(`📂 *CWD*: \`${params.worktreePath}\``, "");

    if (params.reasoningSnippet) {
      const truncatedReasoning =
        params.reasoningSnippet.length > 200
          ? params.reasoningSnippet.slice(0, 200) + "..."
          : params.reasoningSnippet;
      lines.push(`▶ *思考中*: _${truncatedReasoning}_`);
    }

    if (params.recentTools && params.recentTools.length > 0) {
      for (const tool of params.recentTools.slice(-3)) {
        lines.push(`✔ ツール実行完了: \`${tool}\``);
      }
    }

    if (params.activeTool) {
      lines.push(`⚙ ツール実行中: \`${params.activeTool}\``);
    }

    if (params.lastUpdateSnippet) {
      lines.push(`\n💬 ${params.lastUpdateSnippet}`);
    }

    lines.push(border);

    return lines.join("\n");
  }
}
