import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import YAML from "yaml";
import type { OrchestrationMode, StartTaskInput, Task, WorkflowSummary } from "../shared/types";
import { BLACKBOX_CHECKLIST, DEFAULT_CHECKLIST } from "./checklist";

export interface WorkflowProfile {
  id: string;
  label: string;
  orchestrationMode: OrchestrationMode;
  model: string | null;
  sandbox: StartTaskInput["sandbox"] | null;
  maxTurns: number | null;
  checklist: string[];
  promptTemplate: string | null;
  humanReviewRequired: boolean | null;
}

export interface LoadedWorkflow {
  path: string | null;
  status: "loaded" | "missing" | "invalid";
  message: string;
  config: Record<string, unknown>;
  promptTemplate: string;
  defaultProfile: string;
  profiles: WorkflowProfile[];
}

const DEFAULT_PROMPT = [
  "你正在处理 Codex Manager 任务 {{ issue.identifier }}。",
  "",
  "标题：{{ issue.title }}",
  "描述：{{ issue.description }}",
  "来源：{{ issue.url }}",
  "",
  "请在当前工作区完成任务，保留可复核证据，最终给出简洁交接。"
].join("\n");

const FALLBACK_PROFILES: WorkflowProfile[] = [
  {
    id: "local-cockpit",
    label: "本地可视化驾驶舱",
    orchestrationMode: "local_cockpit",
    model: null,
    sandbox: "workspace-write",
    maxTurns: 1,
    checklist: DEFAULT_CHECKLIST,
    promptTemplate: null,
    humanReviewRequired: true
  },
  {
    id: "symphony-blackbox",
    label: "Symphony 黑盒",
    orchestrationMode: "symphony_blackbox",
    model: null,
    sandbox: "workspace-write",
    maxTurns: 20,
    checklist: BLACKBOX_CHECKLIST,
    promptTemplate: null,
    humanReviewRequired: true
  }
];

export function loadWorkflow(explicitPath = process.env.CODEX_MANAGER_WORKFLOW): LoadedWorkflow {
  const path = resolveWorkflowPath(explicitPath);
  if (!path) {
    return {
      path: null,
      status: "missing",
      message: "未找到 WORKFLOW.symphony.md 或 WORKFLOW.md，使用内置默认工作流",
      config: {},
      promptTemplate: DEFAULT_PROMPT,
      defaultProfile: "local-cockpit",
      profiles: FALLBACK_PROFILES
    };
  }

  try {
    const parsed = parseWorkflowFile(readFileSync(path, "utf8"));
    const profiles = parseProfiles(parsed.config, parsed.promptTemplate);
    return {
      path,
      status: "loaded",
      message: "已加载仓库工作流契约",
      config: parsed.config,
      promptTemplate: parsed.promptTemplate || DEFAULT_PROMPT,
      defaultProfile: stringAt(parsed.config, ["codex_manager", "default_profile"]) ?? profiles[0].id,
      profiles
    };
  } catch (error) {
    return {
      path,
      status: "invalid",
      message: error instanceof Error ? error.message : String(error),
      config: {},
      promptTemplate: DEFAULT_PROMPT,
      defaultProfile: "local-cockpit",
      profiles: FALLBACK_PROFILES
    };
  }
}

export function workflowSummary(workflow = loadWorkflow()): WorkflowSummary {
  return {
    path: workflow.path,
    status: workflow.status,
    message: workflow.message,
    defaultProfile: workflow.defaultProfile,
    profiles: workflow.profiles.map((profile) => ({
      id: profile.id,
      label: profile.label,
      orchestrationMode: profile.orchestrationMode,
      model: profile.model,
      sandbox: profile.sandbox,
      maxTurns: profile.maxTurns
    }))
  };
}

export function profileForTask(task: Pick<Task, "workflowProfile" | "orchestrationMode">, workflow = loadWorkflow()): WorkflowProfile {
  const byId = task.workflowProfile ? workflow.profiles.find((profile) => profile.id === task.workflowProfile) : null;
  if (byId) return byId;
  const byMode = workflow.profiles.find((profile) => profile.orchestrationMode === task.orchestrationMode);
  return byMode ?? workflow.profiles[0] ?? FALLBACK_PROFILES[0];
}

