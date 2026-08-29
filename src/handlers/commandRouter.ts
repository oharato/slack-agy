import { App } from "@slack/bolt";
import { sessionStore } from "../session/sessionStore.js";
import { worktreeManager } from "../workspace/worktreeManager.js";
import { sanitizeSlackLink } from "../workspace/repoUtils.js";
import { GitUtils } from "../workspace/gitUtils.js";
import { privilegeRunner } from "../runner/privilegeRunner.js";
import { SlackFormatter } from "../formatter/slackFormatter.js";
import { logger } from "../logger/index.js";
import { auditLogger } from "../logger/auditLogger.js";

export type SlackClient = App["client"];

export interface CommandContext {
  client: SlackClient;
  channelId: string;
  threadTs: string;
  slackUserId: string;
  osUser: string;
  text: string;
}

export class CommandRouter {
  /**
   * メッセージがコマンドであるかを判定し、コマンドであれば実行
   * @returns true: コマンドとして処理完了, false: 通常プロンプトとして処理を継続
   */
  public async handleIfCommand(ctx: CommandContext): Promise<boolean> {
    const { client, channelId, threadTs, slackUserId, osUser, text } = ctx;
    const trimmed = text.trim();

    // コマンド判定: "!" または "@agy !" または "@agy <cmd>"
    const cmdMatch = trimmed.match(/^(?:<@[A-Z0-9]+>\s*)?!([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
    if (!cmdMatch) {
      return false;
    }

    const command = cmdMatch[1].toLowerCase();
    const args = (cmdMatch[2] || "").trim();
    const threadKey =
      sessionStore.getSessionByThread(channelId, threadTs)?.threadKey || `${channelId}:${threadTs}`;

    logger.info("command_received", { command, args, slackUserId, osUser, channelId, threadTs });

    switch (command) {
      case "help": {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: SlackFormatter.formatHelp(),
        });
        return true;
      }

      case "repo": {
        if (!args) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: SlackFormatter.formatError(
              "リポジトリ名を指定してください (例: `!repo my-backend-repo` または `!repo https://github.com/org/repo.git`)",
            ),
          });
          return true;
        }

        try {
          const sanitizedTarget = sanitizeSlackLink(args);
          const { repoName } = await worktreeManager.ensureRepo(sanitizedTarget, osUser);
          const safeKey = threadTs.replace(/[^a-zA-Z0-9_-]/g, "_");
          const branchName = `feat/${osUser}-thread-${safeKey}`;

          const { worktreePath } = await worktreeManager.getOrCreateWorktree(
            repoName,
            threadKey,
            branchName,
            osUser,
          );

          sessionStore.createSession({
            channelId,
            threadTs,
            slackUserId,
            osUser,
            repoName,
            branchName,
            worktreePath,
          });

          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: [
              `📂 *【リポジトリ設定完了】*`,
              `• *リポジトリ*: \`${repoName}\``,
              `• *ブランチ*: \`${branchName}\``,
              `• *作業ツリー*: \`${worktreePath}\``,
              `• *OS ユーザー*: \`${osUser}\``,
              `このスレッドで指示を入力すると、上記 Worktree 内で AGY が自律実行します。`,
            ].join("\n"),
          });
        } catch (err) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: SlackFormatter.formatError("リポジトリの準備に失敗しました", String(err)),
          });
        }
        return true;
      }

      case "pr": {
        const session = sessionStore.getSessionByThread(channelId, threadTs);
        if (!session) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: SlackFormatter.formatError(
              "アクティブなセッションがありません。先に `!repo` でリポジトリを指定してください。",
            ),
          });
          return true;
        }

        if (!session.repoName || !session.branchName) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: "⚠️ 現在はリポジトリ未指定の自由相談セッションのため、Pull Request を作成できません。`!repo <リポジトリ名>` でリポジトリを指定してから実行してください。",
          });
          return true;
        }

        try {
          const prTitle = args || `Update from Slack task (${session.branchName})`;

          // Push branch
          await GitUtils.pushBranch(session.worktreePath, session.branchName, { osUser });

          // Create PR
          const { prUrl } = await GitUtils.createPullRequest(
            session.worktreePath,
            { title: prTitle },
            { osUser },
          );

          auditLogger.record({
            traceId: `pr_${Date.now()}`,
            action: "pr_creation",
            status: "SUCCESS",
            slackUserId,
            osUser,
            channelId,
            threadTs,
            repoName: session.repoName,
            branchName: session.branchName,
            commandText: prTitle,
            metadata: { prUrl },
          });

          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: [
              `🎉 *【Pull Request 作成完了】*`,
              `• *タイトル*: ${prTitle}`,
              `• *ブランチ*: \`${session.branchName}\``,
              `• *PR URL*: ${prUrl}`,
            ].join("\n"),
          });
        } catch (err) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: SlackFormatter.formatError("Pull Request の作成に失敗しました", String(err)),
          });
        }
        return true;
      }

      case "status":
      case "info": {
        const session = sessionStore.getSessionByThread(channelId, threadTs);
        let diffStat = "";
        if (session && session.repoName) {
          try {
            diffStat = await GitUtils.getStatusShort(session.worktreePath, { osUser });
          } catch {
            // ignore
          }
        }
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: SlackFormatter.formatStatus(session, diffStat),
        });
        return true;
      }

      case "clean":
      case "done": {
        const session = sessionStore.getSessionByThread(channelId, threadTs);
        if (!session) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: "ℹ️ 削除対象の Worktree またはセッションはありません。",
          });
          return true;
        }

        try {
          if (session.repoName) {
            await worktreeManager.removeWorktree(session.worktreePath, session.repoName, osUser);
          }
          sessionStore.deleteSession(session.threadKey);

          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: session.repoName
              ? `🧹 *【Worktree クリーンアップ完了】*\n作業ディレクトリ \`${session.worktreePath}\` を削除し、セッションを終了しました。`
              : `🧹 *【セッション終了】*\n自由相談セッションを終了しました。`,
          });
        } catch (err) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: SlackFormatter.formatError("Worktree の削除に失敗しました", String(err)),
          });
        }
        return true;
      }

      case "reset": {
        const session = sessionStore.getSessionByThread(channelId, threadTs);
        if (session) {
          sessionStore.resetConversationId(session.threadKey);
        }
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: "🔄 *【対話履歴リセット】*\nこのスレッドの AGY 対話履歴（conversation_id）をクリアしました。次の指示は新規セッションとして開始されます。",
        });
        return true;
      }

      case "cancel": {
        const cancelled = privilegeRunner.cancel(threadKey);
        if (cancelled) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: "🛑 *【タスク停止】*\n実行中の AGY プロセスに停止シグナルを送信しました。",
          });
        } else {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: "ℹ️ 現在このスレッドで実行中のプロセスはありません。",
          });
        }
        return true;
      }

      default:
        return false;
    }
  }
}

export const commandRouter = new CommandRouter();
