import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { StartTaskInput, Task } from "../../shared/types";
import type { TaskStore } from "../store";
import { nowIso } from "../time";
import { prepareTaskWorkspace } from "./workspace";

interface ActiveRun {
  child: ChildProcessWithoutNullStreams;
  taskId: string;
}

export class CodexRunner {
  private activeRuns = new Map<string, ActiveRun>();
  private stoppedTaskIds = new Set<string>();

  constructor(private readonly store: TaskStore) {}

  activeTaskIds(): string[] {
    return [...this.activeRuns.keys()];
  }

  isRunning(taskId: string): boolean {
    return this.activeRuns.has(taskId);
  }

  async start(taskId: string, input: StartTaskInput = {}): Promise<Task> {
    if (this.activeRuns.has(taskId)) throw new Error("任务已经在执行中");
    const task = this.store.getTask(taskId);
    if (!task) throw new Error("任务不存在");

    this.store.setChecklistRunning(taskId, (label) => label.includes("仓库") || label.includes("工作区"), "正在准备任务工作区");
    let prepared: Awaited<ReturnType<typeof prepareTaskWorkspace>>;
    try {
      prepared = await prepareTaskWorkspace(task);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.updateTask(taskId, { status: "failed", currentStep: "工作区准备失败", finishedAt: nowIso() });
      this.store.addEvent(taskId, "runner.failed", `工作区准备失败：${message}`);
      throw error;
    }
    const workspacePath = prepared.path;
    mkdirSync(workspacePath, { recursive: true });
    this.store.markChecklistDone(
      taskId,
      (label) => label.includes("仓库") || label.includes("工作区"),
      prepared.bootstrapped ? `已克隆 ${task.repoUrl}` : `使用工作区 ${workspacePath}`
    );
    const prompt = input.prompt?.trim() || buildPrompt(task);
    const args = [
      "exec",
      "--json",
      "-C",
      workspacePath,
      "--sandbox",
      input.sandbox ?? "workspace-write",
      "--skip-git-repo-check"
    ];
    if (input.model?.trim()) {
      args.push("--model", input.model.trim());
    }
    args.push(prompt);

    this.store.setChecklistRunning(taskId, (label) => label.includes("启动") || label.includes("执行"), "Codex runner 已启动");
    const startedAt = nowIso();
    const codexBin = process.env.CODEX_MANAGER_CODEX_BIN ?? "codex";
    const child = spawn(codexBin, args, {
      cwd: workspacePath,
      env: { ...process.env, FORCE_COLOR: "0" }
    });
    child.stdin.end();

    this.activeRuns.set(taskId, { child, taskId });
    this.store.updateTask(taskId, {
      status: "running",
      workspacePath,
      runPid: child.pid ?? null,
      startedAt,
      finishedAt: null,
      currentStep: "Codex 正在执行任务"
    });
    this.store.addEvent(taskId, "runner.started", "Codex 执行已启动", {
      pid: child.pid,
      workspacePath,
      command: [codexBin, ...args.slice(0, -1), "<prompt>"].join(" ")
    });

    child.stdout.on("data", (chunk: Buffer) => {
      this.consumeStdout(taskId, chunk.toString("utf8"));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8").trim();
      if (message) this.store.addEvent(taskId, "runner.stderr", message);
    });

    child.on("error", (error) => {
      this.activeRuns.delete(taskId);
      this.store.updateTask(taskId, {
        status: "failed",
        runPid: null,
        finishedAt: nowIso(),
        currentStep: "Codex 启动失败"
      });
      this.store.addEvent(taskId, "runner.failed", error.message, { name: error.name, stack: error.stack });
    });

    child.on("close", (code, signal) => {
      this.activeRuns.delete(taskId);
      if (this.stoppedTaskIds.delete(taskId)) {
        return;
      }
      const latest = this.store.getTask(taskId);
      if (!latest) return;
      if (code === 0) {
        this.store.markChecklistDone(taskId, (label) => label.includes("启动") || label.includes("执行"), "Codex 进程退出码 0");
        this.store.markChecklistDone(taskId, (label) => label.includes("跟踪") || label.includes("日志"), "已采集 Codex JSONL 事件");
        this.store.markChecklistDone(taskId, (label) => label.includes("整理") || label.includes("证据"), "执行输出已写入事件流");
        const nextStatus = latest.humanReviewRequired ? "needs_review" : "completed";
        this.store.updateTask(taskId, {
          status: nextStatus,
          runPid: null,
          finishedAt: nowIso(),
          currentStep: latest.humanReviewRequired ? "等待人工复核" : "执行完成"
        });
        if (latest.humanReviewRequired) {
          this.store.addEvent(taskId, "review.requested", latest.humanReviewReason || "Codex 执行完成，等待人工复核");
        }
        this.store.addEvent(taskId, "runner.finished", "Codex 执行完成", { code, signal });
      } else {
        this.store.updateTask(taskId, {
          status: "failed",
          runPid: null,
          finishedAt: nowIso(),
          currentStep: `Codex 执行失败：${signal ?? code ?? "unknown"}`
        });
        this.store.addEvent(taskId, "runner.failed", "Codex 执行失败", { code, signal });
      }
    });

    return this.store.getTask(taskId)!;
  }

