import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexRunner } from "../src/server/runners/codexRunner";
import { TaskStore } from "../src/server/store";

const oldCodexBin = process.env.CODEX_MANAGER_CODEX_BIN;
const oldProtocolFile = process.env.CODEX_MANAGER_TEST_PROTOCOL_FILE;

afterEach(() => {
  if (oldCodexBin === undefined) {
    delete process.env.CODEX_MANAGER_CODEX_BIN;
  } else {
    process.env.CODEX_MANAGER_CODEX_BIN = oldCodexBin;
  }
  if (oldProtocolFile === undefined) {
    delete process.env.CODEX_MANAGER_TEST_PROTOCOL_FILE;
  } else {
    process.env.CODEX_MANAGER_TEST_PROTOCOL_FILE = oldProtocolFile;
  }
});

describe("CodexRunner", () => {
  it("runs a Codex app-server turn, persists events, and moves successful runs to review", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-manager-runner-"));
    const fakeCodex = writeFakeCodexAppServer(dir);
    const protocolFile = join(dir, "protocol.jsonl");
    process.env.CODEX_MANAGER_CODEX_BIN = fakeCodex;
    process.env.CODEX_MANAGER_TEST_PROTOCOL_FILE = protocolFile;

    const store = new TaskStore(join(dir, "test.sqlite"));
    const task = store.createTask({ title: "Runner test", humanReviewRequired: true });
    const runner = new CodexRunner(store);

    await runner.start(task.id);
    await waitFor(() => store.getTask(task.id)?.status === "needs_review");

    const finished = store.getTask(task.id)!;
    const protocol = readFileSync(protocolFile, "utf8");
    expect(finished.lastCodexSessionId).toBe("thread-1-turn-1");
    expect(finished.events.some((event) => event.message.includes("thread/start: thread-1"))).toBe(true);
    expect(finished.events.some((event) => event.message.includes("server request: item/commandExecution/requestApproval"))).toBe(true);
    expect(finished.events.some((event) => event.kind === "review.requested")).toBe(true);
    expect(protocol).toContain('"method":"thread/start"');
    expect(protocol).toContain('"method":"turn/start"');
    expect(protocol).toContain('"model":"gpt-5.5"');
    expect(protocol).toContain('"decision":"acceptForSession"');
  });

  it("resumes the existing Codex thread when continuing after review feedback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-manager-runner-"));
    const fakeCodex = writeFakeCodexAppServer(dir);
    const protocolFile = join(dir, "protocol.jsonl");
    process.env.CODEX_MANAGER_CODEX_BIN = fakeCodex;
    process.env.CODEX_MANAGER_TEST_PROTOCOL_FILE = protocolFile;

    const store = new TaskStore(join(dir, "test.sqlite"));
    const task = store.createTask({ title: "Review continuation", humanReviewRequired: true });
    store.updateTask(task.id, {
      status: "needs_input",
      lastCodexThreadId: "thread-existing",
      currentStep: "复核要求修改"
    });
    store.addEvent(task.id, "review.changes_requested", "请补充复核意见里的缺口");
    const runner = new CodexRunner(store);

    await runner.start(task.id);
    await waitFor(() => store.getTask(task.id)?.status === "needs_review");

    const finished = store.getTask(task.id)!;
    const protocol = readFileSync(protocolFile, "utf8");
    expect(finished.lastCodexThreadId).toBe("thread-existing");
    expect(finished.events.some((event) => event.message.includes("thread/resume: thread-existing"))).toBe(true);
    expect(protocol).toContain('"method":"thread/resume"');
    expect(protocol).not.toContain('"method":"thread/start"');
    expect(protocol).toContain("Continuation guidance");
    expect(protocol).toContain("请补充复核意见里的缺口");
  });
});

function writeFakeCodexAppServer(dir: string): string {
  const fakeCodex = join(dir, "codex");
  writeFileSync(
    fakeCodex,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const readline = require('node:readline');",
      "const protocolFile = process.env.CODEX_MANAGER_TEST_PROTOCOL_FILE;",
      "const append = (line) => protocolFile && fs.appendFileSync(protocolFile, line + '\\n');",
      "const out = (message) => process.stdout.write(JSON.stringify(message) + '\\n');",
      "const thread = { id: 'thread-1', path: '/tmp/thread.jsonl', status: { type: 'idle' }, turns: [] };",
      "const turn = { id: 'turn-1', status: 'completed', items: [], error: null, startedAt: 1, completedAt: 2, durationMs: 1000 };",
      "let currentThreadId = 'thread-1';",
      "const rl = readline.createInterface({ input: process.stdin });",
      "rl.on('line', (line) => {",
      "  append(line);",
      "  const message = JSON.parse(line);",
      "  if (message.method === 'initialize') {",
      "    out({ id: message.id, result: { userAgent: 'fake-codex', codexHome: '/tmp/codex', platformFamily: 'unix', platformOs: 'macos' } });",
      "  } else if (message.method === 'thread/start') {",
      "    currentThreadId = 'thread-1';",
      "    out({ id: message.id, result: { thread: { ...thread, id: currentThreadId }, model: message.params.model, modelProvider: 'openai', cwd: process.cwd(), instructionSources: [], approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: { type: 'workspaceWrite' }, reasoningEffort: null } });",
      "    out({ method: 'thread/started', params: { thread: { ...thread, id: currentThreadId } } });",
      "  } else if (message.method === 'thread/resume') {",
      "    currentThreadId = message.params.threadId;",
      "    out({ id: message.id, result: { thread: { ...thread, id: currentThreadId }, model: message.params.model, modelProvider: 'openai', cwd: process.cwd(), instructionSources: [], approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: { type: 'workspaceWrite' }, reasoningEffort: null } });",
      "    out({ method: 'thread/started', params: { thread: { ...thread, id: currentThreadId } } });",
      "  } else if (message.method === 'turn/start') {",
      "    out({ id: message.id, result: { turn } });",
      "    out({ method: 'turn/started', params: { threadId: currentThreadId, turn } });",
      "    out({ id: 99, method: 'item/commandExecution/requestApproval', params: { threadId: currentThreadId, turnId: 'turn-1', itemId: 'item-1', command: 'npm test' } });",
      "  } else if (message.id === 99) {",
      "    out({ method: 'item/started', params: { threadId: currentThreadId, turnId: 'turn-1', item: { type: 'commandExecution', id: 'item-1', command: 'npm test', cwd: process.cwd(), status: 'running' } } });",
      "    out({ method: 'item/commandExecution/outputDelta', params: { threadId: currentThreadId, turnId: 'turn-1', itemId: 'item-1', delta: 'tests passed' } });",
      "    out({ method: 'item/completed', params: { threadId: currentThreadId, turnId: 'turn-1', item: { type: 'commandExecution', id: 'item-1', command: 'npm test', cwd: process.cwd(), status: 'completed', exitCode: 0 } } });",
      "    out({ method: 'turn/completed', params: { threadId: currentThreadId, turn } });",
      "    setTimeout(() => process.exit(0), 20);",
      "  }",
      "});"
    ].join("\n")
  );
  chmodSync(fakeCodex, 0o755);
  return fakeCodex;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for predicate");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
