import fs from "node:fs";
import path from "node:path";
import { repoMutex } from "./repoMutex.js";
import { execCommandAsUser } from "./gitUtils.js";
import { parseRepoTarget } from "./repoUtils.js";
import { logger } from "../logger/index.js";
import { auditLogger } from "../logger/auditLogger.js";

export interface WorktreeManagerOptions {
  sharedRoot?: string;
  reposDir?: string;
  worktreesDir?: string;
  useSudo?: boolean;
}

export class WorktreeManager {
  private readonly reposDir: string;
  private readonly worktreesDir: string;
  private readonly useSudo: boolean;

  constructor(options: WorktreeManagerOptions = {}) {
    const root = options.sharedRoot ?? process.env.SHARED_WORKSPACE_ROOT ?? "/var/workspace/shared";
    this.reposDir = options.reposDir ?? path.join(root, "repos");
    this.worktreesDir = options.worktreesDir ?? path.join(root, "worktrees");
    this.useSudo = options.useSudo ?? (process.env.NODE_ENV !== "test" && process.getuid?.() === 0);

    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    try {
      if (!fs.existsSync(this.reposDir)) {
        fs.mkdirSync(this.reposDir, { recursive: true });
      }
      if (!fs.existsSync(this.worktreesDir)) {
        fs.mkdirSync(this.worktreesDir, { recursive: true });
      }
    } catch (err) {
      logger.warn("failed_to_create_shared_workspace_dirs", { error: String(err) });
    }
  }

  public getReposDir(): string {
    return this.reposDir;
  }

  public getWorktreesDir(): string {
    return this.worktreesDir;
  }

  public getBaseRepoPath(repoName: string): string {
    return path.join(this.reposDir, repoName);
  }