export function renderWorkflowPrompt(task: Task, profile = profileForTask(task), workflow = loadWorkflow()): string {
  const template = profile.promptTemplate || workflow.promptTemplate || DEFAULT_PROMPT;
  const issueIdentifier = task.sourceRef?.number
    ? `GH-${task.sourceRef.number}`
    : task.sourceRef?.iid
      ? `GL-${task.sourceRef.iid}`
      : task.id;
  const values: Record<string, string> = {
    "issue.id": task.id,
    "issue.identifier": issueIdentifier,
    "issue.title": task.title,
    "issue.description": task.description || "",
    "issue.url": task.sourceRef?.url || "",
    "issue.state": task.sourceRef?.state || task.status,
    "issue.branch_name": task.branchName || "",
    "task.repo_url": task.repoUrl || "",
    "task.provider_account": task.providerAccount || "auto",
    "task.orchestration_mode": task.orchestrationMode,
    "workflow.profile": profile.id,
    "workflow.max_turns": String(profile.maxTurns ?? 1)
  };
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, key: string) => values[key.trim()] ?? "");
}

function resolveWorkflowPath(explicitPath?: string): string | null {
  const candidates = [
    explicitPath ? resolve(explicitPath) : null,
    join(process.cwd(), "WORKFLOW.symphony.md"),
    join(process.cwd(), "WORKFLOW.md")
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function parseWorkflowFile(text: string): { config: Record<string, unknown>; promptTemplate: string } {
  if (!text.startsWith("---")) return { config: {}, promptTemplate: text.trim() };
  const close = text.indexOf("\n---", 3);
  if (close === -1) throw new Error("WORKFLOW front matter 未闭合");
  const frontMatter = text.slice(3, close).trim();
  const body = text.slice(close + 4).trim();
  const parsed = frontMatter ? YAML.parse(frontMatter) : {};
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("WORKFLOW front matter 必须是 YAML object");
  }
  return { config: parsed as Record<string, unknown>, promptTemplate: body };
}

function parseProfiles(config: Record<string, unknown>, promptTemplate: string): WorkflowProfile[] {
  const rawProfiles = recordAt(config, ["codex_manager", "profiles"]);
  if (!rawProfiles) return FALLBACK_PROFILES.map((profile) => ({ ...profile, promptTemplate }));
  const parsed = Object.entries(rawProfiles)
    .map(([id, raw]) => normalizeProfile(id, raw, config, promptTemplate))
    .filter((profile): profile is WorkflowProfile => Boolean(profile));
  return parsed.length > 0 ? parsed : FALLBACK_PROFILES.map((profile) => ({ ...profile, promptTemplate }));
}

function normalizeProfile(id: string, raw: unknown, config: Record<string, unknown>, promptTemplate: string): WorkflowProfile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const mode = record.mode === "symphony_blackbox" ? "symphony_blackbox" : "local_cockpit";
  const checklist = stringArray(record.checklist) ?? (mode === "symphony_blackbox" ? BLACKBOX_CHECKLIST : DEFAULT_CHECKLIST);
  return {
    id,
    label: typeof record.label === "string" && record.label.trim() ? record.label.trim() : id,
    orchestrationMode: mode,
    model: stringValue(record.model) ?? stringAt(config, ["codex", "model"]),
    sandbox: sandboxValue(record.sandbox) ?? sandboxValue(valueAt(config, ["codex", "thread_sandbox"])),
    maxTurns: numberValue(record.max_turns) ?? numberValue(valueAt(config, ["agent", "max_turns"])),
    checklist,
    promptTemplate: stringValue(record.prompt_template) ?? promptTemplate,
    humanReviewRequired: booleanValue(record.human_review_required)
  };
}

function valueAt(record: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function recordAt(record: Record<string, unknown>, path: string[]): Record<string, unknown> | null {
  const value = valueAt(record, path);
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringAt(record: Record<string, unknown>, path: string[]): string | null {
  return stringValue(valueAt(record, path));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value > 0 ? Math.floor(value) : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function sandboxValue(value: unknown): StartTaskInput["sandbox"] | null {
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access" ? value : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return items.length > 0 ? items : null;
}
