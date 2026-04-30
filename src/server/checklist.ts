import type { ChecklistItem, ChecklistItemStatus, OrchestrationMode, TaskStatus } from "../shared/types";

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

export const BLACKBOX_CHECKLIST = [
  "领取任务",
  "准备隔离工作区",
  "启动 Symphony agent",
  "等待 agent 执行",
  "等待 tracker / Human Review",
  "同步 tracker 结果",
  "释放运行锁并归档"
];

export function defaultChecklistForMode(mode: OrchestrationMode = "local_cockpit"): string[] {
  return mode === "symphony_blackbox" ? BLACKBOX_CHECKLIST : DEFAULT_CHECKLIST;
}

export function checklistFromTemplate(template?: string, mode: OrchestrationMode = "local_cockpit"): string[] {
  const raw = template?.trim();
  if (!raw) return defaultChecklistForMode(mode);
  const items = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\[[ xX]\]\s+/, "").trim())
    .filter(Boolean);
  return items.length > 0 ? items : defaultChecklistForMode(mode);
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