  public getWorktreePath(repoName: string, threadKey: string): string {
    const safeKey = threadKey.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.worktreesDir, `${repoName}_${safeKey}`);
  }

  /**
   * ベースリポジトリが存在するか確認し、なければ clone を実行
   */
  public async ensureRepo(
    repoNameOrUrl: string,
    osUser: string,
    defaultBranch = "main",
  ): Promise<{ repoName: string; baseRepoPath: string }> {
    const { repoName, cloneUrl } = parseRepoTarget(repoNameOrUrl);
    const baseRepoPath = this.getBaseRepoPath(repoName);

    if (fs.existsSync(baseRepoPath) && fs.existsSync(path.join(baseRepoPath, ".git"))) {
      return { repoName, baseRepoPath };
    }

    // Clone under RepoMutex
    const release = await repoMutex.acquire(repoName);
    try {
      if (!fs.existsSync(baseRepoPath) || !fs.existsSync(path.join(baseRepoPath, ".git"))) {
        logger.info("cloning_repository", { repoName, cloneUrl, repoNameOrUrl, osUser });

        let cloneSuccess = false;
        let lastError: unknown;

        // 1. URL または owner/repo の場合
        if (
          cloneUrl.startsWith("http://") ||
          cloneUrl.startsWith("https://") ||
          cloneUrl.startsWith("git@")
        ) {
          try {
            await execCommandAsUser("git", ["clone", cloneUrl, baseRepoPath], {
              osUser,
              useSudo: this.useSudo,
            });
            cloneSuccess = true;
          } catch (err) {
            lastError = err;
          }
        } else if (cloneUrl.includes("/")) {
          // owner/repo 形式 (例: oharato/docs-repo)
          try {
            await execCommandAsUser("gh", ["repo", "clone", cloneUrl, baseRepoPath], {
              osUser,
              useSudo: this.useSudo,
            });
            cloneSuccess = true;
          } catch {
            // gh clone が失敗した場合、https://github.com/owner/repo を試す
            try {
              await execCommandAsUser(
                "git",
                ["clone", `https://github.com/${cloneUrl}.git`, baseRepoPath],
                {
                  osUser,
                  useSudo: this.useSudo,
                },
              );
              cloneSuccess = true;
            } catch (gitErr) {
              lastError = gitErr;
            }
          }
        } else {
          // 単体名 (例: docs-repo) -> gh repo clone または git clone
          try {
            await execCommandAsUser("gh", ["repo", "clone", cloneUrl, baseRepoPath], {
              osUser,
              useSudo: this.useSudo,
            });
            cloneSuccess = true;
          } catch (err) {
            lastError = err;
          }
        }

        if (!cloneSuccess) {
          // テスト環境や明示的なローカルリポジトリ作成用フォールバック
          if (process.env.NODE_ENV === "test") {
            logger.warn("clone_failed_attempting_local_init", {
              repoName,
              error: String(lastError),
            });
            fs.mkdirSync(baseRepoPath, { recursive: true });
            await execCommandAsUser("git", ["init", "-b", defaultBranch, baseRepoPath], {
              osUser,
              useSudo: this.useSudo,
            });
          } else {
            const errorMsg = lastError instanceof Error ? lastError.message : String(lastError);
            throw new Error(
              `リポジトリ '${repoNameOrUrl}' のクローンに失敗しました。\nGitHub URL（例: https://github.com/owner/repo）を指定するか、リポジトリが存在すること・アクセス権限があることを確認してください。\n詳細: ${errorMsg}`,
            );
          }
        }

        auditLogger.record({
          traceId: `clone_${Date.now()}`,
          action: "worktree_creation",
          status: "SUCCESS",
          slackUserId: "SYSTEM",
          osUser,
          channelId: "SYSTEM",
          threadTs: "SYSTEM",
          repoName,
          worktreePath: baseRepoPath,
          metadata: { repoNameOrUrl },
        });
      }

      return { repoName, baseRepoPath };
    } finally {
      release();
    }
  }

  /**
   * スレッド用 Git Worktree を取得または新規作成
   */
  public async getOrCreateWorktree(
    repoName: string,
    threadKey: string,
    branchName: string,
    osUser: string,
  ): Promise<{ worktreePath: string; isNew: boolean }> {
    const baseRepoPath = this.getBaseRepoPath(repoName);
    const worktreePath = this.getWorktreePath(repoName, threadKey);

    if (!fs.existsSync(baseRepoPath)) {
      throw new Error(`Base repository does not exist at ${baseRepoPath}`);
    }

    if (fs.existsSync(worktreePath)) {
      return { worktreePath, isNew: false };
    }

    const release = await repoMutex.acquire(repoName);
    try {
      // Re-check existence inside lock
      if (fs.existsSync(worktreePath)) {
        return { worktreePath, isNew: false };
      }

      logger.info("creating_git_worktree", {
        repoName,
        branchName,
        worktreePath,
        osUser,
      });

      // git -C <baseRepoPath> worktree add -b <branchName> <worktreePath> HEAD
      await execCommandAsUser(
        "git",
        ["-C", baseRepoPath, "worktree", "add", "-b", branchName, worktreePath, "HEAD"],
        { osUser, useSudo: this.useSudo },
      );

      auditLogger.record({
        traceId: `wt_${Date.now()}`,
        action: "worktree_creation",
        status: "SUCCESS",
        slackUserId: "SYSTEM",
        osUser,
        channelId: threadKey.split(":")[0] || "",
        threadTs: threadKey.split(":")[1] || "",
        repoName,
        branchName,
        worktreePath,
      });

      return { worktreePath, isNew: true };
    } finally {
      release();
    }
  }

  /**
   * Worktree を削除
   */
  public async removeWorktree(
    worktreePath: string,
    repoName: string,
    osUser: string,
  ): Promise<boolean> {
    const baseRepoPath = this.getBaseRepoPath(repoName);

    logger.info("removing_git_worktree", { worktreePath, repoName, osUser });

    try {
      if (fs.existsSync(baseRepoPath)) {
        await execCommandAsUser(
          "git",
          ["-C", baseRepoPath, "worktree", "remove", "--force", worktreePath],
          { osUser, useSudo: this.useSudo },
        );
      } else if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }

      auditLogger.record({
        traceId: `wt_del_${Date.now()}`,
        action: "worktree_deletion",
        status: "SUCCESS",
        slackUserId: "SYSTEM",
        osUser,
        channelId: "SYSTEM",
        threadTs: "SYSTEM",
        repoName,
        worktreePath,
      });

      return true;
    } catch (err) {
      logger.warn("git_worktree_remove_failed_fallback_rm", { worktreePath, error: String(err) });
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
      return true;
    }
  }
}

export const worktreeManager = new WorktreeManager();
