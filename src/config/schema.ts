import { z } from "zod";

export const configSchema = z.object({
  // Slack Authentication
  SLACK_BOT_TOKEN: z.string().min(1, "SLACK_BOT_TOKEN is required"),
  SLACK_APP_TOKEN: z.string().min(1, "SLACK_APP_TOKEN is required"),
  SLACK_SIGNING_SECRET: z.string().optional(),

  // Multi-User Mapping (JSON string -> Record<string, string>)
  SLACK_USER_OS_MAPPINGS: z.string().transform((str, ctx) => {
    try {
      const parsed = JSON.parse(str);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "SLACK_USER_OS_MAPPINGS must be a valid JSON object",
        });
        return z.NEVER;
      }
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== "string") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Mapping value for ${key} must be a string`,
          });
          return z.NEVER;
        }
      }
      return parsed as Record<string, string>;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "SLACK_USER_OS_MAPPINGS must be valid JSON",
      });
      return z.NEVER;
    }
  }),

  // Allowed Slack Channels (comma-separated string -> string[])
  ALLOWED_CHANNEL_IDS: z
    .string()
    .optional()
    .default("")
    .transform((str) =>
      str
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),

  // Shared Workspace & Git Worktree
  SHARED_WORKSPACE_ROOT: z.string().default("/var/workspace/shared"),
  DEFAULT_REPO: z.string().default(""),
  DEFAULT_BASE_BRANCH: z.string().default("main"),

  // Task & Concurrency Control
  MAX_CONCURRENT_TASKS: z.coerce.number().int().positive().default(2),
  TASK_TIMEOUT_MS: z.coerce.number().int().positive().default(600000), // 10 minutes
  PROGRESS_THROTTLE_MS: z.coerce.number().int().positive().default(800), // 800ms
  WORKTREE_TTL_HOURS: z.coerce.number().int().positive().default(168), // 7 days

  // Structured Logging & Storage
  LOG_DIR: z.string().default("./logs"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  LOG_STDOUT: z
    .string()
    .optional()
    .default("true")
    .transform((val) => val === "true" || val === "1"),
  LOG_AUDIT_ENABLED: z
    .string()
    .optional()
    .default("true")
    .transform((val) => val === "true" || val === "1"),
  DATA_DIR: z.string().default("./data"),
});

export type AppConfig = z.infer<typeof configSchema>;
