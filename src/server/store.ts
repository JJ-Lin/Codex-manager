import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ChecklistItem,
  ChecklistItemStatus,
  CreateTaskInput,
  EventKind,
  ExternalRef,
  OrchestrationMode,
  Task,
  TaskEvent,
  TaskStatus
} from "../shared/types";
import { checklistFromTemplate } from "./checklist";
import { id } from "./ids";
import { nowIso } from "./time";
import { loadWorkflow, profileForTask } from "./workflow";

type SqlValue = string | number | null;
type Row = Record<string, unknown>;

const DATA_DIR = join(process.cwd(), ".codex-manager");
const DB_PATH = process.env.CODEX_MANAGER_DB ?? join(DATA_DIR, "codex-manager.sqlite");

export class TaskStore {
  private db: DatabaseSync;

  constructor(dbPath = DB_PATH) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  listTasks(): Task[] {
    const rows = this.db.prepare("SELECT * FROM tasks ORDER BY updated_at DESC").all() as Row[];
    return rows.map((row) => this.hydrateTask(row));
  }

  recoverInterruptedRuns(): void {
    const tasks = this.listTasks().filter((task) => task.runPid !== null || task.status === "running");
    for (const task of tasks) {
      const nextStatus: TaskStatus = task.status === "running" ? "blocked" : task.status;
      this.updateTask(task.id, {
        status: nextStatus,
        runPid: null,
        currentStep: task.status === "running" ? "服务重启后需要人工确认运行结果" : task.currentStep
      });
      this.addEvent(task.id, "runner.stopped", "服务启动时清理了未受管理的旧运行状态", { previousPid: task.runPid });
    }
  }

  getTask(taskId: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Row | undefined;
    return row ? this.hydrateTask(row) : null;
  }

