import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseExternalIssueUrl } from "../../shared/external";
import type { CreateTaskInput, ExternalIssueInput, ExternalRef } from "../../shared/types";

const execFileAsync = promisify(execFile);

export async function importExternalIssue(input: ExternalIssueInput): Promise<CreateTaskInput & { sourceKind: "github" | "gitlab"; sourceRef: ExternalRef }> {
  const ref = parseExternalIssueUrl(input.url, input.provider);
  if (ref.provider === "github") {
    const enriched = await enrichGithubIssue(ref);
    return issueToTaskInput(enriched);
  }
  const enriched = await enrichGitlabIssue(ref);
  return issueToTaskInput(enriched);
}

function issueToTaskInput(ref: ExternalRef): CreateTaskInput & { sourceKind: "github" | "gitlab"; sourceRef: ExternalRef } {
  const title = ref.title || `${ref.provider === "github" ? "GitHub" : "GitLab"} issue ${ref.number ?? ref.iid ?? ""}`.trim();
  const repoUrl =
    ref.provider === "github" && ref.owner && ref.repo
      ? `git@github.com:${ref.owner}/${ref.repo}.git`
      : ref.provider === "gitlab" && ref.projectPath
        ? `gitlab@${ref.host}:${ref.projectPath}.git`
        : undefined;
  return {
    title,
    description: ref.url ? `来源：${ref.url}` : "",
    repoUrl,
    providerAccount: ref.provider,
    sourceKind: ref.provider,
    sourceRef: ref,
    humanReviewRequired: true,
    humanReviewReason: "外部同步任务默认需要人工复核后再关闭或推进"
  };
}

async function enrichGithubIssue(ref: ExternalRef): Promise<ExternalRef> {
  if (!ref.owner || !ref.repo || !ref.number) return ref;
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["issue", "view", String(ref.number), "--repo", `${ref.owner}/${ref.repo}`, "--json", "title,state,url,updatedAt,labels"],
      { timeout: 10000 }
    );
    const parsed = JSON.parse(stdout) as {
      title?: string;
      state?: string;
      url?: string;
      updatedAt?: string;
      labels?: Array<{ name?: string }>;
    };
    return {
      ...ref,
      title: parsed.title ?? ref.title,
      state: parsed.state ?? ref.state,
      url: parsed.url ?? ref.url,
      updatedAt: parsed.updatedAt ?? ref.updatedAt,
      labels: parsed.labels?.map((label) => label.name).filter((name): name is string => Boolean(name)) ?? ref.labels
    };
  } catch {
    return ref;
  }
}

async function enrichGitlabIssue(ref: ExternalRef): Promise<ExternalRef> {
  if (!ref.projectPath || !ref.iid) return ref;
  try {
    const { stdout } = await execFileAsync(
      "glab",
      ["issue", "view", String(ref.iid), "--repo", `${ref.host}/${ref.projectPath}`, "--output", "json"],
      { timeout: 10000 }
    );
    const parsed = JSON.parse(stdout) as {
      title?: string;
      state?: string;
      web_url?: string;
      updated_at?: string;
      labels?: string[];
    };
    return {
      ...ref,
      title: parsed.title ?? ref.title,
      state: parsed.state ?? ref.state,
      url: parsed.web_url ?? ref.url,
      updatedAt: parsed.updated_at ?? ref.updatedAt,
      labels: parsed.labels ?? ref.labels
    };
  } catch {
    return ref;
  }
}
