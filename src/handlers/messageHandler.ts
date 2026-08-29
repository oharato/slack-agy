import type { App } from "@slack/bolt";
import { UserMapper } from "../config/userMap.js";
import { AppConfig } from "../config/schema.js";
import { commandRouter } from "./commandRouter.js";
import { sessionStore } from "../session/sessionStore.js";
import { privilegeRunner } from "../runner/privilegeRunner.js";
import { taskQueue } from "../queue/taskQueue.js";
import { ProgressThrottler } from "../formatter/progressThrottler.js";
import { ProgressCard } from "../formatter/progressCard.js";
import { SlackFormatter } from "../formatter/slackFormatter.js";
import { MessageChunker } from "../formatter/messageChunker.js";
import { logger } from "../logger/index.js";

export interface MessageHandlerOptions {
  userMapper: UserMapper;
  config: AppConfig;
}

export function registerMessageHandler(app: App, options: MessageHandlerOptions): void {
  const { userMapper, config } = options;

  app.event("message", async ({ event, client }) => {
    // 自身 (Bot) のメッセージやサブタイプ付きメッセージは無視
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawEvent = event as any;
    if (rawEvent.subtype || rawEvent.bot_id || !rawEvent.text || !rawEvent.user) {
      return;
    }

    const channelId = rawEvent.channel;
    const slackUserId = rawEvent.user;
    const threadTs = rawEvent.thread_ts;
    const text = rawEvent.text;

    // スレッド外の通常メッセージは app_mention で受け取るため、thread_ts がない場合はスキップ（DM以外）
    const isDirectMessage = rawEvent.channel_type === "im";
    if (!threadTs && !isDirectMessage) {
      return;
    }

    const effectiveThreadTs = threadTs || rawEvent.ts;

    // 既存セッションが存在するか確認
    const session = sessionStore.getSessionByThread(channelId, effectiveThreadTs);
    if (!session) {
      return;
    }

    // チャンネル制限
    if (config.ALLOWED_CHANNEL_IDS.length > 0 && !config.ALLOWED_CHANNEL_IDS.includes(channelId)) {
      return;
    }

    // ユーザー認証チェック
    const osUser = userMapper.getOsUser(slackUserId);
    if (!osUser) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: effectiveThreadTs,
        text: SlackFormatter.formatUnauthorizedUser(slackUserId),
      });
      return;
    }

    // コマンドチェック
    const isHandled = await commandRouter.handleIfCommand({
      client,
      channelId,
      threadTs: effectiveThreadTs,
      slackUserId,
      osUser,
      text,
    });
    if (isHandled) {
      return;
    }

    // 自然言語プロンプトの実行
    const prompt = text.replace(/<@[A-Z0-9]+>/g, "").trim();
    const threadKey = session.threadKey;

    const initialMsg = await client.chat.postMessage({
      channel: channelId,
      thread_ts: effectiveThreadTs,
      text: `⏳ *AGY 実行中...*`,
    });

    const progressMsgTs = initialMsg.ts;
    if (!progressMsgTs) return;

    await taskQueue.enqueue(threadKey, async () => {
      sessionStore.updateSession(threadKey, { status: "running" });

      const throttler = new ProgressThrottler(client, {
        channelId,
        messageTs: progressMsgTs,
        minIntervalMs: config.PROGRESS_THROTTLE_MS,
      });

      const startedAt = Date.now();
      const recentTools: string[] = [];
      let activeTool: string | undefined;
      let reasoningSnippet: string | undefined;

      try {
        const agyResult = await privilegeRunner.runAgy(threadKey, {
          prompt,
          cwd: session.worktreePath,
          osUser: session.osUser,
          conversationId: session.conversationId,
          timeoutMs: config.TASK_TIMEOUT_MS,
          onReasoning: (t) => {
            reasoningSnippet = t;
            throttler.update(
              ProgressCard.render({
                osUser: session.osUser,
                repoName: session.repoName,
                branchName: session.branchName,
                worktreePath: session.worktreePath,
                startedAt,
                reasoningSnippet,
                activeTool,
                recentTools,
              }),
            );
          },
          onToolCall: (name) => {
            activeTool = name;
            if (!recentTools.includes(name)) recentTools.push(name);
            throttler.update(
              ProgressCard.render({
                osUser: session.osUser,
                repoName: session.repoName,
                branchName: session.branchName,
                worktreePath: session.worktreePath,
                startedAt,
                reasoningSnippet,
                activeTool,
                recentTools,
              }),
            );
          },
          onProgress: (snippet) => {
            activeTool = undefined;
            throttler.update(
              ProgressCard.render({
                osUser: session.osUser,
                repoName: session.repoName,
                branchName: session.branchName,
                worktreePath: session.worktreePath,
                startedAt,
                reasoningSnippet,
                activeTool,
                recentTools,
                lastUpdateSnippet: snippet.slice(0, 150),
              }),
            );
          },
        });

        throttler.cancel();

        sessionStore.updateSession(threadKey, {
          status: "idle",
          conversationId: agyResult.conversationId || session.conversationId,
        });

        const formattedResult = SlackFormatter.formatResult({
          response: agyResult.response || "実行が完了しました。",
          osUser: session.osUser,
          durationMs: agyResult.durationMs,
          branchName: session.branchName,
          conversationId: agyResult.conversationId,
        });

        const chunked = MessageChunker.processMessage(formattedResult, {
          defaultFilename: "agy_result.txt",
          title: `AGY 実行結果 (${session.branchName})`,
        });

        if (chunked.type === "file") {
          try {
            await client.chat.update({
              channel: channelId,
              ts: progressMsgTs,
              text: `✅ *AGY 実行完了* (${(agyResult.durationMs / 1000).toFixed(1)}s)\n文字数制限超過のため結果をファイル添付しました。`,
            });
          } catch {
            // ignore
          }

          await client.files.uploadV2({
            channel_id: channelId,
            thread_ts: effectiveThreadTs,
            content: chunked.content,
            filename: chunked.filename,
            title: chunked.title,
          });
        } else {
          try {
            await client.chat.update({
              channel: channelId,
              ts: progressMsgTs,
              text: formattedResult,
            });
          } catch (updateErr) {
            logger.warn("failed_to_update_progress_msg_posting_new", { error: String(updateErr) });
            await client.chat.postMessage({
              channel: channelId,
              thread_ts: effectiveThreadTs,
              text: formattedResult,
            });
          }
        }
      } catch (err) {
        throttler.cancel();
        sessionStore.updateSession(threadKey, { status: "idle" });

        logger.error("error_during_thread_message_agy_execution", err, { threadKey });
        await client.chat.update({
          channel: channelId,
          ts: progressMsgTs,
          text: SlackFormatter.formatError("AGY の実行中にエラーが発生しました", String(err)),
        });
      }
    });
  });
}
