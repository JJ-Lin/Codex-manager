import { mkdirSync } from "node:fs";
import type { StartTaskInput, Task } from "../../shared/types";
import type { TaskStore } from "../store";
import { nowIso } from "../time";
import { AppServerProtocolClient, type AppServerProtocolMessage, type JsonRecord } from "./appServerProtocol";
import { prepareTaskWorkspace } from "./workspace";

interface ActiveRun {
  client: AppServerProtocolClient;
  taskId: string;
  threadId?: string;
  turnId?: string;
  resolveCompletion?: (outcome: TurnOutcome) => void;
  stopped: boolean;
  completed: boolean;
}

type TurnOutcome =
  | { status: "completed"; payload: AppServerProtocolMessage }
  | { status: "failed"; message: string; payload?: AppServerProtocolMessage }
  | { status: "stopped"; message: string };

const NON_INTERACTIVE_ANSWER = "Codex Manager 当前是非交互式执行环境，无法在任务过程中等待人工输入。";
const STDERR_LIMIT = 1200;
const DEFAULT_CODEX_MODEL = "gpt-5.5";

export function defaultCodexModel(): string {
  return process.env.CODEX_MANAGER_MODEL || DEFAULT_CODEX_MODEL;
}

export class CodexRunner {
  private activeRuns = new Map<string, ActiveRun>();

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

    const prompt = input.prompt?.trim() || buildRunPrompt(task);
    const codexBin = process.env.CODEX_MANAGER_CODEX_BIN ?? "codex";
    const client = new AppServerProtocolClient({
      codexBin,
      cwd: workspacePath,
      onNotification: (message) => this.handleNotification(taskId, message),
      onServerRequest: (message) => this.handleServerRequest(taskId, message),
      onStderr: (line) => this.handleStderr(taskId, line),
      onExit: (code, signal) => this.handleExit(taskId, code, signal)
    });

    const run: ActiveRun = {
      client,
      taskId,
      stopped: false,
      completed: false
    };
    this.activeRuns.set(taskId, run);

    const startedAt = nowIso();
    this.store.setChecklistRunning(taskId, (label) => label.includes("启动") || label.includes("执行"), "Codex app-server 已启动");
    this.store.updateTask(taskId, {
      status: "running",
      workspacePath,
      runPid: client.pid(),
      startedAt,
      finishedAt: null,
      currentStep: "Codex app-server 正在初始化"
    });
    this.store.addEvent(taskId, "runner.started", "Codex app-server 执行已启动", {
      pid: client.pid(),
      workspacePath,
      command: `${codexBin} app-server`
    });

    void this.runAppServerTurn(taskId, run, task, workspacePath, prompt, input).catch((error: unknown) => {
      this.failRun(taskId, error instanceof Error ? error.message : String(error));
    });

