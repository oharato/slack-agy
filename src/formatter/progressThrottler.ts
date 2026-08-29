import type { SlackClient } from "../interaction/interactionManager.js";
import { logger } from "../logger/index.js";

export interface ThrottledUpdateOptions {
  channelId: string;
  messageTs: string;
  minIntervalMs?: number; // default: 800ms
}

/**
 * Slack API の Rate Limit (429 Too Many Requests) を防止するため、
 * 高頻度な進捗更新をバッファリング・デバウンスして定期的に送信するスロットラー
 */
export class ProgressThrottler {
  private pendingText: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastExecutedAt = 0;
  private isUpdating = false;
  private readonly minIntervalMs: number;

  constructor(
    private readonly client: SlackClient,
    private readonly options: ThrottledUpdateOptions,
  ) {
    this.minIntervalMs = options.minIntervalMs ?? 800;
  }

  public update(text: string): void {
    this.pendingText = text;
    const now = Date.now();
    const elapsed = now - this.lastExecutedAt;

    if (elapsed >= this.minIntervalMs && !this.isUpdating && !this.timer) {
      this.flush();
    } else if (!this.timer) {
      const waitTime = Math.max(this.minIntervalMs - elapsed, 50);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, waitTime);
    }
  }

  public async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (!this.pendingText || this.isUpdating) {
      return;
    }

    const textToSend = this.pendingText;
    this.pendingText = null;
    this.isUpdating = true;

    try {
      await this.client.chat.update({
        channel: this.options.channelId,
        ts: this.options.messageTs,
        text: textToSend,
      });
      this.lastExecutedAt = Date.now();
    } catch (err) {
      logger.error("failed_to_update_throttled_progress", err, {
        channelId: this.options.channelId,
        messageTs: this.options.messageTs,
      });
    } finally {
      this.isUpdating = false;
      // 送信中に新しいテキストが溜まっていた場合は再度スケジュール
      if (this.pendingText) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.flush();
        }, this.minIntervalMs);
      }
    }
  }

  public cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingText = null;
  }
}
