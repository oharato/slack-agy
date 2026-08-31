import type { App } from "@slack/bolt";
import { interactionManager } from "../interaction/index.js";
import { logger } from "../logger/index.js";

export function registerActionHandler(app: App): void {
  // interaction_opt_* ボタンのアクションハンドラ
  app.action(/^interaction_opt_\d+$/, async ({ ack, body, action, client }) => {
    await ack();

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawAction = action as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawBody = body as any;

      if (!rawAction?.value) {
        return;
      }

      await interactionManager.handleBlockAction(
        client,
        {
          user: { id: rawBody.user?.id },
          channel: { id: rawBody.channel?.id },
          container: rawBody.container,
          message: { ts: rawBody.message?.ts },
        },
        {
          action_id: rawAction.action_id,
          value: rawAction.value,
        },
      );
    } catch (err) {
      logger.error("error_in_action_handler", err, {
        actionId: (action as { action_id?: string })?.action_id,
      });
    }
  });
}
