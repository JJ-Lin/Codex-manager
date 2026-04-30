import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Task } from "../../shared/types";

const execFileAsync = promisify(execFile);

export interface ExternalSyncCommand {
  command: string;
  args: string[];
  provider: "github" | "gitlab";
}

export interface ExternalSyncResult {
  status: "skipped" | "completed" | "failed";
  message: string;
  command?: ExternalSyncCommand;
  stderr?: string;
}

export async function syncExternalTask(task: Task, note?: string): Promise<ExternalSyncResult> {
  const command = buildExternalSyncCommand(task, note);
  if (!command) {
    return { status: "skipped", message: "本地任务没有外部 tracker 来源，无需同步" };
  }

  try {
    await execFileAsync(command.command, command.args, { timeout: 15000 });
    return { status: "completed", message: "已写回外部 tracker 评论", command };
  } catch (error) {
    return {
      status: "failed",
      message: "外部 tracker 写回失败，本地任务已保留为同步漂移",
      command,
      stderr: error instanceof Error ? error.message : String(error)
    };
  }
}

export function buildExternalSyncCommand(task: Task, note?: string): ExternalSyncCommand | null {
  const body = buildSyncComment(task, note);
  const ref = task.sourceRef;
  if (!ref) return null;

  if (ref.provider === "github" && ref.owner && ref.repo && ref.number) {
    return {
      provider: "github",
      command: "gh",
      args: ["issue", "comment", String(ref.number), "--repo", `${ref.owner}/${ref.repo}`, "--body", body]
    };
  }

  if (ref.provider === "gitlab" && ref.projectPath && ref.iid) {
    return {
      provider: "gitlab",
      command: "glab",
      args: ["issue", "note", String(ref.iid), "--repo", `${ref.host}/${ref.projectPath}`, "--message", body]
    };
  }

  return null;
}

function buildSyncComment(task: Task, note?: string): string {
  const lines = [
    "Codex Manager 已完成本地执行并通过人工复核。",
    "",
    `任务：${task.title}`,
    task.lastCodexSessionId ? `Codex session：${task.lastCodexSessionId}` : "",
    task.workspacePath ? `本地工作区：${task.workspacePath}` : "",
    note?.trim() ? `复核备注：${note.trim()}` : ""
  ].filter(Boolean);
  return lines.join("\n");
}
