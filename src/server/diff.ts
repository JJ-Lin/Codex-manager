import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Task, WorkspaceDiff } from "../shared/types";
import { nowIso } from "./time";

const execFileAsync = promisify(execFile);

export async function workspaceDiff(task: Task): Promise<WorkspaceDiff> {
  if (!task.workspacePath) {
    return emptyDiff(task.id, null, false);
  }

  const isGitRepository = await gitSucceeds(task.workspacePath, ["rev-parse", "--is-inside-work-tree"]);
  if (!isGitRepository) {
    return emptyDiff(task.id, task.workspacePath, false);
  }

  const [status, stat, files] = await Promise.all([
    gitOutput(task.workspacePath, ["status", "--short"]),
    gitOutput(task.workspacePath, ["diff", "--stat"]),
    gitOutput(task.workspacePath, ["diff", "--name-only"])
  ]);

  return {
    taskId: task.id,
    workspacePath: task.workspacePath,
    isGitRepository,
    status: splitLines(status),
    stat,
    files: splitLines(files),
    generatedAt: nowIso()
  };
}

function emptyDiff(taskId: string, workspacePath: string | null, isGitRepository: boolean): WorkspaceDiff {
  return {
    taskId,
    workspacePath,
    isGitRepository,
    status: [],
    stat: "",
    files: [],
    generatedAt: nowIso()
  };
}

async function gitSucceeds(cwd: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync("git", args, { cwd, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, timeout: 5000, maxBuffer: 1024 * 1024 });
    return stdout.trim();
  } catch {
    return "";
  }
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
}
