import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SessionStore } from "../../src/session/sessionStore.js";


describe("SessionStore", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-store-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should create, update, and persist sessions", () => {
    const store = new SessionStore({ dataDir: tmpDir, persistToFile: true });

    const session = store.createSession({
      channelId: "C123",
      threadTs: "1787990000.1234",
      slackUserId: "U_ALICE",
      osUser: "alice",
      repoName: "backend-service",
      branchName: "feat/login",
      worktreePath: "/tmp/worktrees/backend-service_1787990000",
    });

    expect(session.threadKey).toBe("C123:1787990000.1234");
    expect(session.status).toBe("idle");

    store.updateSession(session.threadKey, {
      conversationId: "conv_xyz123",
      status: "running",
    });

    const updated = store.getSession(session.threadKey);
    expect(updated?.conversationId).toBe("conv_xyz123");
    expect(updated?.status).toBe("running");

    // Reopen store from same file
    const reopenedStore = new SessionStore({ dataDir: tmpDir, persistToFile: true });
    const loaded = reopenedStore.getSession(session.threadKey);
    expect(loaded?.conversationId).toBe("conv_xyz123");
    // Running status should reset to idle on startup
    expect(loaded?.status).toBe("idle");
  });

  it("should reset conversation id and delete session", () => {
    const store = new SessionStore({ dataDir: tmpDir, persistToFile: true });

    const session = store.createSession({
      channelId: "C123",
      threadTs: "1787990000.1234",
      slackUserId: "U_ALICE",
      osUser: "alice",
      repoName: "backend-service",
      branchName: "feat/login",
      worktreePath: "/tmp/worktrees/backend-service_1787990000",
      conversationId: "conv_abc",
    });

    store.resetConversationId(session.threadKey);
    expect(store.getSession(session.threadKey)?.conversationId).toBeUndefined();

    store.deleteSession(session.threadKey);
    expect(store.getSession(session.threadKey)).toBeUndefined();
  });
});
