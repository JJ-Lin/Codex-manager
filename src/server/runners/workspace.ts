import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Task } from "../../shared/types";
import { slugifyWorkspaceKey } from "../ids";

const DEFAULT_WORKSPACE_ROOT = join(process.cwd(), ".codex-manager", "workspaces");
const execFileAsync = promisify(execFile);

export function resolveTaskWorkspace(task: Task): string {
  if (task.workspacePath) {
    mkdirSync(task.workspacePath, { recursive: true });
    return resolve(task.workspacePath);
  }
  const key = slugifyWorkspaceKey(task.sourceRef?.url || task.title || task.id);
  const path = join(DEFAULT_WORKSPACE_ROOT, `${key}-${task.id.slice(-6)}`);
  mkdirSync(path, { recursive: true });
  return path;
}

export function workspaceExists(path?: string | null): boolean {
  return Boolean(path && existsSync(path));
}

export async function prepareTaskWorkspace(task: Task): Promise<{ path: string; managed: boolean; bootstrapped: boolean }> {
  const path = resolveTaskWorkspace(task);
  const managed = !task.workspacePath;
  const hasGit = existsSync(join(path, ".git"));
  const isEmpty = readdirSync(path).length === 0;

  if (task.repoUrl && managed && !hasGit && isEmpty) {
    await execFileAsync("git", ["clone", task.repoUrl, "."], { cwd: path, timeout: 120000 });
    if (task.branchName?.trim()) {
      await switchOrCreateBranch(path, task.branchName.trim());
    }
    return { path, managed, bootstrapped: true };
  }

  return { path, managed, bootstrapped: false };
}

async function switchOrCreateBranch(path: string, branchName: string): Promise<void> {
  try {
    await execFileAsync("git", ["switch", branchName], { cwd: path, timeout: 30000 });
  } catch {
    await execFileAsync("git", ["switch", "-c", branchName], { cwd: path, timeout: 30000 });
  }
}
