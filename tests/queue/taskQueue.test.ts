import { describe, it, expect } from "vitest";
import { TaskQueue } from "../../src/queue/taskQueue.js";


describe("TaskQueue", () => {
  it("should limit maximum concurrent tasks to maxConcurrent", async () => {
    const queue = new TaskQueue({ maxConcurrent: 2 });
    let maxRunningObserved = 0;
    let currentlyRunning = 0;

    const createTask = (durationMs: number) => async () => {
      currentlyRunning++;
      maxRunningObserved = Math.max(maxRunningObserved, currentlyRunning);
      await new Promise((r) => setTimeout(r, durationMs));
      currentlyRunning--;
      return true;
    };

    const p1 = queue.enqueue("t1", createTask(40));
    const p2 = queue.enqueue("t2", createTask(40));
    const p3 = queue.enqueue("t3", createTask(40));
    const p4 = queue.enqueue("t4", createTask(40));

    await Promise.all([p1, p2, p3, p4]);

    expect(maxRunningObserved).toBe(2);
  });

  it("should serialize tasks on the same thread even if slots are open", async () => {
    const queue = new TaskQueue({ maxConcurrent: 5 });
    const order: string[] = [];

    const p1 = queue.enqueue("thread-A", async () => {
      order.push("A1_start");
      await new Promise((r) => setTimeout(r, 30));
      order.push("A1_end");
    });

    const p2 = queue.enqueue("thread-A", async () => {
      order.push("A2_start");
      await new Promise((r) => setTimeout(r, 10));
      order.push("A2_end");
    });

    await Promise.all([p1, p2]);

    expect(order).toEqual(["A1_start", "A1_end", "A2_start", "A2_end"]);
  });
});
