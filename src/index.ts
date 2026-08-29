import bolt from "@slack/bolt";
const { App, LogLevel: BoltLogLevel } = bolt;
import { getConfig } from "./config/env.js";
import { UserMapper } from "./config/userMap.js";
import { registerMentionHandler } from "./handlers/mentionHandler.js";
import { registerMessageHandler } from "./handlers/messageHandler.js";
import { registerReactionHandler } from "./handlers/reactionHandler.js";
import { WorktreeCleaner } from "./workspace/worktreeCleaner.js";
import { worktreeManager } from "./workspace/worktreeManager.js";
import { logger } from "./logger/index.js";
import { auditLogger } from "./logger/auditLogger.js";

async function main(): Promise<void> {
  const config = getConfig();
  const userMapper = new UserMapper(config.SLACK_USER_OS_MAPPINGS);

  logger.info("starting_slack_agy_bridge", {
    workspaceRoot: config.SHARED_WORKSPACE_ROOT,
    defaultRepo: config.DEFAULT_REPO || "(none)",
    maxConcurrentTasks: config.MAX_CONCURRENT_TASKS,
    registeredUsersCount: Object.keys(config.SLACK_USER_OS_MAPPINGS).length,
  });

  const app = new App({
    token: config.SLACK_BOT_TOKEN,
    appToken: config.SLACK_APP_TOKEN,
    signingSecret: config.SLACK_SIGNING_SECRET,
    socketMode: true,
    logLevel: config.LOG_LEVEL === "debug" ? BoltLogLevel.DEBUG : BoltLogLevel.INFO,
  });

  // ハンドラの登録
  registerMentionHandler(app, { userMapper, config });
  registerMessageHandler(app, { userMapper, config });
  registerReactionHandler(app);

  // 定期的な放置 Worktree ガベージコレクション (24時間ごと)
  const gcIntervalMs = 24 * 60 * 60 * 1000;
  const gcTimer = setInterval(async () => {
    try {
      logger.info("running_scheduled_worktree_cleanup");
      const res = await WorktreeCleaner.cleanupStaleWorktrees({
        worktreesDir: worktreeManager.getWorktreesDir(),
        reposDir: worktreeManager.getReposDir(),
        maxAgeMs: config.WORKTREE_TTL_HOURS * 60 * 60 * 1000,
      });
      logger.info("scheduled_worktree_cleanup_finished", {
        checked: res.checkedCount,
        removed: res.removedCount,
      });
    } catch (err) {
      logger.error("scheduled_worktree_cleanup_failed", err);
    }
  }, gcIntervalMs);

  // 初回起動時にも軽い GC チェックを実行
  setTimeout(async () => {
    try {
      await WorktreeCleaner.cleanupStaleWorktrees({
        worktreesDir: worktreeManager.getWorktreesDir(),
        reposDir: worktreeManager.getReposDir(),
        maxAgeMs: config.WORKTREE_TTL_HOURS * 60 * 60 * 1000,
      });
    } catch {
      // ignore startup gc error
    }
  }, 5000);

  // グレースフルシャットダウン処理
  const shutdown = async (signal: string) => {
    logger.info("shutting_down_bridge", { signal });
    clearInterval(gcTimer);

    try {
      await app.stop();
    } catch {
      // ignore
    }

    await logger.close();
    await auditLogger.close();

    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Socket Mode 接続開始
  await app.start();
  logger.info("slack_agy_bridge_running", {
    mode: "Socket Mode",
    status: "CONNECTED",
  });
}

// 実行
main().catch(async (err) => {
  logger.error("fatal_error_during_startup", err);
  await logger.close();
  await auditLogger.close();
  process.exit(1);
});
