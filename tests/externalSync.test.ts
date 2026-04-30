import { describe, expect, it } from "vitest";
import { buildExternalSyncCommand } from "../src/server/integrations/externalSync";
import type { Task } from "../src/shared/types";

describe("buildExternalSyncCommand", () => {
  it("builds a non-destructive GitHub issue comment command", () => {
    const command = buildExternalSyncCommand(
      makeTask({
        sourceKind: "github",
        sourceRef: { provider: "github", host: "github.com", owner: "JJ-Lin", repo: "Codex-manager", number: 7 }
      }),
      "ok"
    );

    expect(command?.command).toBe("gh");
    expect(command?.args.slice(0, 3)).toEqual(["issue", "comment", "7"]);
    expect(command?.args).not.toContain("close");
  });

  it("builds a GitLab issue note command", () => {
    const command = buildExternalSyncCommand(
      makeTask({
        sourceKind: "gitlab",
        sourceRef: { provider: "gitlab", host: "git.garena.com", projectPath: "a/b", iid: 9 }
      })
    );

    expect(command?.command).toBe("glab");
    expect(command?.args.slice(0, 3)).toEqual(["issue", "note", "9"]);
    expect(command?.args).toContain("git.garena.com/a/b");
  });
});

function makeTask(partial: Partial<Task>): Task {
  return {
    id: "task-1",
    title: "External sync",
    description: "",
    status: "completed",
    priority: 3,
    sourceKind: "local",
    sourceRef: null,
    orchestrationMode: "local_cockpit",
    humanReviewRequired: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    checklist: [],
    events: [],
    ...partial
  };
}
