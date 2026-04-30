import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checklistProgress } from "../src/shared/status";
import { approveAndArchiveTask, reconcileCompletedTaskChecklists } from "../src/server/taskCompletion";
import { TaskStore } from "../src/server/store";

describe("task completion checklist handling", () => {
  it("marks terminal checklist items when a local task is approved and archived", () => {
    const store = new TaskStore(join(mkdtempSync(join(tmpdir(), "codex-manager-review-")), "test.sqlite"));
    const task = store.createTask({ title: "Archive local task", humanReviewRequired: true });
    store.markChecklistDone(task.id, (label) => label.includes("仓库"), "workspace ready");
    store.markChecklistDone(task.id, (label) => label.includes("启动"), "turn started");
    store.markChecklistDone(task.id, (label) => label.includes("跟踪"), "events captured");
    store.markChecklistDone(task.id, (label) => label.includes("整理"), "evidence ready");
    const reviewTask = store.updateTask(task.id, { status: "needs_review", currentStep: "等待人工复核" });

    const archived = approveAndArchiveTask(store, reviewTask, "可以归档");
    const statuses = Object.fromEntries(archived.checklist.map((item) => [item.label, item.status]));

    expect(archived.status).toBe("completed");
    expect(statuses["解析任务需求"]).toBe("done");
    expect(statuses["等待人工复核"]).toBe("done");
    expect(statuses["同步外部任务"]).toBe("skipped");
    expect(statuses["归档完成"]).toBe("done");
    expect(checklistProgress(archived.checklist).label).toBe("8/8");
    expect(archived.checklist.every((item) => item.status === "done" || item.status === "skipped")).toBe(true);
  });

  it("repairs completed tasks created before terminal checklist reconciliation existed", () => {
    const store = new TaskStore(join(mkdtempSync(join(tmpdir(), "codex-manager-reconcile-")), "test.sqlite"));
    const task = store.createTask({ title: "Old completed task", humanReviewRequired: true });
    store.updateTask(task.id, { status: "completed", currentStep: "人工复核通过，任务完成" });

    reconcileCompletedTaskChecklists(store);

    const reconciled = store.getTask(task.id)!;
    expect(reconciled.checklist.find((item) => item.label === "归档完成")?.status).toBe("done");
    expect(reconciled.checklist.find((item) => item.label === "同步外部任务")?.status).toBe("skipped");
    expect(reconciled.checklist.every((item) => item.status === "done" || item.status === "skipped")).toBe(true);
  });
});
