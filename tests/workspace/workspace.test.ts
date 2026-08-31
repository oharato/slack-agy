import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RepoMutex } from "../../src/workspace/repoMutex.js";
import { WorktreeCleaner } from "../../src/workspace/worktreeCleaner.js";
import { WorktreeManager } from "../../src/workspace/worktreeManager.js";
import { GitUtils } from "../../src/workspace/gitUtils.js";


const execFileAsync = promisify(execFile);

describe("RepoMutex", () => {
  it("should serialize concurrent lock requests for the same repo", async () => {
    const mutex = new RepoMutex();
    const order: number[] = [];

    const p1 = (async () => {
      const release = await mutex.acquire("repoA");
      order.push(1);
      await new Promise((r) => setTimeout(r, 30));
      order.push(2);
      release();
    })();

    const p2 = (async () => {
      await new Promise((r) => setTimeout(r, 10));
      const release = await mutex.acquire("repoA");
      order.push(3);
      release();
    })();

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("should allow concurrent locks for different repos", async () => {
    const mutex = new RepoMutex();
    const order: string[] = [];

    const p1 = (async () => {
      const release = await mutex.acquire("repoA");
      order.push("A_start");
      await new Promise((r) => setTimeout(r, 20));
      order.push("A_end");
      release();
    })();

    const p2 = (async () => {
      const release = await mutex.acquire("repoB");
      order.push("B_start");
      await new Promise((r) => setTimeout(r, 10));
      order.push("B_end");
      release();
    })();

    await Promise.all([p1, p2]);
    expect(order).toContain("A_start");
    expect(order).toContain("B_start");
  });
});

describe("WorktreeCleaner", () => {
  let tmpWorktrees: string;
  let tmpRepos: string;

  beforeEach(() => {
    tmpWorktrees = fs.mkdtempSync(path.join(os.tmpdir(), "wt-clean-test-wt-"));
    tmpRepos = fs.mkdtempSync(path.join(os.tmpdir(), "wt-clean-test-repos-"));
  });

  afterEach(() => {
    fs.rmSync(tmpWorktrees, { recursive: true, force: true });
    fs.rmSync(tmpRepos, { recursive: true, force: true });
  });

  it("should detect and remove stale worktrees exceeding TTL", async () => {
    const staleDir = path.join(tmpWorktrees, "repoA_thread1");
    const freshDir = path.join(tmpWorktrees, "repoA_thread2");

    fs.mkdirSync(staleDir);
    fs.mkdirSync(freshDir);

    // タイムスタンプを過去に設定 (8日前の更新日時)
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(staleDir, eightDaysAgo, eightDaysAgo);

    const result = await WorktreeCleaner.cleanupStaleWorktrees({
      worktreesDir: tmpWorktrees,
      reposDir: tmpRepos,
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    });

    expect(result.checkedCount).toBe(2);
    expect(result.removedCount).toBe(1);
    expect(fs.existsSync(staleDir)).toBe(false);
    expect(fs.existsSync(freshDir)).toBe(true);
  });
});

describe("WorktreeManager & GitUtils", () => {
  let tmpShared: string;
  let reposDir: string;
  let worktreesDir: string;

  beforeEach(async () => {
    tmpShared = fs.mkdtempSync(path.join(os.tmpdir(), "wt-mgr-shared-"));
    reposDir = path.join(tmpShared, "repos");
    worktreesDir = path.join(tmpShared, "worktrees");

    fs.mkdirSync(reposDir, { recursive: true });
    fs.mkdirSync(worktreesDir, { recursive: true });

    // Initialize a dummy base repo
    const baseRepoPath = path.join(reposDir, "sample-repo");
    fs.mkdirSync(baseRepoPath, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main", baseRepoPath]);
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: baseRepoPath });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: baseRepoPath });
    fs.writeFileSync(path.join(baseRepoPath, "README.md"), "# Test\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: baseRepoPath });
    await execFileAsync("git", ["commit", "-m", "Initial commit"], { cwd: baseRepoPath });
  });

  afterEach(() => {
    fs.rmSync(tmpShared, { recursive: true, force: true });
  });

  it("should create and remove git worktrees", async () => {
    const manager = new WorktreeManager({
      reposDir,
      worktreesDir,
      useSudo: false,
    });

    const threadKey = "C123:1787990000.1234";
    const branchName = "feat/test-branch";
    const osUser = "alice";

    const { worktreePath, isNew } = await manager.getOrCreateWorktree(
      "sample-repo",
      threadKey,
      branchName,
      osUser,
    );

    expect(isNew).toBe(true);
    expect(fs.existsSync(worktreePath)).toBe(true);
    expect(fs.existsSync(path.join(worktreePath, "README.md"))).toBe(true);

    const currentBranch = await GitUtils.getCurrentBranch(worktreePath, { useSudo: false });
    expect(currentBranch).toBe("feat/test-branch");

    // Second call returns existing
    const secondCall = await manager.getOrCreateWorktree(
      "sample-repo",
      threadKey,
      branchName,
      osUser,
    );
    expect(secondCall.isNew).toBe(false);
    expect(secondCall.worktreePath).toBe(worktreePath);

    // Remove worktree
    await manager.removeWorktree(worktreePath, "sample-repo", osUser);
    expect(fs.existsSync(worktreePath)).toBe(false);
  });
});