  createTask(input: CreateTaskInput & { sourceKind?: "local" | "github" | "gitlab"; sourceRef?: ExternalRef | null }): Task {
    const taskId = id("task");
    const createdAt = nowIso();
    const requestedHumanReviewRequired = input.humanReviewRequired ?? true;
    const status: TaskStatus = "draft";
    const sourceKind = input.sourceKind ?? "local";
    const currentStep = "等待启动";
    const workflow = loadWorkflow();
    const requestedProfile = input.workflowProfile ?? workflow.defaultProfile;
    const fallbackMode = input.orchestrationMode ?? "local_cockpit";
    const workflowProfile = workflow.profiles.find((profile) => profile.id === requestedProfile) ?? profileForTask(
      { workflowProfile: null, orchestrationMode: fallbackMode },
      workflow
    );
    const orchestrationMode = input.orchestrationMode ?? workflowProfile.orchestrationMode;
    const profileId = workflowProfile.id;
    const checklistTemplate = input.checklistTemplate ?? workflowProfile.checklist.join("\n");
    const profileReviewRequired = workflowProfile.humanReviewRequired;
    const humanReviewRequired = profileReviewRequired ?? requestedHumanReviewRequired;

    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `INSERT INTO tasks (
            id, title, description, status, priority, source_kind, source_ref_json, repo_url,
            workspace_path, branch_name, provider_account, orchestration_mode, workflow_profile,
            human_review_required, human_review_reason, current_step, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          taskId,
          input.title.trim(),
          input.description?.trim() ?? "",
          status,
          input.priority ?? 3,
          sourceKind,
          json(input.sourceRef ?? null),
          nullIfBlank(input.repoUrl),
          nullIfBlank(input.workspacePath),
          nullIfBlank(input.branchName),
          input.providerAccount ?? "auto",
          orchestrationMode,
          profileId,
          humanReviewRequired ? 1 : 0,
          input.humanReviewReason?.trim() || (humanReviewRequired ? "默认要求人工复核后再归档" : null),
          currentStep,
          createdAt,
          createdAt
        );

      checklistFromTemplate(checklistTemplate, orchestrationMode).forEach((label, position) => {
        this.insertChecklistItem(taskId, label, position, "pending", createdAt);
      });

      this.insertEvent(
        taskId,
        "task.created",
        "任务已创建",
        { sourceKind, humanReviewRequired, orchestrationMode, workflowProfile: profileId },
        createdAt
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return this.getTask(taskId)!;
  }

  updateTask(taskId: string, fields: Partial<Omit<Task, "id" | "checklist" | "events" | "createdAt" | "updatedAt">>): Task {
    const pairs: string[] = [];
    const values: SqlValue[] = [];
    const push = (column: string, value: SqlValue) => {
      pairs.push(`${column} = ?`);
      values.push(value);
    };

    if (fields.title !== undefined) push("title", fields.title);
    if (fields.description !== undefined) push("description", fields.description);
    if (fields.status !== undefined) push("status", fields.status);
    if (fields.priority !== undefined) push("priority", fields.priority);
    if (fields.sourceKind !== undefined) push("source_kind", fields.sourceKind);
    if (fields.sourceRef !== undefined) push("source_ref_json", json(fields.sourceRef ?? null));
    if (fields.repoUrl !== undefined) push("repo_url", fields.repoUrl ?? null);
    if (fields.workspacePath !== undefined) push("workspace_path", fields.workspacePath ?? null);
    if (fields.branchName !== undefined) push("branch_name", fields.branchName ?? null);
    if (fields.providerAccount !== undefined) push("provider_account", fields.providerAccount ?? null);
    if (fields.orchestrationMode !== undefined) push("orchestration_mode", fields.orchestrationMode);
    if (fields.workflowProfile !== undefined) push("workflow_profile", fields.workflowProfile ?? null);
    if (fields.humanReviewRequired !== undefined) push("human_review_required", fields.humanReviewRequired ? 1 : 0);
    if (fields.humanReviewReason !== undefined) push("human_review_reason", fields.humanReviewReason ?? null);
    if (fields.currentStep !== undefined) push("current_step", fields.currentStep ?? null);
    if (fields.currentChecklistItemId !== undefined) push("current_checklist_item_id", fields.currentChecklistItemId ?? null);
    if (fields.lastCodexSessionId !== undefined) push("last_codex_session_id", fields.lastCodexSessionId ?? null);
    if (fields.lastCodexThreadId !== undefined) push("last_codex_thread_id", fields.lastCodexThreadId ?? null);
    if (fields.lastCodexTurnId !== undefined) push("last_codex_turn_id", fields.lastCodexTurnId ?? null);
    if (fields.runPid !== undefined) push("run_pid", fields.runPid ?? null);
    if (fields.startedAt !== undefined) push("started_at", fields.startedAt ?? null);
    if (fields.finishedAt !== undefined) push("finished_at", fields.finishedAt ?? null);

    if (pairs.length === 0) return this.getTask(taskId)!;
    push("updated_at", nowIso());
    this.db.prepare(`UPDATE tasks SET ${pairs.join(", ")} WHERE id = ?`).run(...values, taskId);
    return this.getTask(taskId)!;
  }

  addEvent(taskId: string, kind: EventKind, message: string, payload?: unknown): TaskEvent {
    const createdAt = nowIso();
    return this.insertEvent(taskId, kind, message, payload, createdAt);
  }

  updateChecklistItem(itemId: string, status: ChecklistItemStatus, evidence?: string | null): ChecklistItem {
    const updatedAt = nowIso();
    this.db
      .prepare("UPDATE checklist_items SET status = ?, evidence = ?, updated_at = ? WHERE id = ?")
      .run(status, evidence ?? null, updatedAt, itemId);
    const row = this.db.prepare("SELECT * FROM checklist_items WHERE id = ?").get(itemId) as Row | undefined;
    if (!row) throw new Error(`Checklist item not found: ${itemId}`);
    const item = this.hydrateChecklist(row);
    this.addEvent(item.taskId, "checklist.updated", `${item.label}: ${status}`, { itemId, status, evidence });
    this.updateTask(item.taskId, {
      currentChecklistItemId: status === "running" ? item.id : undefined,
      currentStep: status === "running" ? item.label : undefined
    });
    return item;
  }

  setChecklistRunning(taskId: string, labelMatcher: (label: string) => boolean, evidence?: string): ChecklistItem | null {
    const items = this.listChecklist(taskId);
    const target = items.find((item) => labelMatcher(item.label));
    if (!target) return null;
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare("UPDATE checklist_items SET status = 'pending', updated_at = ? WHERE task_id = ? AND status = 'running'")
        .run(nowIso(), taskId);
      const item = this.updateChecklistItem(target.id, "running", evidence ?? target.evidence ?? null);
      this.db.exec("COMMIT");
      return item;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  markChecklistDone(taskId: string, labelMatcher: (label: string) => boolean, evidence?: string): ChecklistItem | null {
    const target = this.listChecklist(taskId).find((item) => labelMatcher(item.label));
    if (!target) return null;
    return this.updateChecklistItem(target.id, "done", evidence ?? target.evidence ?? null);
  }

  markChecklistSkipped(taskId: string, labelMatcher: (label: string) => boolean, evidence?: string): ChecklistItem | null {
    const target = this.listChecklist(taskId).find((item) => labelMatcher(item.label));
    if (!target) return null;
    return this.updateChecklistItem(target.id, "skipped", evidence ?? target.evidence ?? null);
  }

  markChecklistBlocked(taskId: string, labelMatcher: (label: string) => boolean, evidence?: string): ChecklistItem | null {
    const target = this.listChecklist(taskId).find((item) => labelMatcher(item.label));
    if (!target) return null;
    return this.updateChecklistItem(target.id, "blocked", evidence ?? target.evidence ?? null);
  }

  listEvents(taskId: string, limit = 200): TaskEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(taskId, limit) as Row[];
    return rows.map((row) => this.hydrateEvent(row)).reverse();
  }

  private listChecklist(taskId: string): ChecklistItem[] {
    const rows = this.db
      .prepare("SELECT * FROM checklist_items WHERE task_id = ? ORDER BY position ASC")
      .all(taskId) as Row[];
    return rows.map((row) => this.hydrateChecklist(row));
  }

  private hydrateTask(row: Row): Task {
    const taskId = String(row.id);
    return {
      id: taskId,
      title: String(row.title),
      description: String(row.description ?? ""),
      status: row.status as TaskStatus,
      priority: Number(row.priority ?? 3),
      sourceKind: row.source_kind as Task["sourceKind"],
      sourceRef: parseJson(row.source_ref_json) as ExternalRef | null,
      repoUrl: nullableString(row.repo_url),
      workspacePath: nullableString(row.workspace_path),
      branchName: nullableString(row.branch_name),
      providerAccount: (nullableString(row.provider_account) as Task["providerAccount"]) ?? "auto",
      orchestrationMode: normalizeOrchestrationMode(row.orchestration_mode),
      workflowProfile: nullableString(row.workflow_profile),
      humanReviewRequired: Number(row.human_review_required) === 1,
      humanReviewReason: nullableString(row.human_review_reason),
      currentStep: nullableString(row.current_step),
      currentChecklistItemId: nullableString(row.current_checklist_item_id),
      lastCodexSessionId: nullableString(row.last_codex_session_id),
      lastCodexThreadId: nullableString(row.last_codex_thread_id),
      lastCodexTurnId: nullableString(row.last_codex_turn_id),
      runPid: row.run_pid === null || row.run_pid === undefined ? null : Number(row.run_pid),
      startedAt: nullableString(row.started_at),
      finishedAt: nullableString(row.finished_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      checklist: this.listChecklist(taskId),
      events: this.listEvents(taskId)
    };
  }

  private hydrateChecklist(row: Row): ChecklistItem {
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      label: String(row.label),
      status: row.status as ChecklistItemStatus,
      position: Number(row.position),
      evidence: nullableString(row.evidence),
      updatedAt: String(row.updated_at)
    };
  }

  private hydrateEvent(row: Row): TaskEvent {
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      kind: row.kind as EventKind,
      message: String(row.message),
      payload: parseJson(row.payload_json),
      createdAt: String(row.created_at)
    };
  }

  private insertChecklistItem(taskId: string, label: string, position: number, status: ChecklistItemStatus, updatedAt: string): void {
    this.db
      .prepare("INSERT INTO checklist_items (id, task_id, label, status, position, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id("check"), taskId, label, status, position, updatedAt);
  }

  private insertEvent(taskId: string, kind: EventKind, message: string, payload: unknown, createdAt: string): TaskEvent {
    const eventId = id("event");
    this.db
      .prepare("INSERT INTO task_events (id, task_id, kind, message, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(eventId, taskId, kind, message, json(payload ?? null), createdAt);
    this.db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(createdAt, taskId);
    return { id: eventId, taskId, kind, message, payload, createdAt };
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 3,
        source_kind TEXT NOT NULL DEFAULT 'local',
        source_ref_json TEXT,
        repo_url TEXT,
        workspace_path TEXT,
        branch_name TEXT,
        provider_account TEXT,
        orchestration_mode TEXT NOT NULL DEFAULT 'local_cockpit',
        workflow_profile TEXT,
        human_review_required INTEGER NOT NULL DEFAULT 1,
        human_review_reason TEXT,
        current_step TEXT,
        current_checklist_item_id TEXT,
        last_codex_session_id TEXT,
        last_codex_thread_id TEXT,
        last_codex_turn_id TEXT,
        run_pid INTEGER,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS checklist_items (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        position INTEGER NOT NULL,
        evidence TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        message TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_events_task_created ON task_events(task_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_checklist_task_position ON checklist_items(task_id, position);
    `);
    this.ensureColumn("tasks", "orchestration_mode", "TEXT NOT NULL DEFAULT 'local_cockpit'");
    this.ensureColumn("tasks", "workflow_profile", "TEXT");
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (rows.some((row) => row.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > 0 ? text : null;
}

function nullIfBlank(value?: string): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeOrchestrationMode(value: unknown): OrchestrationMode {
  return value === "symphony_blackbox" ? "symphony_blackbox" : "local_cockpit";
}
