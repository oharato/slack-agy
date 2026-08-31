import { describe, it, expect } from "vitest";
import {
  extractAgentFromPrompt,
  extractPromptOptions,
  extractRepoFromPrompt,
  parseRepoTarget,
  sanitizeSlackLink,
} from "./repoUtils.js";

describe("repoUtils", () => {
  it("should sanitize slack link markup", () => {
    const raw = "<https://github.com/oharato/docs-repo|github.com/oharato/docs-repo>";
    expect(sanitizeSlackLink(raw)).toBe("https://github.com/oharato/docs-repo");
  });

  it("should extract repo from Slack link containing github URL", () => {
    const text =
      "<https://github.com/oharato/docs-repo|github.com/oharato/docs-repo> 最近のナレッジは？";
    const result = extractRepoFromPrompt(text);

    expect(result.repoNameOrUrl).toBe("https://github.com/oharato/docs-repo");
    expect(result.cleanedPrompt).toBe("最近のナレッジは？");
  });

  it("should extract repo from repo: prefix with slack link or plain text", () => {
    const text1 =
      "repo:<https://github.com/oharato/docs-repo|github.com/oharato/docs-repo> 調査して";
    const res1 = extractRepoFromPrompt(text1);
    expect(res1.repoNameOrUrl).toBe("https://github.com/oharato/docs-repo");
    expect(res1.cleanedPrompt).toBe("調査して");

    const text2 = "repo:docs-repo 最近のナレッジは？";
    const res2 = extractRepoFromPrompt(text2);
    expect(res2.repoNameOrUrl).toBe("docs-repo");
    expect(res2.cleanedPrompt).toBe("最近のナレッジは？");
  });

  it("should extract agent from agent: prefix", () => {
    const res1 = extractAgentFromPrompt("agent:codex バグを直して");
    expect(res1.agentId).toBe("codex");
    expect(res1.cleanedPrompt).toBe("バグを直して");

    const res2 = extractAgentFromPrompt("agent:AGY 調べて");
    expect(res2.agentId).toBe("agy");
    expect(res2.cleanedPrompt).toBe("調べて");
  });

  it("should extract both agent and repo from combined prompt options", () => {
    const res1 = extractPromptOptions("agent:codex repo:my-service 型エラーを直して");
    expect(res1.agentId).toBe("codex");
    expect(res1.repoNameOrUrl).toBe("my-service");
    expect(res1.cleanedPrompt).toBe("型エラーを直して");

    const res2 = extractPromptOptions("repo:my-service agent:agy 調査して");
    expect(res2.agentId).toBe("agy");
    expect(res2.repoNameOrUrl).toBe("my-service");
    expect(res2.cleanedPrompt).toBe("調査して");
  });

  it("should extract repo from plain github URL", () => {
    const text = "https://github.com/oharato/my-service.git バグ直して";
    const res = extractRepoFromPrompt(text);
    expect(res.repoNameOrUrl).toBe("https://github.com/oharato/my-service");
    expect(res.cleanedPrompt).toBe("バグ直して");
  });

  it("should parse repo target properly", () => {
    const t1 = parseRepoTarget("https://github.com/oharato/docs-repo.git");
    expect(t1.repoName).toBe("docs-repo");
    expect(t1.cloneUrl).toBe("https://github.com/oharato/docs-repo.git");

    const t2 = parseRepoTarget("oharato/docs-repo");
    expect(t2.repoName).toBe("docs-repo");
    expect(t2.cloneUrl).toBe("oharato/docs-repo");

    const t3 = parseRepoTarget("docs-repo");
    expect(t3.repoName).toBe("docs-repo");
    expect(t3.cloneUrl).toBe("docs-repo");
  });
});
