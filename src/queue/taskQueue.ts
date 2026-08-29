import { logger } from "../logger/index.js";

export interface TaskQueueOptions {
  maxConcurrent?: number;
}

interface QueuedTask<T> {
  id: string;
  threadKey: string;
  task: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  enqueuedAt: number;
}

export class TaskQueue {
  private readonly maxConcurrent: number;
  private runningCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private queue: Array<QueuedTask<any>> = [];
  private busyThreads = new Set<string>();

  constructor(options: TaskQueueOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 2;
  }

  /**
   * タスクをキューに追加し、同時実行上限およびスレッド排他制御のもとで実行
   */
  public async enqueue<T>(threadKey: string, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const queuedTask: QueuedTask<T> = {
        id: taskId,
        threadKey,
        task,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      };

      this.queue.push(queuedTask);
      logger.info("task_enqueued", {
        taskId,
        threadKey,
        queueLength: this.queue.length,
        runningCount: this.runningCount,
      });

      this.processNext();
    });
  }

  private processNext(): void {
    if (this.runningCount >= this.maxConcurrent) {
      return;
    }

    // 実行可能なタスク（スレッドがビジーでないもの）を先頭から探す
    const index = this.queue.findIndex((item) => !this.busyThreads.has(item.threadKey));
    if (index === -1) {
      return;
    }

    const [item] = this.queue.splice(index, 1);
    this.runningCount++;
    this.busyThreads.add(item.threadKey);

    const waitDurationMs = Date.now() - item.enqueuedAt;
    logger.info("task_started", {
      taskId: item.id,
      threadKey: item.threadKey,
      waitDurationMs,
      runningCount: this.runningCount,
    });

    (async () => {
      try {
        const result = await item.task();
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      } finally {
        this.runningCount--;
        this.busyThreads.delete(item.threadKey);
        logger.info("task_finished", {
          taskId: item.id,
          threadKey: item.threadKey,
          runningCount: this.runningCount,
        });
        // 次のタスクを処理
        this.processNext();
      }
    })();
  }

  public getRunningCount(): number {
    return this.runningCount;
  }

  public getQueuedCount(): number {
    return this.queue.length;
  }

  public isThreadBusy(threadKey: string): boolean {
    return this.busyThreads.has(threadKey);
  }
}

export const taskQueue = new TaskQueue();
