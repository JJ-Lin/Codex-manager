import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DoctorCheck, DoctorReport } from "../shared/types";
import { detectGitIdentities } from "./integrations/gitIdentity";
import { nowIso } from "./time";
import { loadWorkflow } from "./workflow";

const execFileAsync = promisify(execFile);

export async function runDoctor(): Promise<DoctorReport> {
  const workflow = loadWorkflow();
  const identities = await detectGitIdentities();
  const checks: DoctorCheck[] = [
    await commandCheck("codex", ["--version"], "Codex CLI"),
    await commandCheck("gh", ["--version"], "GitHub CLI"),
    await commandCheck("glab", ["--version"], "GitLab CLI"),
    {
      id: "workflow",
      label: "WORKFLOW 契约",
      status: workflow.status === "loaded" ? "ok" : workflow.status === "missing" ? "warn" : "fail",
      detail: workflow.path ? `${workflow.message}: ${workflow.path}` : workflow.message
    },
    await workspaceRootCheck(),
    ...identities.map((identity) => ({
      id: `identity-${identity.provider}`,
      label: `${identity.provider} 身份`,
      status: identity.usableForCommits && identity.apiAvailable ? "ok" : identity.usableForCommits ? "warn" : "fail",
      detail: `${identity.name ?? "未配置"} <${identity.email ?? "未配置"}>; API ${identity.apiAvailable ? "可用" : "不可用"}`
    }) satisfies DoctorCheck)
  ];

  return { generatedAt: nowIso(), checks };
}

async function commandCheck(command: string, args: string[], label: string): Promise<DoctorCheck> {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 5000 });
    return { id: command, label, status: "ok", detail: stdout.trim().split(/\r?\n/)[0] || "可用" };
  } catch {
    return { id: command, label, status: command === "codex" ? "fail" : "warn", detail: "未检测到或未登录" };
  }
}

async function workspaceRootCheck(): Promise<DoctorCheck> {
  const root = process.env.CODEX_MANAGER_WORKSPACE_ROOT ?? join(process.env.HOME ?? process.cwd(), ".codex-manager", "workspaces");
  try {
    await mkdir(root, { recursive: true });
    await access(root, constants.W_OK);
    return { id: "workspace-root", label: "隔离工作区根目录", status: "ok", detail: root };
  } catch (error) {
    return {
      id: "workspace-root",
      label: "隔离工作区根目录",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}
