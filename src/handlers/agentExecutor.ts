import type { App } from "@slack/bolt";
import { AppConfig } from "../config/schema.js";
import { SessionInfo } from "../session/types.js";
import { sessionStore } from "../session/sessionStore.js";
import { agentRegistry } from "../agent/agentRegistry.js";
import { taskQueue } from "../queue/taskQueue.js";
import { ProgressThrottler } from "../formatter/progressThrottler.js";
import { ProgressCard } from "../formatter/progressCard.js";
import { SlackFormatter } from "../formatter/slackFormatter.js";
import { MessageChunker } from "../formatter/messageChunker.js";
import { OptionDetector } from "../interaction/optionDetector.js";
import { interactionManager } from "../interaction/interactionManager.js";
import { InteractionOption } from "../interaction/types.js";
import { logger } from "../logger/index.js";

export type SlackClient = App["client"];

export interface ExecuteAgentTurnParams {
  client: SlackClient;
  session: SessionInfo;
  prompt: string;
  slackUserId: string;
  config: AppConfig;
  initialMessageTs?: string;
  selectedOptionLabel?: string;
}

export class AgentExecutor {
  /**
   * スレッド内でエージェントの1ターンを実行し、進捗通知と結果投稿、選択肢登録を行う
   */
  public static async executeAgentTurn(params: ExecuteAgentTurnParams): Promise<void> {
    const { client, session, prompt, slackUserId, config, initialMessageTs, selectedOptionLabel } =
      params;

    const threadKey = session.threadKey;
    const channelId = session.channelId;
    const threadTs = session.threadTs;
    const runningAgentId = session.agentId || config.DEFAULT_AGENT;

    // 選択肢が選ばれて自動実行された場合、スレッドに案内メッセージを投稿
    if (selectedOptionLabel) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `👉 <@${slackUserId}> が選択しました：\n*${selectedOptionLabel}*\n処理を続行します...`,
      });
    }

    let progressMsgTs = initialMessageTs;
    if (!progressMsgTs) {
      const initialMsg = await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `⏳ *${runningAgentId.toUpperCase()} 実行中...*`,
      });
      progressMsgTs = initialMsg.ts;
    }

    if (!progressMsgTs) {
      logger.error("missing_progress_message_ts", { threadKey });
      return;
    }

    await taskQueue.enqueue(threadKey, async () => {
      // 最新のセッション状態を取得
      const currentSession = sessionStore.getSession(threadKey) || session;
      sessionStore.updateSession(threadKey, { status: "running" });

      const throttler = new ProgressThrottler(client, {
        channelId,
        messageTs: progressMsgTs!,
        minIntervalMs: config.PROGRESS_THROTTLE_MS,
      });

      const startedAt = Date.now();
      const recentTools: string[] = [];
      let activeTool: string | undefined;
      let reasoningSnippet: string | undefined;

      try {
        const agent = agentRegistry.get(runningAgentId);
        const agentResult = await agent.run({
          taskId: threadKey,
          prompt,
          cwd: currentSession.worktreePath,
          osUser: currentSession.osUser,
          sessionId: currentSession.conversationId,
          timeoutMs: config.TASK_TIMEOUT_MS,
          onEvent: (event) => {
            if (event.type === "tool_call") {
              activeTool = event.name;
              if (!recentTools.includes(event.name)) recentTools.push(event.name);
            } else if (event.type === "progress") {
              activeTool = undefined;
              reasoningSnippet = event.text;
            }
            throttler.update(
              ProgressCard.render({
                osUser: currentSession.osUser,
                agentId: runningAgentId,
                repoName: currentSession.repoName,
                branchName: currentSession.branchName,
                worktreePath: currentSession.worktreePath,
                startedAt,
                reasoningSnippet,
                activeTool,
                recentTools,
                lastUpdateSnippet: event.type === "progress" ? event.text.slice(0, 150) : undefined,
              }),
            );
          },
        });

        throttler.cancel();

        const newSessionId = agentResult.sessionId || currentSession.conversationId;
        sessionStore.updateSession(threadKey, {
          status: "idle",
          conversationId: newSessionId,
        });

        const rawResponse = agentResult.response || "実行が完了しました。";

        // エージェント応答から選択肢を自動検出
        const detectedChoice = OptionDetector.detect(rawResponse);
        const choiceOptions = detectedChoice?.options;

        const formattedBlocks = SlackFormatter.formatResultBlocks({
          response: rawResponse,
          osUser: currentSession.osUser,
          agentId: runningAgentId,
          durationMs: agentResult.durationMs,
          branchName: currentSession.branchName,
          conversationId: newSessionId,
          showPrHint: Boolean(currentSession.repoName),
          options: choiceOptions,
        });

        const chunked = MessageChunker.processMessage(formattedBlocks.text, {
          defaultFilename: `${runningAgentId}_result.txt`,
          title: currentSession.branchName
            ? `${runningAgentId.toUpperCase()} 実行結果 (${currentSession.branchName})`
            : `${runningAgentId.toUpperCase()} 実行結果`,
        });

        let finalResultMsgTs = progressMsgTs!;

        if (chunked.type === "file") {
          try {
            await client.chat.update({
              channel: channelId,
              ts: progressMsgTs!,
              text: `✅ *${runningAgentId.toUpperCase()} 実行完了* (${(agentResult.durationMs / 1000).toFixed(1)}s)\n\n${chunked.previewText || "文字数制限超過のため結果をファイル添付しました。"}`,
            });
          } catch {
            // ignore
          }

          const fileUploadRes = await client.files.uploadV2({
            channel_id: channelId,
            thread_ts: threadTs,
            content: chunked.content,
            filename: chunked.filename,
            title: chunked.title,
          });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((fileUploadRes as any)?.file?.shares?.public?.[channelId]?.[0]?.ts) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            finalResultMsgTs = (fileUploadRes as any).file.shares.public[channelId][0].ts;
          }
        } else {
          try {
            await client.chat.update({
              channel: channelId,
              ts: progressMsgTs!,
              text: formattedBlocks.text,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              blocks: formattedBlocks.blocks as any,
            });
          } catch (updateErr) {
            logger.warn("failed_to_update_progress_msg_posting_new", { error: String(updateErr) });
            const newMsg = await client.chat.postMessage({
              channel: channelId,
              thread_ts: threadTs,
              text: formattedBlocks.text,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              blocks: formattedBlocks.blocks as any,
            });
            if (newMsg.ts) {
              finalResultMsgTs = newMsg.ts;
            }
          }
        }

        // 選択肢が検出された場合、Bot がスタンプを付与して次回ターン用に登録
        if (choiceOptions && choiceOptions.length > 0) {
          await interactionManager.registerMessageChoices(client, {
            channelId,
            threadTs,
            messageTs: finalResultMsgTs,
            allowedSlackUserId: slackUserId,
            osUser: currentSession.osUser,
            agentId: runningAgentId,
            options: choiceOptions,
            onSelect: async (selectedOption: InteractionOption, selectingUserId: string) => {
              logger.info("choice_selected_triggering_followup_turn", {
                threadKey,
                selectingUserId,
                optionValue: selectedOption.value,
              });

              // ユーザーが選択した選択肢で次のターンを自動実行
              await AgentExecutor.executeAgentTurn({
                client,
                session: sessionStore.getSession(threadKey) || currentSession,
                prompt: selectedOption.value,
                slackUserId: selectingUserId,
                config,
                selectedOptionLabel: `${selectedOption.displayEmoji} ${selectedOption.label}`,
              });
            },
          });
        }
      } catch (err) {
        throttler.cancel();
        sessionStore.updateSession(threadKey, { status: "idle" });

        logger.error("error_during_agent_turn_execution", err, {
          threadKey,
          agentId: runningAgentId,
        });

        await client.chat.update({
          channel: channelId,
          ts: progressMsgTs!,
          text: SlackFormatter.formatError(
            `${runningAgentId.toUpperCase()} の実行中にエラーが発生しました`,
            String(err),
          ),
        });
      }
    });
  }
}
