export class RepoMutex {
  private activeLocks = new Set<string>();
  private waitingQueue = new Map<string, Array<() => void>>();

  /**
   * 指定したリポジトリの排他ロックを取得
   */
  public async acquire(repoName: string): Promise<() => void> {
    if (!this.activeLocks.has(repoName)) {
      this.activeLocks.add(repoName);
      return () => this.release(repoName);
    }

    return new Promise<() => void>((resolve) => {
      const queue = this.waitingQueue.get(repoName) || [];
      queue.push(() => {
        resolve(() => this.release(repoName));
      });
      this.waitingQueue.set(repoName, queue);
    });
  }

  private release(repoName: string): void {
    const queue = this.waitingQueue.get(repoName);
    if (queue && queue.length > 0) {
      const next = queue.shift();
      if (next) {
        next();
      }
    } else {
      this.activeLocks.delete(repoName);
      this.waitingQueue.delete(repoName);
    }
  }

  public isLocked(repoName: string): boolean {
    return this.activeLocks.has(repoName);
  }
}

export const repoMutex = new RepoMutex();
