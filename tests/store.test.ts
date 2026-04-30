import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TaskStore } from "../src/server/store";

describe("TaskStore workflow fields", () => {
  it("persists the Symphony blackbox profile and lifecycle checklist", () => {
    const store = new TaskStore(join(mkdtempSync(join(tmpdir(), "codex-manager-store-")), "test.sqlite"));
    const task = store.createTask({
      title: "Blackbox task",
      orchestrationMode: "symphony_blackbox",
      workflowProfile: "symphony-blackbox"
    });

    expect(task.orchestrationMode).toBe("symphony_blackbox");
    expect(task.workflowProfile).toBe("symphony-blackbox");
    expect(task.checklist.map((item) => item.label)).toContain("等待 tracker / Human Review");
  });
});
