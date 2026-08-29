import type { App } from "@slack/bolt";
import { UserMapper } from "../config/userMap.js";
import { AppConfig } from "../config/schema.js";
import { commandRouter } from "./commandRouter.js";
import { sessionStore } from "../session/sessionStore.js";
import { worktreeManager } from "../workspace/worktreeManager.js";
import { extractRepoFromPrompt } from "../workspace/repoUtils.js";
import { privilegeRunner } from "../runner/privilegeRunner.js";
import { taskQueue } from "../queue/taskQueue.js";
import { ProgressThrottler } from "../formatter/progressThrottler.js";
import { ProgressCard } from "../formatter/progressCard.js";
import { SlackFormatter } from "../formatter/slackFormatter.js";
import { MessageChunker } from "../formatter/messageChunker.js";
import { logger } from "../logger/index.js";

export interface MentionHandlerOptions {
  userMapper: UserMapper;
  config: AppConfig;
}

const processedMentions = new Set<string>();

export function registerMentionHandler(app: App, options: MentionHandlerOptions): void {
  const { userMapper, config } = options;

  app.event("app_mention", async ({ event, client }) => {
    const channelId = event.channel;
    const slackUserId = event.user;
    const messageTs = event.ts;
    const threadTs = event.thread_ts || event.ts;
    const text = event.text;

    if (!slackUserId || !messageTs) {
      return;
    }

    // 同一メッセージの重複処理防止
    if (processedMentions.has(messageTs)) {
      return;
    }
    processedMentions.add(messageTs);
    setTimeout(() => processedMentions.delete(messageTs), 60000);

    logger.info("app_mention_received", {
      channelId,
      slackUserId,
      messageTs,
      threadTs,
      text,
    });

    // 1. チャンネル制限チェック
    if (config.ALLOWED_CHANNEL_IDS.length > 0 && !config.ALLOWED_CHANNEL_IDS.includes(channelId)) {
      logger.warn("mention_in_unauthorized_channel", { channelId, slackUserId });
      return;
    }

    // 2. ユーザー認証チェック (Slack User ⇄ OS User)
    const osUser = userMapper.getOsUser(slackUserId);
    if (!osUser) {
      logger.warn("unauthorized_slack_user", { slackUserId });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: SlackFormatter.formatUnauthorizedUser(slackUserId),
      });
      return;
    }

    // 3. コマンド処理の試行 (!help, !repo, !pr, !status, !clean, !reset, !cancel)
    const isHandled = await commandRouter.handleIfCommand({
      client,
      channelId,
      threadTs,
      slackUserId,
      osUser,
      text,
    });
    if (isHandled) {
      return;
    }

    // 4. 自然言語プロンプトおよびリポジトリ指定の抽出
    const rawPrompt = text.replace(/<@[A-Z0-9]+>/g, "").trim();
    const { repoNameOrUrl: specifiedRepo, cleanedPrompt: prompt } =
      extractRepoFromPrompt(rawPrompt);

    // 5. セッション & Worktree の確認と準備
    let session = sessionStore.getSessionByThread(channelId, threadTs);
    const repoTarget = specifiedRepo || session?.repoName || config.DEFAULT_REPO;

    try {
      if (!session || (specifiedRepo && session.repoName !== specifiedRepo)) {
        if (repoTarget) {
          // リポジトリ指定あり: Git Worktree を作成
          const { repoName } = await worktreeManager.ensureRepo(
            repoTarget,
            osUser,
            config.DEFAULT_BASE_BRANCH,
          );
          const safeKey = threadTs.replace(/[^a-zA-Z0-9_-]/g, "_");
          const branchName = `feat/${osUser}-thread-${safeKey}`;
          const threadKey = `${channelId}:${threadTs}`;

          const { worktreePath } = await worktreeManager.getOrCreateWorktree(
            repoName,
            threadKey,
            branchName,
            osUser,
          );

          session = sessionStore.createSession({
            channelId,
            threadTs,
            slackUserId,
            osUser,
            repoName,
            branchName,
            worktreePath,
          });

          // 初回作成時の案内メッセージ
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: [
              `👤 *実行ユーザー*: <@${slackUserId}> (\`${osUser}\`)`,
              `📂 *作業ワークツリー*: \`${worktreePath}\``,
              `🌿 *ブランチ*: \`${branchName}\``,
            ].join("\n"),
          });
        } else {
          // リポジトリ指定なし: 自由相談・一般調査モード (ユーザーのホームディレクトリ等で実行)
          const homeDir = `/home/${osUser}`;
          session = sessionStore.createSession({
            channelId,
            threadTs,
            slackUserId,
            osUser,
            worktreePath: homeDir,
          });

          // 初回作成時の案内メッセージ
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: [
              `👤 *実行ユーザー*: <@${slackUserId}> (\`${osUser}\`)`,
              `💬 *モード*: 自由相談・一般調査 (リポジトリ未指定)`,
              `💡 \`repo:<リポジトリ名>\` または \`!repo <リポジトリ名>\` で特定リポジトリでの作業にいつでも切り替えられます。`,
            ].join("\n"),
          });
        }
      }
    } catch (err) {
      logger.error("failed_to_prepare_worktree", err, { repoTarget, osUser });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: SlackFormatter.formatError("作業ワークスペースの準備に失敗しました", String(err)),
      });
      return;
    }

    const currentSession = session;
    const threadKey = currentSession.threadKey;

    // 6. 受付メッセージの投稿
    const initialMsg = await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `⏳ *AGY タスクを受け付けました...* (準備中)`,
    });

    const progressMsgTs = initialMsg.ts;
    if (!progressMsgTs) {
      logger.error("missing_progress_message_ts");
      return;
    }

    // 7. TaskQueue 経由で AGY プロセスを実行
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
          cwd: currentSession.worktreePath,
          osUser: currentSession.osUser,
          conversationId: currentSession.conversationId,
          timeoutMs: config.TASK_TIMEOUT_MS,
          onReasoning: (text) => {
            reasoningSnippet = text;
            throttler.update(
              ProgressCard.render({
                osUser: currentSession.osUser,
                repoName: currentSession.repoName,
                branchName: currentSession.branchName,
                worktreePath: currentSession.worktreePath,
                startedAt,
                reasoningSnippet,
                activeTool,
                recentTools,
              }),
            );
          },
          onToolCall: (toolName) => {
            activeTool = toolName;
            if (!recentTools.includes(toolName)) {
              recentTools.push(toolName);
            }
            throttler.update(
              ProgressCard.render({
                osUser: currentSession.osUser,
                repoName: currentSession.repoName,
                branchName: currentSession.branchName,
                worktreePath: currentSession.worktreePath,
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
                osUser: currentSession.osUser,
                repoName: currentSession.repoName,
                branchName: currentSession.branchName,
                worktreePath: currentSession.worktreePath,
                startedAt,
                reasoningSnippet,
                activeTool,
                recentTools,
                lastUpdateSnippet: snippet.slice(0, 150),
              }),
            );
          },
        });

        // スロットラーをキャンセル（完了通知を直ちに送るため）
        throttler.cancel();

        // セッションの conversationId を保存
        sessionStore.updateSession(threadKey, {
          status: "idle",
          conversationId: agyResult.conversationId || currentSession.conversationId,
        });

        const formattedBlocks = SlackFormatter.formatResultBlocks({
          response: agyResult.response || "実行が完了しました。",
          osUser: currentSession.osUser,
          durationMs: agyResult.durationMs,
          branchName: currentSession.branchName,
          conversationId: agyResult.conversationId,
          showPrHint: Boolean(currentSession.repoName),
        });

        const chunked = MessageChunker.processMessage(formattedBlocks.text, {
          defaultFilename: "agy_result.txt",
          title: currentSession.branchName
            ? `AGY 実行結果 (${currentSession.branchName})`
            : "AGY 実行結果",
        });

        if (chunked.type === "file") {
          try {
            await client.chat.update({
              channel: channelId,
              ts: progressMsgTs,
              text: `✅ *AGY 実行完了* (${(agyResult.durationMs / 1000).toFixed(1)}s)\n\n${chunked.previewText || "文字数制限超過のため結果をファイル添付しました。"}`,
            });
          } catch {
            // ignore
          }

          // files.uploadV2 でスニペットファイルをアップロード
          await client.files.uploadV2({
            channel_id: channelId,
            thread_ts: threadTs,
            content: chunked.content,
            filename: chunked.filename,
            title: chunked.title,
          });
        } else {
          try {
            await client.chat.update({
              channel: channelId,
              ts: progressMsgTs,
              text: formattedBlocks.text,
              blocks: formattedBlocks.blocks as any,
            });
          } catch (updateErr) {
            logger.warn("failed_to_update_progress_msg_posting_new", { error: String(updateErr) });
            await client.chat.postMessage({
              channel: channelId,
              thread_ts: threadTs,
              text: formattedBlocks.text,
              blocks: formattedBlocks.blocks as any,
            });
          }
        }
      } catch (err) {
        throttler.cancel();
        sessionStore.updateSession(threadKey, { status: "idle" });

        logger.error("error_during_agy_execution", err, { threadKey });
        await client.chat.update({
          channel: channelId,
          ts: progressMsgTs,
          text: SlackFormatter.formatError("AGY の実行中にエラーが発生しました", String(err)),
        });
      }
    });
  });
}
