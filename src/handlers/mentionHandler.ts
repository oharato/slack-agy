import type { App } from "@slack/bolt";
import { UserMapper } from "../config/userMap.js";
import { AppConfig } from "../config/schema.js";
import { commandRouter } from "./commandRouter.js";
import { sessionStore } from "../session/sessionStore.js";
import { worktreeManager } from "../workspace/worktreeManager.js";
import { extractPromptOptions } from "../workspace/repoUtils.js";
import { agentRegistry } from "../agent/agentRegistry.js";
import { AgentExecutor } from "./agentExecutor.js";
import { SlackFormatter } from "../formatter/slackFormatter.js";
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

    // 3. コマンド処理の試行 (!help, !agent, !repo, !pr, !status, !clean, !reset, !cancel)
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

    // 4. 自然言語プロンプト、エージェント指定、リポジトリ指定の抽出
    const rawPrompt = text.replace(/<@[A-Z0-9]+>/g, "").trim();
    const {
      agentId: promptAgentId,
      repoNameOrUrl: specifiedRepo,
      cleanedPrompt: prompt,
    } = extractPromptOptions(rawPrompt);

    // エージェントの有効性検証
    if (promptAgentId && !agentRegistry.has(promptAgentId)) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: SlackFormatter.formatError(
          `未対応のエージェントです: \`${promptAgentId}\``,
          `利用可能なエージェント: ${agentRegistry.list().join(", ")}`,
        ),
      });
      return;
    }

    // 5. セッション & Worktree の確認と準備
    let session = sessionStore.getSessionByThread(channelId, threadTs);
    const effectiveAgent = promptAgentId || session?.agentId || config.DEFAULT_AGENT;

    // 既存セッションで異なるエージェントがプロンプト指定された場合、対話履歴をリセットして切り替え
    if (session && promptAgentId && session.agentId !== promptAgentId) {
      sessionStore.updateSession(session.threadKey, {
        agentId: promptAgentId as any,
        conversationId: undefined,
      });
      session = sessionStore.getSessionByThread(channelId, threadTs);
    }

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
            agentId: effectiveAgent as any,
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
              `🤖 *エージェント*: \`${effectiveAgent}\``,
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
            agentId: effectiveAgent as any,
            worktreePath: homeDir,
          });

          // 初回作成時の案内メッセージ
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: [
              `👤 *実行ユーザー*: <@${slackUserId}> (\`${osUser}\`)`,
              `🤖 *エージェント*: \`${effectiveAgent}\``,
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

    const currentSession = session!;

    // 6. AgentExecutor 経由でタスクを実行 (進捗表示、結果フォーマット、選択肢自動登録・連携)
    await AgentExecutor.executeAgentTurn({
      client,
      session: currentSession,
      prompt,
      slackUserId,
      config,
    });

  });
}

