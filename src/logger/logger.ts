import fs from "node:fs";
import path from "node:path";
import { LogLevel, LOG_LEVEL_PRIORITY, LogEntry, LoggerOptions, ErrorInfo } from "./types.js";

export class Logger {
  private readonly minLevel: LogLevel;
  private readonly enableStdout: boolean;
  private readonly enableFile: boolean;
  private readonly logDir: string;
  private readonly logFilePath: string;
  private writeStream: fs.WriteStream | null = null;
  private readonly defaultContext: Partial<LogEntry>;

  constructor(options: LoggerOptions = {}, context: Partial<LogEntry> = {}) {
    this.minLevel = options.minLevel ?? (process.env.LOG_LEVEL as LogLevel) ?? "info";
    this.enableStdout = options.enableStdout ?? true;
    this.enableFile = options.enableFile ?? true;
    this.logDir = options.logDir ?? process.env.LOG_DIR ?? "./logs";
    this.logFilePath = path.join(this.logDir, "app.jsonl");
    this.defaultContext = context;

    if (this.enableFile) {
      this.initFileStream();
    }
  }

  private initFileStream(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      this.writeStream = fs.createWriteStream(this.logFilePath, {
        flags: "a",
        encoding: "utf-8",
      });
      this.writeStream.on("error", (err) => {
        console.error(`[Logger] Failed to write to log file: ${err.message}`);
      });
    } catch (err) {
      console.error("[Logger] Initialization error:", err);
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  public child(context: Partial<LogEntry>): Logger {
    const mergedContext = {
      ...this.defaultContext,
      ...context,
      slack: {
        ...this.defaultContext.slack,
        ...context.slack,
      },
      data: {
        ...this.defaultContext.data,
        ...context.data,
      },
    };

    const childLogger = new Logger(
      {
        minLevel: this.minLevel,
        enableStdout: this.enableStdout,
        enableFile: this.enableFile,
        logDir: this.logDir,
      },
      mergedContext,
    );

    // Share active writeStream
    if (this.writeStream) {
      childLogger.writeStream = this.writeStream;
    }

    return childLogger;
  }

  public log(entry: Omit<LogEntry, "timestamp">): void {
    if (!this.shouldLog(entry.level)) {
      return;
    }

    const fullEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      ...this.defaultContext,
      ...entry,
      slack:
        entry.slack || this.defaultContext.slack
          ? {
              ...this.defaultContext.slack,
              ...entry.slack,
            }
          : undefined,
      data:
        entry.data || this.defaultContext.data
          ? {
              ...this.defaultContext.data,
              ...entry.data,
            }
          : undefined,
    };

    const jsonLine = JSON.stringify(fullEntry) + "\n";

    if (this.enableStdout) {
      if (entry.level === "error") {
        process.stderr.write(jsonLine);
      } else {
        process.stdout.write(jsonLine);
      }
    }

    if (this.enableFile && this.writeStream) {
      this.writeStream.write(jsonLine);
    }
  }

  public debug(event: string, data?: Record<string, unknown>, message?: string): void {
    this.log({ level: "debug", event, data, message });
  }

  public info(event: string, data?: Record<string, unknown>, message?: string): void {
    this.log({ level: "info", event, data, message });
  }

  public warn(event: string, data?: Record<string, unknown>, message?: string): void {
    this.log({ level: "warn", event, data, message });
  }

  public error(
    event: string,
    err?: Error | unknown,
    data?: Record<string, unknown>,
    message?: string,
  ): void {
    let errorInfo: ErrorInfo | undefined;
    if (err instanceof Error) {
      errorInfo = {
        name: err.name,
        message: err.message,
        stack: err.stack,
        code: (err as unknown as { code?: string | number }).code,
      };
    } else if (err !== undefined) {
      errorInfo = {
        name: "UnknownError",
        message: String(err),
      };
    }

    this.log({
      level: "error",
      event,
      message: message || (err instanceof Error ? err.message : undefined),
      error: errorInfo,
      data,
    });
  }

  public async close(): Promise<void> {
    if (this.writeStream) {
      return new Promise((resolve) => {
        this.writeStream?.end(() => resolve());
      });
    }
  }
}

export const logger = new Logger();
