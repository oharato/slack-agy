import fs from "node:fs";
import path from "node:path";
import { AuditLogEntry, LoggerOptions } from "./types.js";

export class AuditLogger {
  private readonly logDir: string;
  private readonly auditFilePath: string;
  private readonly enableStdout: boolean;
  private writeStream: fs.WriteStream | null = null;

  constructor(options: LoggerOptions = {}) {
    this.logDir = options.logDir ?? process.env.LOG_DIR ?? "./logs";
    this.auditFilePath = path.join(this.logDir, "audit.jsonl");
    this.enableStdout = options.enableStdout ?? false;

    if (options.enableAuditFile ?? true) {
      this.initFileStream();
    }
  }

  private initFileStream(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      this.writeStream = fs.createWriteStream(this.auditFilePath, {
        flags: "a",
        encoding: "utf-8",
      });
      this.writeStream.on("error", (err) => {
        console.error(`[AuditLogger] Failed to write to audit log: ${err.message}`);
      });
    } catch (err) {
      console.error("[AuditLogger] Initialization error:", err);
    }
  }

  public record(entry: Omit<AuditLogEntry, "timestamp">): void {
    const fullEntry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    const jsonLine = JSON.stringify(fullEntry) + "\n";

    if (this.enableStdout) {
      process.stdout.write(`[AUDIT] ${jsonLine}`);
    }

    if (this.writeStream) {
      this.writeStream.write(jsonLine);
    }
  }

  public async close(): Promise<void> {
    if (this.writeStream) {
      return new Promise((resolve) => {
        this.writeStream?.end(() => resolve());
      });
    }
  }
}

export const auditLogger = new AuditLogger();
