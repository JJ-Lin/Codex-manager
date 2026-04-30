import type { ChecklistItem, ChecklistItemStatus, TaskStatus } from "../shared/types";

export const DEFAULT_CHECKLIST = [
  "解析任务需求",
  "确认仓库、账号和工作区",
  "启动 Codex 执行",
  "跟踪执行事件和日志",
  "整理结果证据",
  "等待人工复核",
  "同步外部任务",
  "归档完成"
];

export function checklistFromTemplate(template?: string): string[] {
  const raw = template?.trim();
  if (!raw) return DEFAULT_CHECKLIST;
  const items = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\[[ xX]\]\s+/, "").trim())
    .filter(Boolean);
  return items.length > 0 ? items : DEFAULT_CHECKLIST;
}

export function inferStatusFromChecklist(items: ChecklistItem[], humanReviewRequired: boolean): TaskStatus {
  if (items.some((item) => item.status === "blocked")) return "blocked";
  if (humanReviewRequired && items.some((item) => item.label.includes("人工复核") && item.status !== "done")) {
    return "needs_review";
  }
  if (items.length > 0 && items.every((item) => item.status === "done" || item.status === "skipped")) {
    return "completed";
  }
  return "running";
}

export function nextChecklistStatus(current: ChecklistItemStatus): ChecklistItemStatus {
  if (current === "done") return "pending";
  return "done";
}
