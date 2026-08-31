import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DurableJobQueue } from "../../src/queue/durableJobQueue.js";
import { SqliteStore } from "../../src/storage/sqliteStore.js";


describe("DurableJobQueue", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "durable-job-queue-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists a queued job and executes jobs in a thread serially", async () => {
    const store = new SqliteStore({ dataDir: tmpDir });
    const queue = new DurableJobQueue(store, { maxConcurrent: 2, pollIntervalMs: 5 });
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    queue.register("agent.run", async (job) => {
      const payload = job.payload as { value: string };
      order.push(`${payload.value}:start`);
      if (payload.value === "first") await firstFinished;
      order.push(`${payload.value}:end`);
    });
    queue.start();
    const first = queue.enqueue({
      threadKey: "thread-a",
      type: "agent.run",
      payload: { value: "first" },
    });
    const second = queue.enqueue({
      threadKey: "thread-a",
      type: "agent.run",
      payload: { value: "second" },
    });

    await waitFor(() => order.includes("first:start"));
    expect(store.getJob(second.id)?.status).toBe("queued");
    releaseFirst?.();
    await waitFor(() => store.getJob(first.id)?.status === "succeeded");
    await waitFor(() => store.getJob(second.id)?.status === "succeeded");
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
    queue.stop();
    store.close();
  });

  it("marks a job that was active at restart as interrupted instead of replaying it", () => {
    const firstStore = new SqliteStore({ dataDir: tmpDir });
    const job = firstStore.createJob({
      id: "job_active",
      threadKey: "thread-a",
      type: "agent.run",
      payload: { prompt: "do work" },
    });
    firstStore.claimNextJob(60_000);
    expect(firstStore.getJob(job.id)?.status).toBe("running");
    firstStore.close();

    const restartedStore = new SqliteStore({ dataDir: tmpDir });
    const queue = new DurableJobQueue(restartedStore);
    queue.start();
    expect(restartedStore.getJob(job.id)?.status).toBe("interrupted");
    queue.stop();
    restartedStore.close();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
