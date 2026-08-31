import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Logger } from "../../src/logger/logger.js";
import { AuditLogger } from "../../src/logger/auditLogger.js";


describe("Structured JSONL Logger", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "slack-agy-logger-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("should write structured JSONL entries to file", async () => {
    const logger = new Logger({
      logDir: tmpDir,
      minLevel: "debug",
      enableStdout: false,
      enableFile: true,
    });

    logger.info("test_event", { key: "value" }, "Test message");
    logger.debug("debug_event", { debugData: 123 });
    logger.error("error_event", new Error("Something broke"), { extra: true });

    await logger.close();

    const logFile = path.join(tmpDir, "app.jsonl");
    expect(fs.existsSync(logFile)).toBe(true);

    const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n");
    expect(lines.length).toBe(3);

    const parsed1 = JSON.parse(lines[0]);
    expect(parsed1.event).toBe("test_event");
    expect(parsed1.level).toBe("info");
    expect(parsed1.message).toBe("Test message");
    expect(parsed1.data).toEqual({ key: "value" });
    expect(parsed1.timestamp).toBeDefined();

    const parsed3 = JSON.parse(lines[2]);
    expect(parsed3.event).toBe("error_event");
    expect(parsed3.level).toBe("error");
    expect(parsed3.error.message).toBe("Something broke");
  });

  it("should create child loggers with bound context", async () => {
    const parentLogger = new Logger({
      logDir: tmpDir,
      minLevel: "info",
      enableStdout: false,
      enableFile: true,
    });

    const childLogger = parentLogger.child({
      traceId: "trace_abc",
      osUser: "alice",
      slack: { userId: "U123", channelId: "C456", threadTs: "1700.00" },
    });

    childLogger.info("child_event", { status: "running" });

    await parentLogger.close();

    const logFile = path.join(tmpDir, "app.jsonl");
    const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.traceId).toBe("trace_abc");
    expect(parsed.osUser).toBe("alice");
    expect(parsed.slack).toEqual({ userId: "U123", channelId: "C456", threadTs: "1700.00" });
    expect(parsed.data).toEqual({ status: "running" });
  });

  it("should write audit log entries to audit.jsonl", async () => {
    const auditLogger = new AuditLogger({
      logDir: tmpDir,
      enableStdout: false,
      enableAuditFile: true,
    });

    auditLogger.record({
      traceId: "trace_audit_1",
      action: "agy_invocation",
      status: "SUCCESS",
      slackUserId: "U123",
      osUser: "alice",
      channelId: "C456",
      threadTs: "1700.00",
      commandText: "fix bug",
      durationMs: 1500,
    });

    await auditLogger.close();

    const auditFile = path.join(tmpDir, "audit.jsonl");
    expect(fs.existsSync(auditFile)).toBe(true);

    const lines = fs.readFileSync(auditFile, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.action).toBe("agy_invocation");
    expect(parsed.status).toBe("SUCCESS");
    expect(parsed.osUser).toBe("alice");
    expect(parsed.durationMs).toBe(1500);
  });
});
