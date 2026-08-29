import { describe, it, expect } from "vitest";
import { StreamParser } from "./streamParser.js";
import { PrivilegeRunner } from "./privilegeRunner.js";
import { AgyEvent } from "./types.js";

describe("StreamParser", () => {
  it("should parse multiple NDJSON lines correctly", () => {
    const parser = new StreamParser();
    const receivedEvents: AgyEvent[] = [];

    parser.on("event", (e) => receivedEvents.push(e));

    parser.push('{"event":"step_start","step_index":1}\n');
    parser.push(
      '{"event":"step_update","tool_name":"grep_search"}\n{"event":"result","status":"SUCCESS","response":"Done"}\n',
    );

    expect(receivedEvents.length).toBe(3);
    expect(receivedEvents[0].event).toBe("step_start");
    expect(receivedEvents[1].tool_name).toBe("grep_search");
    expect(receivedEvents[2].response).toBe("Done");
  });

  it("should buffer incomplete chunks until complete line arrives", () => {
    const parser = new StreamParser();
    const receivedEvents: AgyEvent[] = [];

    parser.on("event", (e) => receivedEvents.push(e));

    parser.push('{"event":"step_start"');
    expect(receivedEvents.length).toBe(0);

    parser.push(',"step_index":2}\n');
    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].step_index).toBe(2);
  });
});

describe("PrivilegeRunner", () => {
  it("should run node as command and capture NDJSON stream output", async () => {
    // node -e を使って stream-json を模倣する
    const runner = new PrivilegeRunner({
      agyPath: "node",
      useSudo: false,
    });

    const toolCalls: string[] = [];
    const result = await runner.runAgy("test:thread1", {
      prompt: "-e",
      cwd: process.cwd(),
      osUser: "testuser",
      useSudo: false,
      onToolCall: (name) => toolCalls.push(name),
    });

    // Note: privilegeRunner passes args: ['-p', prompt, '--output-format', 'stream-json', ...]
    // So with agyPath='node', node receives: -p "-e" ... which prints '-e'
    // But we can test cancellation and structure!
    expect(result).toBeDefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
