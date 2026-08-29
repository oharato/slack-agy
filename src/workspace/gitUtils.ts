import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../logger/index.js";

const execFileAsync = promisify(execFile);

export interface ExecGitOptions {
  cwd?: string;
  osUser?: string;
  useSudo?: boolean;
  timeoutMs?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * OS ユーザー権限（sudo -u <osUser>）または直接コマンドを実行するヘルパー
 */
export async function execCommandAsUser(
  command: string,
  args: string[],
  options: ExecGitOptions = {},
): Promise<ExecResult> {
  const {
    cwd,
    osUser,
    useSudo = Boolean(osUser && process.env.NODE_ENV !== "test" && process.getuid?.() === 0),
    timeoutMs = 60000,
  } = options;

  let cmd = command;
  let cmdArgs = args;

  if (useSudo && osUser) {
    cmd = "sudo";
    cmdArgs = ["-u", osUser, "-H", "--", command, ...args];
  }

  try {
    const result = await execFileAsync(cmd, cmdArgs, {
      cwd,
      timeout: timeoutMs,
      env: osUser
        ? {
            ...process.env,
            HOME: `/home/${osUser}`,
            USER: osUser,
            LOGNAME: osUser,
            XDG_CONFIG_HOME: `/home/${osUser}/.config`,
          }
        : process.env,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    return {
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message: string; code?: number };
    logger.warn("command_execution_failed", {
      command: `${cmd} ${cmdArgs.join(" ")}`,
      error: error.message,
      stderr: error.stderr,
    });
    throw err;
  }
}

export class GitUtils {
  /**
   * 現在のブランチ名を取得
   */
  public static async getCurrentBranch(cwd: string, options: ExecGitOptions = {}): Promise<string> {
    const res = await execCommandAsUser("git", ["-C", cwd, "branch", "--show-current"], options);
    return res.stdout;
  }

  /**
   * 作業ディレクトリの変更ステータス概要を取得 (git status --short)
   */
  public static async getStatusShort(cwd: string, options: ExecGitOptions = {}): Promise<string> {
    const res = await execCommandAsUser("git", ["-C", cwd, "status", "--short"], options);
    return res.stdout;
  }

  /**
   * 変更点の diff stat (統計情報) を取得
   */
  public static async getDiffStat(cwd: string, options: ExecGitOptions = {}): Promise<string> {
    const res = await execCommandAsUser("git", ["-C", cwd, "diff", "--stat"], options);
    return res.stdout;
  }

  /**
   * 完全な diff を取得
   */
  public static async getDiff(cwd: string, options: ExecGitOptions = {}): Promise<string> {
    const res = await execCommandAsUser("git", ["-C", cwd, "diff", "HEAD"], options);
    return res.stdout;
  }

  /**
   * リモートへブランチを push (git push -u origin <branch>)
   */
  public static async pushBranch(
    cwd: string,
    branchName: string,
    options: ExecGitOptions = {},
  ): Promise<ExecResult> {
    return execCommandAsUser("git", ["-C", cwd, "push", "-u", "origin", branchName], options);
  }

  /**
   * GitHub Pull Request の作成 (gh pr create)
   */
  public static async createPullRequest(
    cwd: string,
    params: {
      title: string;
      body?: string;
      base?: string;
    },
    options: ExecGitOptions = {},
  ): Promise<{ prUrl: string; stdout: string }> {
    const args = ["pr", "create", "--title", params.title];
    if (params.body) {
      args.push("--body", params.body);
    } else {
      args.push("--body", "Automated PR created by Slack-AGY Bridge");
    }
    if (params.base) {
      args.push("--base", params.base);
    }

    const res = await execCommandAsUser("gh", args, { ...options, cwd });
    // stdout contains PR URL (e.g. https://github.com/org/repo/pull/123)
    return {
      prUrl: res.stdout,
      stdout: res.stdout,
    };
  }

  /**
   * 最新コミットのハッシュとログを取得 (git log -1 --oneline)
   */
  public static async getLatestCommit(cwd: string, options: ExecGitOptions = {}): Promise<string> {
    const res = await execCommandAsUser("git", ["-C", cwd, "log", "-1", "--oneline"], options);
    return res.stdout;
  }
}
