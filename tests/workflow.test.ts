import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadWorkflow, profileForTask, renderWorkflowPrompt } from "../src/server/workflow";
import type { Task } from "../src/shared/types";

const oldWorkflow = process.env.CODEX_MANAGER_WORKFLOW;

afterEach(() => {
  if (oldWorkflow === undefined) {
    delete process.env.CODEX_MANAGER_WORKFLOW;
  } else {
    process.env.CODEX_MANAGER_WORKFLOW = oldWorkflow;
  }
});

describe("workflow loader", () => {
  it("loads profile front matter and renders task placeholders", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-manager-workflow-"));
    const workflowPath = join(dir, "WORKFLOW.md");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      workflowPath,
      [
        "---",
        "codex:",
        "  model: gpt-5.5",
        "codex_manager:",
        "  default_profile: symphony-blackbox",
        "  profiles:",
        "    symphony-blackbox:",
        "      label: Symphony",
        "      mode: symphony_blackbox",
        "      checklist:",
        "        - 领取任务",
        "---",
        "Task {{ issue.identifier }}: {{ issue.title }}"
      ].join("\n")
    );
    process.env.CODEX_MANAGER_WORKFLOW = workflowPath;

    const workflow = loadWorkflow();
    const task = makeTask({ workflowProfile: "symphony-blackbox", orchestrationMode: "symphony_blackbox" });
    const profile = profileForTask(task, workflow);

    expect(workflow.status).toBe("loaded");
    expect(workflow.defaultProfile).toBe("symphony-blackbox");
    expect(profile.orchestrationMode).toBe("symphony_blackbox");
    expect(renderWorkflowPrompt(task, profile, workflow)).toBe("Task task-1: Test task");
  });
});

function makeTask(partial: Partial<Task>): Task {
  return {
    id: "task-1",
    title: "Test task",
    description: "",
    status: "draft",
    priority: 3,
    sourceKind: "local",
    orchestrationMode: "local_cockpit",
    humanReviewRequired: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    checklist: [],
    events: [],
    ...partial
  };
}
