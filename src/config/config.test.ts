import { describe, it, expect } from "vitest";
import { configSchema } from "./schema.js";
import { UserMapper } from "./userMap.js";

describe("Config Schema Validation", () => {
  it("should validate valid configuration and parse json mapping", () => {
    const rawEnv = {
      SLACK_BOT_TOKEN: "xoxb-12345",
      SLACK_APP_TOKEN: "xapp-67890",
      SLACK_USER_OS_MAPPINGS: JSON.stringify({
        U12345: "alice",
        U67890: "bob",
      }),
      ALLOWED_CHANNEL_IDS: "C111, C222",
      MAX_CONCURRENT_TASKS: "3",
    };

    const parsed = configSchema.parse(rawEnv);
    expect(parsed.SLACK_BOT_TOKEN).toBe("xoxb-12345");
    expect(parsed.SLACK_USER_OS_MAPPINGS).toEqual({
      U12345: "alice",
      U67890: "bob",
    });
    expect(parsed.ALLOWED_CHANNEL_IDS).toEqual(["C111", "C222"]);
    expect(parsed.MAX_CONCURRENT_TASKS).toBe(3);
    expect(parsed.SHARED_WORKSPACE_ROOT).toBe("/var/workspace/shared");
  });

  it("should reject invalid JSON mapping", () => {
    const rawEnv = {
      SLACK_BOT_TOKEN: "xoxb-12345",
      SLACK_APP_TOKEN: "xapp-67890",
      SLACK_USER_OS_MAPPINGS: "invalid-json",
    };

    expect(() => configSchema.parse(rawEnv)).toThrow();
  });
});

describe("UserMapper", () => {
  it("should resolve OS user for mapped Slack ID", () => {
    const mapper = new UserMapper({
      U_ALICE: "alice",
      U_BOB: "bob",
    });

    expect(mapper.isAuthorized("U_ALICE")).toBe(true);
    expect(mapper.getOsUser("U_ALICE")).toBe("alice");
    expect(mapper.isAuthorized("U_UNKNOWN")).toBe(false);
    expect(mapper.getOsUser("U_UNKNOWN")).toBeUndefined();
  });

  it("should support dynamic mapping update", () => {
    const mapper = new UserMapper();
    mapper.setMapping("U_NEW", "charlie");
    expect(mapper.getOsUser("U_NEW")).toBe("charlie");
    expect(mapper.removeMapping("U_NEW")).toBe(true);
    expect(mapper.getOsUser("U_NEW")).toBeUndefined();
  });
});
