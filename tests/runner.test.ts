import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexRunner } from "../src/server/runners/codexRunner";
import { TaskStore } from "../src/server/store";

const oldCodexBin = process.env.CODEX_MANAGER_CODEX_BIN;

afterEach(() => {
  if (oldCodexBin === undefined) {
    delete process.env.CODEX_MANAGER_CODEX_BIN;
  } else {
    process.env.CODEX_MANAGER_CODEX_BIN = oldCodexBin;
  }
});

describe("CodexRunner", () => {
  it("persists codex JSON events and moves successful runs to review", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-manager-runner-"));
    const fakeCodex = join(dir, "codex");
    writeFileSync(
      fakeCodex,
      [
        "#!/usr/bin/env bash",
        "echo '{\"type\":\"session.started\",\"thread_id\":\"thread-1\",\"turn_id\":\"turn-1\"}'",
        "echo '{\"type\":\"tool_call.completed\",\"message\":\"ran tests\"}'",
        "exit 0"
      ].join("\n")
    );
    chmodSync(fakeCodex, 0o755);
    process.env.CODEX_MANAGER_CODEX_BIN = fakeCodex;

    const store = new TaskStore(join(dir, "test.sqlite"));
    const task = store.createTask({ title: "Runner test", humanReviewRequired: true });
    const runner = new CodexRunner(store);

    await runner.start(task.id);
    await waitFor(() => store.getTask(task.id)?.status === "needs_review");

    const finished = store.getTask(task.id)!;
    expect(finished.lastCodexSessionId).toBe("thread-1-turn-1");
    expect(finished.events.some((event) => event.kind === "runner.codex_event")).toBe(true);
    expect(finished.events.some((event) => event.kind === "review.requested")).toBe(true);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for predicate");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
