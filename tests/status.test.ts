import { describe, expect, it } from "vitest";
import { sortTasksByOperatorPriority } from "../src/shared/status";
import type { Task } from "../src/shared/types";

function task(id: string, status: Task["status"], updatedAt: string): Task {
  return {
    id,
    title: id,
    description: "",
    status,
    priority: 3,
    sourceKind: "local",
    humanReviewRequired: true,
    createdAt: updatedAt,
    updatedAt,
    checklist: [],
    events: []
  };
}

describe("sortTasksByOperatorPriority", () => {
  it("puts review and blocked tasks first", () => {
    const sorted = sortTasksByOperatorPriority([
      task("completed", "completed", "2026-01-01T00:00:00.000Z"),
      task("running", "running", "2026-01-02T00:00:00.000Z"),
      task("review", "needs_review", "2026-01-01T00:00:00.000Z"),
      task("blocked", "blocked", "2026-01-01T00:00:00.000Z")
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["review", "blocked", "running", "completed"]);
  });
});
