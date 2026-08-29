import type { App } from "@slack/bolt";
import { interactionManager } from "../interaction/index.js";
import { logger } from "../logger/index.js";

export function registerReactionHandler(app: App): void {
  app.event("reaction_added", async ({ event, client }) => {
    try {
      if (event.item.type !== "message") {
        return;
      }

      await interactionManager.handleReactionAdded(client, {
        user: event.user,
        reaction: event.reaction,
        item: {
          type: event.item.type,
          channel: event.item.channel,
          ts: event.item.ts,
        },
      });
    } catch (err) {
      logger.error("error_in_reaction_handler", err, {
        user: event.user,
        reaction: event.reaction,
      });
    }
  });
}
