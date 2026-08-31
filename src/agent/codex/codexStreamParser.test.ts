import { describe, expect, it, vi } from "vitest";
import { CodexStreamParser } from "./codexStreamParser.js";

describe("CodexStreamParser", () => {
  it("emits complete JSONL events across chunk boundaries and preserves raw output", () => {
    const parser = new CodexStreamParser();
    const event = vi.fn();
    const raw = vi.fn();
    parser.on("event", event);
    parser.on("raw", raw);

    parser.push('{"type":"thread.started","thread_id":"thread_1"}\nplain');
    parser.push(" output\n");
    parser.push('{"type":"agent_message.delta","delta":"hello"}');
    parser.end();

    expect(event).toHaveBeenCalledTimes(2);
    expect(event.mock.calls[0][0]).toMatchObject({ thread_id: "thread_1" });
    expect(event.mock.calls[1][0]).toMatchObject({ delta: "hello" });
    expect(raw).toHaveBeenCalledWith("plain output");
  });
});