    return this.store.getTask(taskId)!;
  }

  stop(taskId: string): Task {
    const run = this.activeRuns.get(taskId);
    if (!run) throw new Error("任务当前没有运行中的 Codex app-server");
    run.stopped = true;
    run.resolveCompletion?.({ status: "stopped", message: "用户手动停止 Codex 运行" });
    if (run.threadId && run.turnId) {
      void run.client.request("turn/interrupt", { threadId: run.threadId, turnId: run.turnId }, 3000).catch(() => undefined);
    }
    run.client.shutdown();
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

  private async runAppServerTurn(
    taskId: string,
    run: ActiveRun,
    task: Task,
    workspacePath: string,
    prompt: string,
    input: StartTaskInput
  ): Promise<void> {
    const model = input.model?.trim() || defaultCodexModel();
    const sandbox = input.sandbox ?? "workspace-write";

    const completion = new Promise<TurnOutcome>((resolve) => {
      run.resolveCompletion = resolve;
    });

    const initResult = await run.client.initialize();
    this.store.addEvent(taskId, "runner.codex_event", "initialize: Codex app-server 已握手", initResult);

    const threadResult = await openThread(run.client, task, workspacePath, model, sandbox);
    const threadId = nestedString(threadResult, "thread", "id");
    if (!threadId) throw new Error("Codex app-server 未返回 thread id");
    const openedByResume = Boolean(threadResult.__codexManagerResumed);
    run.threadId = threadId;
    this.store.updateTask(taskId, {
      lastCodexThreadId: threadId,
      lastCodexSessionId: threadId,
      currentStep: openedByResume ? "Codex thread 已恢复" : "Codex thread 已创建"
    });
    this.store.addEvent(taskId, "runner.codex_event", `${openedByResume ? "thread/resume" : "thread/start"}: ${threadId}`, threadResult);

    const turnResult = await run.client.request<JsonRecord>("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt, text_elements: [] }],
      cwd: workspacePath,
      model,
      approvalPolicy: "never",
      sandboxPolicy: sandboxPolicyFor(sandbox, workspacePath)
    });
    const turnId = nestedString(turnResult, "turn", "id");
    if (!turnId) throw new Error("Codex app-server 未返回 turn id");
    run.turnId = turnId;
    this.store.updateTask(taskId, {
      lastCodexTurnId: turnId,
      lastCodexSessionId: `${threadId}-${turnId}`,
      currentStep: "Codex turn 正在执行"
    });
    this.store.addEvent(taskId, "runner.codex_event", `turn/start: ${turnId}`, turnResult);

    const outcome = await completion;
    if (outcome.status === "stopped") return;
    if (outcome.status === "failed") {
      this.failRun(taskId, outcome.message, outcome.payload);
      return;
    }
    this.completeRun(taskId, outcome.payload);
  }

  private handleNotification(taskId: string, message: AppServerProtocolMessage): void {
    const method = message.method ?? "notification";
    this.store.addEvent(taskId, "runner.codex_event", summarizeAppServerMessage(message), message);

    const run = this.activeRuns.get(taskId);
    const params = asRecord(message.params);
    if (method === "thread/started") {
      const threadId = nestedString(params, "thread", "id");
      if (threadId) {
        if (run) run.threadId = threadId;
        this.store.updateTask(taskId, { lastCodexThreadId: threadId, lastCodexSessionId: threadId });
      }
      return;
    }

    if (method === "turn/started") {
      const turnId = nestedString(params, "turn", "id");
      const threadId = findString(params, ["threadId"]);
      if (run) {
        if (threadId) run.threadId = threadId;
        if (turnId) run.turnId = turnId;
      }
      this.store.markChecklistDone(taskId, (label) => label.includes("启动") || label.includes("执行"), "Codex turn 已启动");
      this.store.setChecklistRunning(taskId, (label) => label.includes("跟踪") || label.includes("日志"), "正在采集 app-server 事件流");
      this.store.updateTask(taskId, {
        lastCodexThreadId: threadId ?? run?.threadId,
        lastCodexTurnId: turnId ?? run?.turnId,
        lastCodexSessionId: [threadId ?? run?.threadId, turnId ?? run?.turnId].filter(Boolean).join("-") || undefined,
        currentStep: "Codex turn 已开始"
      });
      return;
    }

    if (method === "item/started" || method === "item/completed") {
      this.store.updateTask(taskId, { currentStep: currentStepFromItem(params, method) });
      return;
    }

    if (method.endsWith("/delta") || method === "turn/plan/updated") {
      this.store.updateTask(taskId, { currentStep: currentStepFromDelta(method) });
      return;
    }

    if (method === "error") {
      const errorMessage = nestedString(params, "error", "message") ?? "Codex turn 发生错误";
      run?.resolveCompletion?.({ status: "failed", message: errorMessage, payload: message });
      return;
    }

    if (method === "turn/completed") {
      const status = nestedString(params, "turn", "status");
      if (status === "failed" || status === "interrupted") {
        run?.resolveCompletion?.({
          status: "failed",
          message: nestedString(params, "turn", "error") ?? `Codex turn 状态为 ${status}`,
          payload: message
        });
        return;
      }
      run?.resolveCompletion?.({ status: "completed", payload: message });
    }
  }

  private handleServerRequest(taskId: string, message: AppServerProtocolMessage): unknown {
    const method = message.method ?? "server/request";
    this.store.addEvent(taskId, "runner.codex_event", `server request: ${method}`, message);

    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
      this.store.updateTask(taskId, { currentStep: "Codex 请求权限，已按本地任务策略自动批准" });
      return { decision: "acceptForSession" };
    }

    if (method === "execCommandApproval" || method === "applyPatchApproval") {
      this.store.updateTask(taskId, { currentStep: "Codex 请求旧版权限，已按本地任务策略自动批准" });
      return { decision: "approved_for_session" };
    }

    if (method === "item/permissions/requestApproval") {
      const params = asRecord(message.params);
      this.store.updateTask(taskId, { currentStep: "Codex 请求扩展权限，已按本地任务策略批准到本次会话" });
      return { permissions: params.permissions ?? {}, scope: "session" };
    }

    if (method === "item/tool/requestUserInput") {
      const params = asRecord(message.params);
      this.store.updateTask(taskId, { status: "needs_input", currentStep: "Codex 请求人工输入，已返回非交互式说明" });
      return { answers: buildNonInteractiveAnswers(params) };
    }

    if (method === "item/tool/call") {
      const params = asRecord(message.params);
      const tool = findString(params, ["tool", "name"]) ?? "unknown";
      return {
        success: false,
        contentItems: [{ type: "inputText", text: `Codex Manager 尚未注册动态工具：${tool}` }]
      };
    }

    return {};
  }

  private handleStderr(taskId: string, line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    this.store.addEvent(taskId, "runner.stderr", summarizeStderr(trimmed));
  }

  private handleExit(taskId: string, code: number | null, signal: NodeJS.Signals | null): void {
    const run = this.activeRuns.get(taskId);
    if (!run || run.stopped || run.completed) return;
    run.resolveCompletion?.({ status: "failed", message: `Codex app-server 异常退出：${signal ?? code ?? "unknown"}` });
  }

  private completeRun(taskId: string, payload: AppServerProtocolMessage): void {
    const run = this.activeRuns.get(taskId);
    if (run) {
      run.completed = true;
      run.client.shutdown();
      this.activeRuns.delete(taskId);
    }
    this.store.markChecklistDone(taskId, (label) => label.includes("跟踪") || label.includes("日志"), "已采集 Codex app-server 事件流");
    this.store.markChecklistDone(taskId, (label) => label.includes("整理") || label.includes("证据"), "执行输出已写入事件流");
    const latest = this.store.getTask(taskId);
    if (!latest) return;
    const nextStatus = latest.humanReviewRequired ? "needs_review" : "completed";
    this.store.updateTask(taskId, {
      status: nextStatus,
      runPid: null,
      finishedAt: nowIso(),
      currentStep: latest.humanReviewRequired ? "等待人工复核" : "执行完成"
    });
    if (latest.humanReviewRequired) {
      this.store.setChecklistRunning(taskId, (label) => label.includes("人工复核"), "等待你复核 Codex 最终回答和产物");
      this.store.addEvent(taskId, "review.requested", latest.humanReviewReason || "Codex 执行完成，等待人工复核");
    }
    this.store.addEvent(taskId, "runner.finished", "Codex app-server turn 已完成", payload);
  }

  private failRun(taskId: string, message: string, payload?: unknown): void {
    const run = this.activeRuns.get(taskId);
    if (run) {
      run.completed = true;
      run.client.shutdown();
      this.activeRuns.delete(taskId);
    }
    this.store.markChecklistBlocked(taskId, (label) => label.includes("启动") || label.includes("执行"), message);
    this.store.updateTask(taskId, {
      status: "failed",
      runPid: null,
      finishedAt: nowIso(),
      currentStep: message
    });
    this.store.addEvent(taskId, "runner.failed", message, payload);
  }
}

