import type { App } from "@slack/bolt";
import { UserMapper } from "../config/userMap.js";
import { AppConfig } from "../config/schema.js";
import { commandRouter } from "./commandRouter.js";
import { sessionStore } from "../session/sessionStore.js";
import { AgentExecutor } from "./agentExecutor.js";
import { SlackFormatter } from "../formatter/slackFormatter.js";


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

    // メンション付きメッセージは app_mention ハンドラ側で処理されるため、message イベントでは二重実行を防ぐためスキップ
    if (text.includes("<@") || text.trim().startsWith("@agy")) {
      return;
    }

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

    await AgentExecutor.executeAgentTurn({
      client,
      session,
      prompt,
      slackUserId,
      config,
    });
  });
}

