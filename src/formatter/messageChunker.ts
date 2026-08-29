export const SLACK_MAX_TEXT_LENGTH = 10000; // Slack Markdown Block 累計上限 (12,000文字) に基づく安全上限

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
   * メッセージの長さを判定し、10,000文字以下ならテキスト（Slack Markdownブロック）、超える場合はファイルアップロード用データに変換
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

    // 長文の場合は先頭 1,500 文字をプレビューとして抜粋
    const previewExcerpt = content.slice(0, 1500).trim();
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
  public static splitIntoChunks(content: string, maxChunkSize = 3000): string[] {
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

  /**
   * Markdown の構造（テーブル、コードブロック）を壊さないように安全なチャンクに分割
   */
  public static splitIntoMarkdownChunks(content: string, maxChunkSize = 3000): string[] {
    if (content.length <= maxChunkSize) {
      return [content];
    }

    const lines = content.split("\n");
    const chunks: string[] = [];
    let currentChunk = "";
    let inCodeBlock = false;
    let inTable = false;
    let tableBuffer: string[] = [];

    const flushTableBuffer = () => {
      if (tableBuffer.length === 0) return;
      const tableText = tableBuffer.join("\n");
      tableBuffer = [];

      if ((currentChunk + "\n" + tableText).length > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = tableText;
      } else {
        currentChunk = currentChunk.length === 0 ? tableText : currentChunk + "\n" + tableText;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // コードブロックの判定
      if (trimmed.startsWith("```")) {
        // テーブルバッファがあれば先にフラッシュ
        if (inTable) {
          inTable = false;
          flushTableBuffer();
        }

        inCodeBlock = !inCodeBlock;
        if (
          (currentChunk + "\n" + line).length > maxChunkSize &&
          !inCodeBlock &&
          currentChunk.length > 0
        ) {
          // コードブロックの終了直後で上限を超える場合はここで分割
          currentChunk += "\n" + line;
          chunks.push(currentChunk);
          currentChunk = "";
          continue;
        }
      }

      // テーブル行の判定 (| で始まり | で終わる行)
      const isTableRow = !inCodeBlock && trimmed.startsWith("|") && trimmed.endsWith("|");

      if (isTableRow) {
        inTable = true;
        tableBuffer.push(line);
        continue;
      } else if (inTable) {
        inTable = false;
        flushTableBuffer();
      }

      if ((currentChunk + "\n" + line).length > maxChunkSize) {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = "";
        }
        if (line.length > maxChunkSize) {
          for (let j = 0; j < line.length; j += maxChunkSize) {
            chunks.push(line.slice(j, j + maxChunkSize));
          }
        } else {
          currentChunk = line;
        }
      } else {
        currentChunk = currentChunk.length === 0 ? line : currentChunk + "\n" + line;
      }
    }

    if (inTable) {
      flushTableBuffer();
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }
}
