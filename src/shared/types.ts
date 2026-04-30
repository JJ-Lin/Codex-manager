export type TaskStatus =
  | "draft"
  | "queued"
  | "running"
  | "needs_review"
  | "needs_input"
  | "blocked"
  | "syncing"
  | "sync_drift"
  | "failed"
  | "completed"
  | "archived";

export type TaskSourceKind = "local" | "github" | "gitlab";

export type Provider = "github" | "gitlab";

export type ChecklistItemStatus = "pending" | "running" | "done" | "skipped" | "blocked";

export type EventKind =
  | "task.created"
  | "task.updated"
  | "task.note"
  | "checklist.updated"
  | "runner.started"
  | "runner.output"
  | "runner.codex_event"
  | "runner.stderr"
  | "runner.finished"
  | "runner.failed"
  | "runner.stopped"
  | "review.requested"
  | "review.approved"
  | "review.changes_requested"
  | "sync.imported"
  | "sync.started"
  | "sync.completed"
  | "sync.failed"
  | "identity.detected";

export interface ExternalRef {
  provider: Provider;
  host: string;
  owner?: string;
  repo?: string;
  projectPath?: string;
  number?: number;
  iid?: number;
  url?: string;
  title?: string;
  state?: string;
  updatedAt?: string;
  labels?: string[];
}

export interface GitIdentity {
  provider: Provider;
  host: string;
  name: string | null;
  email: string | null;
  source: string;
  usableForCommits: boolean;
  apiAvailable: boolean;
  apiHint?: string;
}

export interface ChecklistItem {
  id: string;
  taskId: string;
  label: string;
  status: ChecklistItemStatus;
  position: number;
  evidence?: string | null;
  updatedAt: string;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  kind: EventKind;
  message: string;
  payload?: unknown;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  sourceKind: TaskSourceKind;
  sourceRef?: ExternalRef | null;
  repoUrl?: string | null;
  workspacePath?: string | null;
  branchName?: string | null;
  providerAccount?: Provider | "auto" | null;
  humanReviewRequired: boolean;
  humanReviewReason?: string | null;
  currentStep?: string | null;
  currentChecklistItemId?: string | null;
  lastCodexSessionId?: string | null;
  lastCodexThreadId?: string | null;
  lastCodexTurnId?: string | null;
  runPid?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  checklist: ChecklistItem[];
  events: TaskEvent[];
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  repoUrl?: string;
  workspacePath?: string;
  branchName?: string;
  providerAccount?: Provider | "auto";
  humanReviewRequired?: boolean;
  humanReviewReason?: string;
  priority?: number;
  checklistTemplate?: string;
}

export interface TaskState {
  tasks: Task[];
  metrics: {
    total: number;
    running: number;
    needsReview: number;
    blocked: number;
    failed: number;
    syncDrift: number;
    completed: number;
  };
  identities: GitIdentity[];
  runner: {
    activeTaskIds: string[];
    codexAvailable: boolean;
    codexVersion: string | null;
    defaultModel: string;
  };
  generatedAt: string;
}

export interface StartTaskInput {
  prompt?: string;
  model?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
}

export interface ExternalIssueInput {
  url: string;
  provider?: Provider;
}
