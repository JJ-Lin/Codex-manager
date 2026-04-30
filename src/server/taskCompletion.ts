import type { Task } from "../shared/types";
import { TaskStore } from "./store";
import { nowIso } from "./time";

export function approveAndArchiveTask(store: TaskStore, task: Task, note?: string): Task {
  markTerminalChecklist(store, task, {
    reviewEvidence: note || "人工复核已通过",
    archiveEvidence: "人工复核通过后归档"
  });
  store.updateTask(task.id, { status: "completed", currentStep: "人工复核通过，任务完成", finishedAt: nowIso() });
  store.addEvent(task.id, "review.approved", note || "人工复核已通过");
  return store.getTask(task.id)!;
}

export function completeWithoutHumanReview(store: TaskStore, task: Task): Task {
  markTerminalChecklist(store, task, {
    reviewEvidence: "任务配置为无需人工复核",
    archiveEvidence: "自动归档完成"
  });
  store.updateTask(task.id, { status: "completed", currentStep: "执行完成，任务已归档", finishedAt: nowIso() });
  return store.getTask(task.id)!;
}

export function reconcileCompletedTaskChecklists(store: TaskStore): void {
  for (const task of store.listTasks()) {
    if (task.status !== "completed") continue;
    markTerminalChecklist(store, task, {
      reviewEvidence: task.humanReviewRequired ? "人工复核已通过" : "任务配置为无需人工复核",
      archiveEvidence: "已从完成状态恢复归档标记"
    });
  }
}

function markTerminalChecklist(
  store: TaskStore,
  task: Task,
  evidence: { reviewEvidence: string; archiveEvidence: string }
): void {
  markDoneIfNeeded(store, task, (label) => label.includes("解析") || label.includes("需求"), "任务已解析并进入执行流程");
  markDoneIfNeeded(store, task, (label) => label.includes("人工复核"), evidence.reviewEvidence);
  markExternalSyncOutcome(store, task);
  markDoneIfNeeded(store, task, (label) => label.includes("归档"), evidence.archiveEvidence);
  markResidualChecklistDone(store, task.id);
}

function markExternalSyncOutcome(store: TaskStore, task: Task): void {
  if (!hasChecklistItem(task, (label) => label.includes("同步") && label.includes("外部"))) return;
  if (task.sourceKind === "local" || !task.sourceRef?.url) {
    markSkippedIfNeeded(store, task, (label) => label.includes("同步") && label.includes("外部"), "本地任务没有外部来源，无需同步");
    return;
  }
  markSkippedIfNeeded(store, task, (label) => label.includes("同步") && label.includes("外部"), "外部写回尚未启用，本地先归档并保留来源链接");
  store.addEvent(task.id, "task.note", "外部写回尚未启用，本地归档已完成", task.sourceRef);
}

function markDoneIfNeeded(store: TaskStore, task: Task, matcher: (label: string) => boolean, evidence: string): void {
  const item = task.checklist.find((candidate) => matcher(candidate.label));
  if (!item || item.status === "done") return;
  store.markChecklistDone(task.id, matcher, evidence);
}

function markSkippedIfNeeded(store: TaskStore, task: Task, matcher: (label: string) => boolean, evidence: string): void {
  const item = task.checklist.find((candidate) => matcher(candidate.label));
  if (!item || item.status === "skipped" || item.status === "done") return;
  store.markChecklistSkipped(task.id, matcher, evidence);
}

function hasChecklistItem(task: Task, matcher: (label: string) => boolean): boolean {
  return task.checklist.some((candidate) => matcher(candidate.label));
}

function markResidualChecklistDone(store: TaskStore, taskId: string): void {
  const latest = store.getTask(taskId);
  if (!latest) return;
  for (const item of latest.checklist) {
    if (item.status !== "pending" && item.status !== "running") continue;
    store.updateChecklistItem(item.id, "done", item.evidence ?? "任务归档时确认该项不再阻塞");
  }
}
