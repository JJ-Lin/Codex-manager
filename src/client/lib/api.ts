import type {
  CreateTaskInput,
  DoctorReport,
  ExternalIssueInput,
  OrchestrationMode,
  StartTaskInput,
  Task,
  TaskState,
  WorkflowSummary,
  WorkspaceDiff
} from "../../shared/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export const api = {
  state: () => request<TaskState>("/api/state"),
  workflow: () => request<WorkflowSummary>("/api/workflow"),
  doctor: () => request<DoctorReport>("/api/doctor"),
  createTask: (input: CreateTaskInput) => request<Task>("/api/tasks", { method: "POST", body: JSON.stringify(input) }),
  importIssue: (input: ExternalIssueInput) => request<Task>("/api/import", { method: "POST", body: JSON.stringify(input) }),
  startTask: (taskId: string, input: StartTaskInput = {}) =>
    request<Task>(`/api/tasks/${taskId}/start`, { method: "POST", body: JSON.stringify(input) }),
  stopTask: (taskId: string) => request<Task>(`/api/tasks/${taskId}/stop`, { method: "POST", body: JSON.stringify({}) }),
  setMode: (taskId: string, orchestrationMode: OrchestrationMode, workflowProfile?: string | null) =>
    request<Task>(`/api/tasks/${taskId}/mode`, { method: "POST", body: JSON.stringify({ orchestrationMode, workflowProfile }) }),
  diff: (taskId: string) => request<WorkspaceDiff>(`/api/tasks/${taskId}/diff`),
  review: (taskId: string, decision: "approve" | "changes_requested" | "block", note?: string) =>
    request<Task>(`/api/tasks/${taskId}/review`, { method: "POST", body: JSON.stringify({ decision, note }) })
};
