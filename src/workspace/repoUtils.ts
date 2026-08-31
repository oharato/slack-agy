/**
 * Slack メッセージ内の URL やリンク形式（<https://...|...>) をサニタイズ
 */
export function sanitizeSlackLink(text: string): string {
  // <https://github.com/owner/repo|github.com/owner/repo> -> https://github.com/owner/repo
  // <https://github.com/owner/repo> -> https://github.com/owner/repo
  return text.replace(/<([^|>]+)(?:\|[^>]+)?>/g, "$1");
}

export interface ExtractedRepoInfo {
  repoNameOrUrl?: string;
  cleanedPrompt: string;
}

export interface ExtractedPromptOptions {
  agentId?: string;
  repoNameOrUrl?: string;
  cleanedPrompt: string;
}

/**
 * プロンプトテキストからエージェント指定（agent:xxx）を抽出
 */
export function extractAgentFromPrompt(text: string): { agentId?: string; cleanedPrompt: string } {
  let prompt = text;
  const match = prompt.match(/\bagent:([a-zA-Z0-9_-]+)/i);
  if (match) {
    const agentId = match[1].toLowerCase();
    prompt = prompt.replace(match[0], "").trim();
    return { agentId, cleanedPrompt: prompt };
  }
  return { agentId: undefined, cleanedPrompt: prompt };
}

/**
 * プロンプトテキストからエージェント指定およびリポジトリ指定を抽出
 */
export function extractPromptOptions(text: string): ExtractedPromptOptions {
  const agentRes = extractAgentFromPrompt(text);
  const repoRes = extractRepoFromPrompt(agentRes.cleanedPrompt);
  return {
    agentId: agentRes.agentId,
    repoNameOrUrl: repoRes.repoNameOrUrl,
    cleanedPrompt: repoRes.cleanedPrompt,
  };
}

/**
 * プロンプトテキストからリポジトリ指定（repo:xxx, GitHub URL, Slack リンク等）を抽出
 */
export function extractRepoFromPrompt(text: string): ExtractedRepoInfo {
  let prompt = text;

  // 1. repo:<url> または repo:owner/repo または repo:repoName
  // 例: repo:<https://github.com/owner/repo|github.com/owner/repo>
  const repoTagMatch = prompt.match(/\brepo:(<[^>]+>|[^\s]+)/i);
  if (repoTagMatch) {
    const rawRepo = repoTagMatch[1];
    const sanitized = sanitizeSlackLink(rawRepo);
    prompt = prompt.replace(repoTagMatch[0], "").trim();
    return {
      repoNameOrUrl: sanitized,
      cleanedPrompt: prompt,
    };
  }

  // 2. GitHub URL (Slack リンク形式または生URL)
  // 例: <https://github.com/oharato/docs-repo|github.com/oharato/docs-repo>
  // または https://github.com/oharato/docs-repo
  const githubLinkMatch = prompt.match(/<(https?:\/\/github\.com\/[^\s|>]+)(?:\|[^>]*)?>/i);
  if (githubLinkMatch) {
    const url = githubLinkMatch[1].replace(/\.git$/, "");
    prompt = prompt.replace(githubLinkMatch[0], "").trim();
    return {
      repoNameOrUrl: url,
      cleanedPrompt: prompt,
    };
  }

  const rawGithubUrlMatch = prompt.match(/\b(https?:\/\/github\.com\/[^\s]+)/i);
  if (rawGithubUrlMatch) {
    const url = rawGithubUrlMatch[1].replace(/\.git$/, "");
    prompt = prompt.replace(rawGithubUrlMatch[0], "").trim();
    return {
      repoNameOrUrl: url,
      cleanedPrompt: prompt,
    };
  }

  return {
    repoNameOrUrl: undefined,
    cleanedPrompt: prompt,
  };
}

/**
 * リポジトリ URL や名前からリポジトリ名 (ディレクトリ名) と Clone 用ターゲットを導出
 */
export function parseRepoTarget(input: string): { repoName: string; cloneUrl: string } {
  const sanitized = sanitizeSlackLink(input.trim());

  // URL 形式: https://github.com/owner/repo or git@github.com:owner/repo.git
  if (
    sanitized.includes("github.com") ||
    sanitized.includes("://") ||
    sanitized.startsWith("git@")
  ) {
    const match = sanitized.match(/\/([^/]+?)(?:\.git)?$/);
    const repoName = match ? match[1] : sanitized.replace(/[^a-zA-Z0-9_.-]/g, "_");
    return { repoName, cloneUrl: sanitized };
  }

  // owner/repo 形式 (例: oharato/docs-repo)
  if (sanitized.includes("/")) {
    const parts = sanitized.split("/");
    const repoName = parts[parts.length - 1];
    return { repoName, cloneUrl: sanitized };
  }

  // repo 単体名 (例: docs-repo)
  return { repoName: sanitized, cloneUrl: sanitized };
}
