import { existsSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { z } from "zod";
import { sortTasksByOperatorPriority } from "../shared/status";
import type { TaskState } from "../shared/types";
import { importExternalIssue } from "./integrations/taskSources";
import { detectGitIdentities } from "./integrations/gitIdentity";
import { CodexRunner } from "./runners/codexRunner";
import { TaskStore } from "./store";
import { nowIso } from "./time";

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  repoUrl: z.string().optional(),
  workspacePath: z.string().optional(),
  branchName: z.string().optional(),
  providerAccount: z.enum(["github", "gitlab", "auto"]).optional(),
  humanReviewRequired: z.boolean().optional(),
  humanReviewReason: z.string().optional(),
  priority: z.number().int().min(1).max(5).optional(),
  checklistTemplate: z.string().optional()
});

const startTaskSchema = z.object({
  prompt: z.string().optional(),
  model: z.string().optional(),
  sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional()
});

const importIssueSchema = z.object({
  url: z.string().url(),
  provider: z.enum(["github", "gitlab"]).optional()
});

const checklistSchema = z.object({
  status: z.enum(["pending", "running", "done", "skipped", "blocked"]),
  evidence: z.string().nullable().optional()
});

const reviewSchema = z.object({
  decision: z.enum(["approve", "changes_requested", "block"]),
  note: z.string().optional()
});

export function createApp() {
  const app = express();
  const store = new TaskStore();
  const runner = new CodexRunner(store);

  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, generatedAt: nowIso() });
  });

  app.get("/api/state", async (_req, res, next) => {
    try {
      const tasks = sortTasksByOperatorPriority(store.listTasks());
      const identities = await detectGitIdentities();
      const state: TaskState = {
        tasks,
        metrics: {
          total: tasks.length,
          running: tasks.filter((task) => task.status === "running").length,
          needsReview: tasks.filter((task) => task.status === "needs_review").length,
          blocked: tasks.filter((task) => task.status === "blocked").length,
          failed: tasks.filter((task) => task.status === "failed").length,
          syncDrift: tasks.filter((task) => task.status === "sync_drift").length,
          completed: tasks.filter((task) => task.status === "completed").length
        },
        identities,
        runner: {
          activeTaskIds: runner.activeTaskIds(),
          codexAvailable: await commandAvailable("codex"),
          codexVersion: await commandVersion("codex", ["--version"])
        },
        generatedAt: nowIso()
      };
      res.json(state);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/tasks/:taskId", (req, res) => {
    const task = store.getTask(req.params.taskId);
    if (!task) return res.status(404).json({ error: "任务不存在" });
    res.json(task);
  });

  app.post("/api/tasks", (req, res, next) => {
    try {
      const input = createTaskSchema.parse(req.body);
      res.status(201).json(store.createTask(input));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/import", async (req, res, next) => {
    try {
      const input = importIssueSchema.parse(req.body);
      const taskInput = await importExternalIssue(input);
      const task = store.createTask(taskInput);
      store.addEvent(task.id, "sync.imported", "已从外部 issue 创建本地任务", taskInput.sourceRef);
      res.status(201).json(store.getTask(task.id));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/tasks/:taskId/start", async (req, res, next) => {
    try {
      const input = startTaskSchema.parse(req.body ?? {});
      res.json(await runner.start(req.params.taskId, input));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/tasks/:taskId/stop", (req, res, next) => {
    try {
      res.json(runner.stop(req.params.taskId));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/checklist/:itemId", (req, res, next) => {
    try {
      const input = checklistSchema.parse(req.body);
      res.json(store.updateChecklistItem(req.params.itemId, input.status, input.evidence));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/tasks/:taskId/review", (req, res, next) => {
    try {
      const input = reviewSchema.parse(req.body);
      const task = store.getTask(req.params.taskId);
      if (!task) return res.status(404).json({ error: "任务不存在" });
      if (input.decision === "approve") {
        store.markChecklistDone(task.id, (label) => label.includes("人工复核"), input.note || "人工复核已通过");
        store.updateTask(task.id, { status: "completed", currentStep: "人工复核通过，任务完成", finishedAt: nowIso() });
        store.addEvent(task.id, "review.approved", input.note || "人工复核已通过");
      } else if (input.decision === "changes_requested") {
        if (runner.isRunning(task.id)) {
          runner.stop(task.id);
        }
        store.updateTask(task.id, { status: "needs_input", currentStep: "复核要求修改" });
        store.addEvent(task.id, "review.changes_requested", input.note || "复核要求修改");
      } else {
        if (runner.isRunning(task.id)) {
          runner.stop(task.id);
        }
        store.updateTask(task.id, { status: "blocked", currentStep: "人工标记阻塞" });
        store.addEvent(task.id, "task.note", input.note || "人工标记阻塞");
      }
      res.json(store.getTask(task.id));
    } catch (error) {
      next(error);
    }
  });

  const clientDist = join(process.cwd(), "dist", "client");
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/.*/, (_req, res) => res.sendFile(join(clientDist, "index.html")));
  }

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "请求参数无效", issues: error.issues });
    }
    const message = error instanceof Error ? error.message : "未知错误";
    res.status(500).json({ error: message });
  });

  return app;
}

async function commandAvailable(command: string): Promise<boolean> {
  return (await commandVersion(command, ["--version"])) !== null;
}

async function commandVersion(command: string, args: string[]): Promise<string | null> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    const { stdout } = await promisify(execFile)(command, args, { timeout: 3000 });
    return stdout.trim().split(/\r?\n/)[0] ?? null;
  } catch {
    return null;
  }
}
