import type { ExternalRef, Provider } from "./types";

const GITHUB_ISSUE_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:[/?#].*)?$/i;
const GITLAB_ISSUE_RE = /^https?:\/\/([^/]+)\/(.+)\/-\/issues\/(\d+)(?:[/?#].*)?$/i;

export function parseExternalIssueUrl(url: string, providerHint?: Provider): ExternalRef {
  const trimmed = url.trim();
  const github = trimmed.match(GITHUB_ISSUE_RE);
  if (github && (!providerHint || providerHint === "github")) {
    return {
      provider: "github",
      host: "github.com",
      owner: github[1],
      repo: github[2],
      number: Number(github[3]),
      url: trimmed
    };
  }

  const gitlab = trimmed.match(GITLAB_ISSUE_RE);
  if (gitlab && (!providerHint || providerHint === "gitlab")) {
    return {
      provider: "gitlab",
      host: gitlab[1],
      projectPath: decodeURIComponent(gitlab[2]),
      iid: Number(gitlab[3]),
      url: trimmed
    };
  }

  throw new Error("只支持 GitHub issue URL 或 GitLab issue URL");
}

export function externalRefLabel(ref?: ExternalRef | null): string {
  if (!ref) return "本地";
  if (ref.provider === "github") return `GitHub #${ref.number ?? "?"}`;
  return `GitLab !${ref.iid ?? "?"}`;
}
