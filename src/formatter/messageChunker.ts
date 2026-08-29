export const SLACK_MAX_TEXT_LENGTH = 2800; // Slack API の安全上限 (ブロックサイズ・メタデータ含む)

export interface ChunkedMessage {
  type: "text" | "file";
  content: string;
  previewText?: string;
  filename?: string;
  filetype?: string;
  title?: string;
}

export class MessageChunker {
  /**
   * メッセージの長さを判定し、2,800文字以下ならテキスト、超える場合はファイルアップロード用データに変換
   */
  public static processMessage(
    content: string,
    options: {
      defaultFilename?: string;
      title?: string;
      filetype?: string;
    } = {},
  ): ChunkedMessage {
    if (content.length <= SLACK_MAX_TEXT_LENGTH) {
      return {
        type: "text",
        content,
      };
    }

    // 長文の場合は先頭 1,200 文字をプレビューとして抜粋
    const previewExcerpt = content.slice(0, 1200).trim();
    const previewText = `${previewExcerpt}\n\n...（省略: 全文は下記の添付スニペットファイルを参照してください）`;

    return {
      type: "file",
      content,
      previewText,
      filename: options.defaultFilename ?? "output.txt",
      filetype: options.filetype ?? "text",
      title: options.title ?? "AGY 実行結果 / 差分詳細",
    };
  }

  /**
   * 複数行の長文テキストを安全なサイズごとのチャンクに分割
   */
  public static splitIntoChunks(content: string, maxChunkSize = SLACK_MAX_TEXT_LENGTH): string[] {
    if (content.length <= maxChunkSize) {
      return [content];
    }

    const lines = content.split("\n");
    const chunks: string[] = [];
    let currentChunk = "";

    for (const line of lines) {
      if ((currentChunk + "\n" + line).length > maxChunkSize) {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = "";
        }
        if (line.length > maxChunkSize) {
          // 1行自体が制限を超える場合は文字単位で強制分割
          for (let i = 0; i < line.length; i += maxChunkSize) {
            chunks.push(line.slice(i, i + maxChunkSize));
          }
        } else {
          currentChunk = line;
        }
      } else {
        currentChunk = currentChunk.length === 0 ? line : currentChunk + "\n" + line;
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }
}
