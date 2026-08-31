import { EventEmitter } from "node:events";

/** Parses Codex `exec --json` JSONL without leaking its unstable wire format. */
export class CodexStreamParser extends EventEmitter {
  private buffer = "";

  public push(chunk: string | Buffer): void {
    this.buffer += chunk.toString();
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) this.parseLine(line);
  }

  public end(): void {
    if (this.buffer.trim()) this.parseLine(this.buffer);
    this.buffer = "";
  }

  private parseLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      this.emit("event", JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      this.emit("raw", trimmed);
    }
  }
}
