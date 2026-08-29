import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../logger/index.js";

const execFileAsync = promisify(execFile);

export interface CleanupOptions {
  worktreesDir: string;
  reposDir: string;
  maxAgeMs?: number; // default: 7 days (7 * 24 * 60 * 60 * 1000)
  dryRun?: boolean;
}

export interface CleanupResult {
  checkedCount: number;
  removedCount: number;
  errors: Array<{ path: string; error: string }>;
}

export class WorktreeCleaner {
  /**
   * 最終更新日時が TTL を超過した放置 Worktree を自動削除 (Garbage Collection)
   */
  public static async cleanupStaleWorktrees(options: CleanupOptions): Promise<CleanupResult> {
    const {
      worktreesDir,
      reposDir,
      maxAgeMs = 7 * 24 * 60 * 60 * 1000, // 7 日間
      dryRun = false,
    } = options;

    const result: CleanupResult = {
      checkedCount: 0,
      removedCount: 0,
      errors: [],
    };

    if (!fs.existsSync(worktreesDir)) {
      return result;
    }

    const now = Date.now();
    const entries = fs.readdirSync(worktreesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      result.checkedCount++;
      const worktreePath = path.join(worktreesDir, entry.name);

      try {
        const stat = fs.statSync(worktreePath);
        const ageMs = now - stat.mtimeMs;

        if (ageMs > maxAgeMs) {
          logger.info("stale_worktree_detected", {
            worktreePath,
            ageDays: Math.round(ageMs / (24 * 60 * 60 * 1000)),
            dryRun,
          });

          if (!dryRun) {
            // git worktree remove を実行
            try {
              // ベースリポジトリ名を推測 (例: repoName_thread123 -> repoName)
              const baseName = entry.name.split("_")[0];
              const baseRepoPath = path.join(reposDir, baseName);

              if (fs.existsSync(baseRepoPath)) {
                await execFileAsync("git", [
                  "-C",
                  baseRepoPath,
                  "worktree",
                  "remove",
                  "--force",
                  worktreePath,
                ]);
              } else {
                // ベースリポジトリが見つからない場合はディレクトリごと削除
                fs.rmSync(worktreePath, { recursive: true, force: true });
              }
              result.removedCount++;
              logger.info("stale_worktree_cleaned", { worktreePath });
            } catch {
              // フォールバックで直接削除
              fs.rmSync(worktreePath, { recursive: true, force: true });
              result.removedCount++;
            }
          } else {
            result.removedCount++;
          }
        }
      } catch (err) {
        result.errors.push({
          path: worktreePath,
          error: err instanceof Error ? err.message : String(err),
        });
        logger.error("failed_to_cleanup_worktree", err, { worktreePath });
      }
    }

    return result;
  }
}
