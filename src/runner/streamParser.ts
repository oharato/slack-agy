import { EventEmitter } from "node:events";
import { AgyEvent } from "./types.js";
import { logger } from "../logger/index.js";

export class StreamParser extends EventEmitter {
  private buffer = "";

  /**
   * stdout からのチャンクデータをパース
   */
  public push(chunk: string | Buffer): void {
    this.buffer += chunk.toString();
    const lines = this.buffer.split("\n");

    // 最後の不完全な行をバッファに残す
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed) as AgyEvent;
        this.emit("event", parsed);
      } catch {
        // JSON 以外の標準出力（プレーンテキスト警告やメッセージ）
        logger.debug("non_json_stream_output", { line: trimmed });
        this.emit("raw", trimmed);
      }
    }
  }

  /**
   * ストリーム終了時に残ったバッファをフラッシュ
   */
  public end(): void {
    if (this.buffer.trim()) {
      try {
        const parsed = JSON.parse(this.buffer.trim()) as AgyEvent;
        this.emit("event", parsed);
      } catch {
        this.emit("raw", this.buffer.trim());
      }
      this.buffer = "";
    }
    this.emit("end");
  }
}