  stop(taskId: string): Task {
    const run = this.activeRuns.get(taskId);
    if (!run) throw new Error("任务当前没有运行中的 Codex 进程");
    run.child.kill("SIGTERM");
    this.stoppedTaskIds.add(taskId);
    this.activeRuns.delete(taskId);
    this.store.updateTask(taskId, {
      status: "blocked",
      runPid: null,
      finishedAt: nowIso(),
      currentStep: "已手动停止，等待处理"
    });
    this.store.addEvent(taskId, "runner.stopped", "用户手动停止 Codex 运行");
    return this.store.getTask(taskId)!;
  }

  private consumeStdout(taskId: string, text: string): void {
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const parsed = parseJsonLine(line);
        if (!parsed) {
          this.store.addEvent(taskId, "runner.output", line);
          return;
        }
        this.store.addEvent(taskId, "runner.codex_event", summarizeCodexEvent(parsed), parsed);
        this.applyCodexEvent(taskId, parsed);
      });
  }

  private applyCodexEvent(taskId: string, event: Record<string, unknown>): void {
    const threadId = findString(event, ["thread_id", "threadId", "conversation_id", "conversationId"]);
    const turnId = findString(event, ["turn_id", "turnId"]);
    const sessionId = findString(event, ["session_id", "sessionId"]);
    const update: Partial<Task> = {};
    if (threadId) update.lastCodexThreadId = threadId;
    if (turnId) update.lastCodexTurnId = turnId;
    if (sessionId || threadId || turnId) update.lastCodexSessionId = sessionId ?? [threadId, turnId].filter(Boolean).join("-");

    const type = String(event.type ?? nestedString(event, "msg", "type") ?? "");
    if (type.includes("tool") || type.includes("exec")) {
      update.currentStep = "Codex 正在调用工具或执行命令";
    } else if (type.includes("agent") || type.includes("message")) {
      update.currentStep = "Codex 正在生成或更新答复";
    }
    if (Object.keys(update).length > 0) this.store.updateTask(taskId, update);
  }
}

function buildPrompt(task: Task): string {
  const checklist = task.checklist.map((item) => `- [${item.status === "done" ? "x" : " "}] ${item.label}`).join("\n");
  const source = task.sourceRef?.url ? `\n外部来源：${task.sourceRef.url}` : "";
  return [
    "你正在由 Codex Manager 执行一个本地可观察任务。",
    "请按 checklist 推进，过程中保留清晰的证据；完成代码或分析后停在可供人工复核的状态。",
    "",
    `任务标题：${task.title}`,
    task.description ? `任务描述：${task.description}` : "",
    task.repoUrl ? `目标仓库：${task.repoUrl}` : "",
    task.branchName ? `目标分支：${task.branchName}` : "",
    source,
    "",
    "Checklist:",
    checklist
  ]
    .filter(Boolean)
    .join("\n");
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function summarizeCodexEvent(event: Record<string, unknown>): string {
  const type = String(event.type ?? nestedString(event, "msg", "type") ?? "codex_event");
  const text = findString(event, ["message", "text", "summary", "delta"]);
  return text ? `${type}: ${text.slice(0, 240)}` : type;
}

function findString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function nestedString(record: Record<string, unknown>, objectKey: string, valueKey: string): string | null {
  const nested = record[objectKey];
  if (!nested || typeof nested !== "object") return null;
  const value = (nested as Record<string, unknown>)[valueKey];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
