import type { ChecklistItem, Task, TaskStatus } from "./types";

export const STATUS_LABELS: Record<TaskStatus, string> = {
  draft: "草稿",
  queued: "排队中",
  running: "执行中",
  needs_review: "需要人工复核",
  needs_input: "需要补充信息",
  blocked: "已阻塞",
  syncing: "同步中",
  sync_drift: "同步漂移",
  failed: "失败",
  completed: "已完成",
  archived: "已归档"
};

export const STATUS_ORDER: Record<TaskStatus, number> = {
  needs_review: 0,
  blocked: 1,
  failed: 2,
  needs_input: 3,
  running: 4,
  sync_drift: 5,
  syncing: 6,
  queued: 7,
  draft: 8,
  completed: 9,
  archived: 10
};

export function sortTasksByOperatorPriority(tasks: Task[]): Task[] {
  return [...tasks].sort((left, right) => {
    const statusDelta = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
    if (statusDelta !== 0) return statusDelta;
    const priorityDelta = left.priority - right.priority;
    if (priorityDelta !== 0) return priorityDelta;
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

export function checklistProgress(items: ChecklistItem[]) {
  const total = items.length;
  const done = items.filter((item) => item.status === "done" || item.status === "skipped").length;
  const blocked = items.filter((item) => item.status === "blocked").length;
  const running = items.find((item) => item.status === "running") ?? null;
  return { total, done, blocked, running, label: `${done}/${total}` };
}

export function taskNeedsOperator(task: Task): boolean {
  return task.status === "needs_review" || task.status === "blocked" || task.status === "failed" || task.status === "needs_input";
}
