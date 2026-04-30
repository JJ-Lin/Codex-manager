import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveTaskWorkspace } from "../src/server/runners/workspace";
import type { Task } from "../src/shared/types";

const oldWorkspaceRoot = process.env.CODEX_MANAGER_WORKSPACE_ROOT;

afterEach(() => {
  if (oldWorkspaceRoot === undefined) {
    delete process.env.CODEX_MANAGER_WORKSPACE_ROOT;
  } else {
    process.env.CODEX_MANAGER_WORKSPACE_ROOT = oldWorkspaceRoot;
  }
});

describe("resolveTaskWorkspace", () => {
  it("uses the configured ASCII managed workspace root for automatic workspaces", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-manager-ascii-"));
    process.env.CODEX_MANAGER_WORKSPACE_ROOT = root;
    const path = resolveTaskWorkspace(task({ title: "LLM wiki" }));
    expect(path.startsWith(root)).toBe(true);
  });

  it("keeps explicit user workspace paths", () => {
    const explicit = join(tmpdir(), "explicit-workspace");
    const path = resolveTaskWorkspace(task({ workspacePath: explicit }));
    expect(path).toBe(explicit);
  });
});

function task(overrides: Partial<Task>): Task {
  return {
    id: "task_1234567890abcdef",
    title: "Task",
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
    ...overrides
  };
}
