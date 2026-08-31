import type { App } from "@slack/bolt";
import {
  PendingInteraction,
  InteractionOption,
  InteractionResult,
  RequestApprovalParams,
  RequestQuestionParams,
  RegisterMessageChoicesParams,
  RegisteredMessageChoice,
  NUMBER_EMOJIS,
} from "./types.js";
import { logger } from "../logger/index.js";
import { auditLogger } from "../logger/auditLogger.js";

export type SlackClient = App["client"];

export class InteractionManager {
  private pendingInteractions = new Map<string, PendingInteraction>();
  private registeredChoices = new Map<string, RegisteredMessageChoice>();

  private getKey(channelId: string, messageTs: string): string {
    return `${channelId}:${messageTs}`;
  }

  /**
   * 実行許可 (Yes/No) のインタラクション要求を Slack に投稿し、スタンプを自動付与して待機
   */
  public async requestApproval(
    client: SlackClient,
    params: RequestApprovalParams,
  ): Promise<InteractionResult> {
    const {
      channelId,
      threadTs,
      allowedSlackUserId,
      osUser,
      title,
      description,
      timeoutMs = 300000, // デフォルト 5 分
    } = params;

    const options: InteractionOption[] = [
      {
        emoji: "white_check_mark",
        displayEmoji: "✅",
        label: "許可して続行 (Approve)",
        value: "approve",
        isApproval: true,
      },
      {
        emoji: "x",
        displayEmoji: "❌",
        label: "拒否して中止 (Deny)",
        value: "deny",
        isApproval: false,
      },
    ];

    const messageText = [
      `⚠️ *【確認・許可要求】* <@${allowedSlackUserId}>`,
      `*${title}*`,
      description ? `\n> ${description.replace(/\n/g, "\n> ")}\n` : "",
      `👇 下のスタンプまたはボタンを押して回答してください：`,
      `  • ✅ (\`:white_check_mark:\`) : 許可して続行`,
      `  • ❌ (\`:x:\`) : 拒否して中止`,
    ]
      .filter(Boolean)
      .join("\n");

    const postResult = await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: messageText,
    });

    const messageTs = postResult.ts;
    if (!messageTs) {
      throw new Error("Failed to post approval message to Slack (no messageTs returned)");
    }

    // Bot 自身が選択肢スタンプを自動付与
    for (const opt of options) {
      try {
        await client.reactions.add({
          channel: channelId,
          timestamp: messageTs,
          name: opt.emoji,
        });
      } catch (err) {
        logger.warn("failed_to_add_approval_reaction", { emoji: opt.emoji, error: String(err) });
      }
    }

    return new Promise<InteractionResult>((resolve, reject) => {
      const interactionId = `approval_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const key = this.getKey(channelId, messageTs);

      const timerId = setTimeout(async () => {
        this.pendingInteractions.delete(key);
        logger.warn("interaction_timeout", { interactionId, channelId, messageTs, osUser });

        try {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: `⏱️ *【タイムアウト】* 回答制限時間（5分）を超過したため、安全のため操作を中断しました。`,
          });
        } catch (err) {
          logger.error("failed_to_update_timeout_message", err);
        }

        resolve({
          interactionId,
          selectedOption: options[1], // デフォルト: deny
          selectedByUserId: "SYSTEM_TIMEOUT",
          respondedAt: new Date().toISOString(),
          timedOut: true,
        });
      }, timeoutMs);

      this.pendingInteractions.set(key, {
        id: interactionId,
        type: "approval",
        channelId,
        threadTs,
        messageTs,
        allowedSlackUserId,
        osUser,
        title,
        description,
        options,
        createdAt: Date.now(),
        timeoutMs,
        resolve,
        reject,
        timerId,
      });

      logger.info("approval_requested", {
        interactionId,
        slackUserId: allowedSlackUserId,
        osUser,
        title,
      });
    });
  }

  /**
   * 複数選択式の質問要求を Slack に投稿し、番号スタンプを自動付与して待機
   */
  public async requestQuestion(
    client: SlackClient,
    params: RequestQuestionParams,
  ): Promise<InteractionResult> {
    const {
      channelId,
      threadTs,
      allowedSlackUserId,
      osUser,
      question,
      options: optionLabels,
      timeoutMs = 300000,
    } = params;

    const options: InteractionOption[] = optionLabels.slice(0, 10).map((label, idx) => ({
      emoji: NUMBER_EMOJIS[idx].emoji,
      displayEmoji: NUMBER_EMOJIS[idx].displayEmoji,
      label,
      value: String(idx + 1),
    }));

    const optionsText = options.map((opt) => `  ${opt.displayEmoji} : ${opt.label}`).join("\n");

    const messageText = [
      `❓ *【質問・方針確認】* <@${allowedSlackUserId}>`,
      `*${question}*`,
      `\n${optionsText}\n`,
      `👇 該当する番号のスタンプを押して回答してください。`,
    ].join("\n");

    const postResult = await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: messageText,
    });

    const messageTs = postResult.ts;
    if (!messageTs) {
      throw new Error("Failed to post question message to Slack");
    }

    // 番号スタンプを順番に付与
    for (const opt of options) {
      try {
        await client.reactions.add({
          channel: channelId,
          timestamp: messageTs,
          name: opt.emoji,
        });
      } catch (err) {
        logger.warn("failed_to_add_question_reaction", { emoji: opt.emoji, error: String(err) });
      }
    }

    return new Promise<InteractionResult>((resolve, reject) => {
      const interactionId = `question_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const key = this.getKey(channelId, messageTs);

      const timerId = setTimeout(async () => {
        this.pendingInteractions.delete(key);
        try {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: `⏱️ *【タイムアウト】* 質問への回答がありませんでした。`,
          });
        } catch (err) {
          logger.error("failed_to_update_timeout_message", err);
        }

        resolve({
          interactionId,
          selectedOption: options[0],
          selectedByUserId: "SYSTEM_TIMEOUT",
          respondedAt: new Date().toISOString(),
          timedOut: true,
        });
      }, timeoutMs);

      this.pendingInteractions.set(key, {
        id: interactionId,
        type: "question",
        channelId,
        threadTs,
        messageTs,
        allowedSlackUserId,
        osUser,
        title: question,
        options,
        createdAt: Date.now(),
        timeoutMs,
        resolve,
        reject,
        timerId,
      });

      logger.info("question_requested", {
        interactionId,
        slackUserId: allowedSlackUserId,
        osUser,
        question,
      });
    });
  }

  /**
   * エージェント完了メッセージに含まれる選択肢を登録し、スタンプを自動付与
   */
  public async registerMessageChoices(
    client: SlackClient,
    params: RegisterMessageChoicesParams,
  ): Promise<void> {
    const { channelId, messageTs, options, threadTs, allowedSlackUserId, osUser, agentId, title, onSelect } =
      params;
    const key = this.getKey(channelId, messageTs);

    this.registeredChoices.set(key, {
      channelId,
      threadTs,
      messageTs,
      allowedSlackUserId,
      osUser,
      agentId,
      title,
      options,
      createdAt: Date.now(),
      onSelect,
    });

    logger.info("message_choices_registered", {
      key,
      channelId,
      messageTs,
      allowedSlackUserId,
      optionsCount: options.length,
    });

    // メッセージに選択肢スタンプを順番に付与
    for (const opt of options) {
      try {
        await client.reactions.add({
          channel: channelId,
          timestamp: messageTs,
          name: opt.emoji,
        });
      } catch (err) {
        logger.warn("failed_to_add_message_choice_reaction", { emoji: opt.emoji, error: String(err) });
      }
    }
  }

  /**
   * reaction_added イベント受信時の処理ハンドラ
   */
  public async handleReactionAdded(
    client: SlackClient,
    event: {
      user: string;
      reaction: string;
      item: { type: string; channel: string; ts: string };
    },
  ): Promise<boolean> {
    if (event.item.type !== "message") {
      return false;
    }

    const key = this.getKey(event.item.channel, event.item.ts);

    // 1. 同期待機中のインタラクション (PendingInteraction) をチェック
    const pending = this.pendingInteractions.get(key);
    if (pending) {
      if (event.user !== pending.allowedSlackUserId) {
        logger.debug("reaction_from_unauthorized_user_ignored", {
          expectedUser: pending.allowedSlackUserId,
          actualUser: event.user,
        });
        return false;
      }

      const matchedOption = pending.options.find(
        (opt) => opt.emoji === event.reaction || opt.displayEmoji === event.reaction,
      );

      if (!matchedOption) return false;

      clearTimeout(pending.timerId);
      this.pendingInteractions.delete(key);

      const respondedAt = new Date().toISOString();
      const result: InteractionResult = {
        interactionId: pending.id,
        selectedOption: matchedOption,
        selectedByUserId: event.user,
        respondedAt,
        timedOut: false,
      };

      logger.info("interaction_answered", {
        interactionId: pending.id,
        type: pending.type,
        selectedOption: matchedOption.value,
        userId: event.user,
        osUser: pending.osUser,
      });

      auditLogger.record({
        traceId: pending.id,
        action: "privilege_switch",
        status: matchedOption.isApproval === false ? "CANCELLED" : "SUCCESS",
        slackUserId: event.user,
        osUser: pending.osUser,
        channelId: pending.channelId,
        threadTs: pending.threadTs,
        commandText: `${pending.type}:${matchedOption.value}`,
        metadata: {
          title: pending.title,
          selectedLabel: matchedOption.label,
        },
      });

      try {
        if (pending.type === "approval") {
          const isApproved = matchedOption.value === "approve";
          const statusText = isApproved
            ? `✅ *【許可済み】* <@${event.user}> が実行を許可しました。\n> *${pending.title}*\n処理を続行します...`
            : `❌ *【拒否・中止】* <@${event.user}> が実行を拒否しました。\n> *${pending.title}*\nこの操作はスキップされました。`;

          await client.chat.update({
            channel: pending.channelId,
            ts: pending.messageTs,
            text: statusText,
          });
        } else {
          await client.chat.update({
            channel: pending.channelId,
            ts: pending.messageTs,
            text: `✔ *【回答選択】* <@${event.user}> が選択しました：\n*${matchedOption.displayEmoji} ${matchedOption.label}*\n処理を続行します...`,
          });
        }
      } catch (err) {
        logger.error("failed_to_update_answered_message", err);
      }

      pending.resolve(result);
      return true;
    }

    // 2. 完了メッセージに付与された非同期選択肢 (RegisteredMessageChoice) をチェック
    const registered = this.registeredChoices.get(key);
    if (registered) {
      if (event.user !== registered.allowedSlackUserId) {
        logger.debug("choice_reaction_from_unauthorized_user_ignored", {
          expectedUser: registered.allowedSlackUserId,
          actualUser: event.user,
        });
        return false;
      }

      const matchedOption = registered.options.find(
        (opt) => opt.emoji === event.reaction || opt.displayEmoji === event.reaction,
      );

      if (!matchedOption) return false;

      // 重複選択を防ぐため登録から削除
      this.registeredChoices.delete(key);

      logger.info("message_choice_selected", {
        key,
        userId: event.user,
        selectedOption: matchedOption.value,
        label: matchedOption.label,
      });

      if (registered.onSelect) {
        await registered.onSelect(matchedOption, event.user);
      }

      return true;
    }

    return false;
  }

  /**
   * Block Kit ボタン押下イベントのハンドラ
   */
  public async handleBlockAction(
    client: SlackClient,
    body: {
      user: { id: string };
      channel?: { id: string };
      container?: { message_ts?: string; channel_id?: string };
      message?: { ts: string };
    },
    action: { action_id: string; value: string },
  ): Promise<boolean> {
    const channelId = body.channel?.id || body.container?.channel_id;
    const messageTs = body.message?.ts || body.container?.message_ts;
    const userId = body.user.id;

    if (!channelId || !messageTs) return false;

    const key = this.getKey(channelId, messageTs);

    // 1. 同期待機中のインタラクション
    const pending = this.pendingInteractions.get(key);
    if (pending) {
      if (userId !== pending.allowedSlackUserId) return false;

      const matchedOption = pending.options.find((opt) => opt.value === action.value);
      if (!matchedOption) return false;

      clearTimeout(pending.timerId);
      this.pendingInteractions.delete(key);

      const respondedAt = new Date().toISOString();
      const result: InteractionResult = {
        interactionId: pending.id,
        selectedOption: matchedOption,
        selectedByUserId: userId,
        respondedAt,
        timedOut: false,
      };

      try {
        await client.chat.update({
          channel: pending.channelId,
          ts: pending.messageTs,
          text: `✔ *【ボタン選択】* <@${userId}> が選択しました：\n*${matchedOption.displayEmoji} ${matchedOption.label}*\n処理を続行します...`,
        });
      } catch (err) {
        logger.error("failed_to_update_action_answered_message", err);
      }

      pending.resolve(result);
      return true;
    }

    // 2. 完了メッセージの選択肢
    const registered = this.registeredChoices.get(key);
    if (registered) {
      if (userId !== registered.allowedSlackUserId) return false;

      const matchedOption = registered.options.find((opt) => opt.value === action.value);
      if (!matchedOption) return false;

      this.registeredChoices.delete(key);

      if (registered.onSelect) {
        await registered.onSelect(matchedOption, userId);
      }

      return true;
    }

    return false;
  }
}

export const interactionManager = new InteractionManager();