async function openThread(
  client: AppServerProtocolClient,
  task: Task,
  workspacePath: string,
  model: string,
  sandbox: StartTaskInput["sandbox"]
): Promise<JsonRecord> {
  if (shouldResumeThread(task) && task.lastCodexThreadId) {
    try {
      const resumed = await client.request<JsonRecord>("thread/resume", {
        threadId: task.lastCodexThreadId,
        cwd: workspacePath,
        model,
        approvalPolicy: "never",
        sandbox,
        persistExtendedHistory: true
      });
      return { ...resumed, __codexManagerResumed: true };
    } catch {
      // If the local rollout was removed or the app-server cannot resume it,
      // fall back to a fresh thread so the operator can still make progress.
    }
  }

  return client.request<JsonRecord>("thread/start", {
    approvalPolicy: "never",
    cwd: workspacePath,
    model,
    sandbox,
    experimentalRawEvents: true,
    persistExtendedHistory: true
  });
}

function buildRunPrompt(task: Task): string {
  return shouldResumeThread(task) ? buildContinuationPrompt(task) : buildInitialPrompt(task);
}

function buildInitialPrompt(task: Task): string {
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

function buildContinuationPrompt(task: Task): string {
  const checklist = task.checklist.map((item) => `- [${item.status === "done" ? "x" : " "}] ${item.label}`).join("\n");
  const reviewNote = latestOperatorNote(task);
  return [
    "Continuation guidance:",
    "",
    "- The previous Codex turn already ran in this task. Resume from the current workspace and previous thread context instead of restarting from scratch.",
    "- Do not restate the original task. Focus on the remaining checklist items and the operator's latest review note.",
    "- If you produce a reviewable artifact, write it to the workspace and mention the exact path in your final answer.",
    reviewNote ? `- Operator review note: ${reviewNote}` : "",
    "",
    "Current checklist:",
    checklist
  ]
    .filter(Boolean)
    .join("\n");
}

function shouldResumeThread(task: Task): boolean {
  return Boolean(task.lastCodexThreadId && ["needs_input", "blocked", "failed"].includes(task.status));
}

function latestOperatorNote(task: Task): string | null {
  for (const event of [...task.events].reverse()) {
    if (!["review.changes_requested", "task.note"].includes(event.kind)) continue;
    if (event.message.trim()) return event.message.trim();
  }
  return null;
}

function sandboxPolicyFor(sandbox: StartTaskInput["sandbox"], workspacePath: string): JsonRecord {
  if (sandbox === "danger-full-access") return { type: "dangerFullAccess" };
  if (sandbox === "read-only") {
    return {
      type: "readOnly",
      access: { type: "fullAccess" },
      networkAccess: true
    };
  }
  return {
    type: "workspaceWrite",
    writableRoots: [workspacePath],
    readOnlyAccess: { type: "fullAccess" },
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  };
}

function summarizeAppServerMessage(message: AppServerProtocolMessage): string {
  const method = message.method ?? "response";
  const params = asRecord(message.params);
  const delta = findString(params, ["delta"]);
  if (delta) return `${method}: ${truncate(delta, 240)}`;

  const item = asRecord(params.item);
  const itemType = findString(item, ["type"]);
  if (itemType) {
    const command = findString(item, ["command"]);
    const tool = findString(item, ["tool"]);
    return [method, itemType, command ? truncate(command, 180) : tool].filter(Boolean).join(": ");
  }

  const turnId = nestedString(params, "turn", "id");
  if (turnId) return `${method}: ${turnId}`;
  const threadId = nestedString(params, "thread", "id");
  if (threadId) return `${method}: ${threadId}`;
  return method;
}

function currentStepFromItem(params: JsonRecord, method: string): string {
  const item = asRecord(params.item);
  const type = findString(item, ["type"]);
  const done = method === "item/completed";
  if (type === "commandExecution") return done ? "Codex 命令执行完成" : "Codex 正在执行命令";
  if (type === "fileChange") return done ? "Codex 文件修改已完成" : "Codex 正在修改文件";
  if (type === "mcpToolCall" || type === "dynamicToolCall") return done ? "Codex 工具调用完成" : "Codex 正在调用工具";
  if (type === "agentMessage") return done ? "Codex 答复生成完成" : "Codex 正在生成答复";
  if (type === "plan") return done ? "Codex 计划更新完成" : "Codex 正在更新计划";
  return done ? "Codex item 已完成" : "Codex item 正在执行";
}

function currentStepFromDelta(method: string): string {
  if (method.includes("commandExecution")) return "Codex 正在输出命令日志";
  if (method.includes("fileChange")) return "Codex 正在输出文件变更";
  if (method.includes("plan")) return "Codex 正在更新计划";
  if (method.includes("reasoning")) return "Codex 正在整理推理摘要";
  return "Codex 正在流式输出";
}

function buildNonInteractiveAnswers(params: JsonRecord): JsonRecord {
  const questions = Array.isArray(params.questions) ? params.questions : [];
  const answers: JsonRecord = {};
  for (const question of questions) {
    const id = question && typeof question === "object" ? (question as JsonRecord).id : null;
    if (typeof id === "string" && id.trim()) {
      answers[id] = { answers: [NON_INTERACTIVE_ANSWER] };
    }
  }
  return answers;
}

function summarizeStderr(line: string): string {
  const parsed = parseJson(line);
  if (parsed) {
    const fields = asRecord(parsed.fields);
    const message = findString(fields, ["message"]) ?? findString(parsed, ["message"]);
    const level = findString(parsed, ["level"]);
    if (message) return truncate([level, message].filter(Boolean).join(": "), STDERR_LIMIT);
  }
  return truncate(line, STDERR_LIMIT);
}

function parseJson(line: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as JsonRecord) : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function findString(record: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function nestedString(record: JsonRecord, objectKey: string, valueKey: string): string | null {
  const nested = asRecord(record[objectKey]);
  const value = nested[valueKey];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const message = (value as JsonRecord).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return null;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}
