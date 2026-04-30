import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AlertTriangle, Bot, GitPullRequest, LayoutDashboard, Plus, RefreshCw, Search, ShieldCheck } from "lucide-react";
import type { CreateTaskInput, Task, TaskState } from "../shared/types";
import { sortTasksByOperatorPriority } from "../shared/status";
import { api } from "./lib/api";
import { NewTaskModal } from "./components/NewTaskModal";
import { TaskDetail } from "./components/TaskDetail";
import { TaskList } from "./components/TaskList";
import "./styles/app.css";

type Filter = "all" | "running" | "needs_review" | "blocked" | "failed" | "sync_drift" | "completed";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "needs_review", label: "需要人工复核" },
  { id: "running", label: "进行中" },
  { id: "blocked", label: "已阻塞" },
  { id: "failed", label: "失败" },
  { id: "sync_drift", label: "同步漂移" },
  { id: "completed", label: "已完成" }
];

export default function App() {
  const [state, setState] = useState<TaskState | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(keepSelection = true) {
    const next = await api.state();
    setState(next);
    if (!keepSelection || !selectedTaskId || !next.tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(next.tasks[0]?.id);
    }
  }

  useEffect(() => {
    refresh(false).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
    const timer = window.setInterval(() => refresh(true).catch(() => undefined), 2500);
    return () => window.clearInterval(timer);
  }, []);

  const tasks = useMemo(() => {
    const all = sortTasksByOperatorPriority(state?.tasks ?? []);
    return all.filter((task) => {
      const filterMatch = filter === "all" || task.status === filter;
      const queryText = `${task.title} ${task.description} ${task.currentStep ?? ""} ${task.repoUrl ?? ""}`.toLowerCase();
      return filterMatch && queryText.includes(query.toLowerCase());
    });
  }, [filter, query, state?.tasks]);

  const selectedTask = state?.tasks.find((task) => task.id === selectedTaskId) ?? tasks[0];

  async function runAction(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function createTask(input: CreateTaskInput) {
    await runAction(async () => {
      const task = await api.createTask(input);
      setSelectedTaskId(task.id);
      setModalOpen(false);
    });
  }

  async function importIssue(url: string) {
    await runAction(async () => {
      const task = await api.importIssue({ url });
      setSelectedTaskId(task.id);
      setModalOpen(false);
    });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <LayoutDashboard size={22} />
          <div>
            <h1>Codex Manager</h1>
            <span>本地 Symphony 控制台</span>
          </div>
        </div>
        <div className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务、仓库、步骤" />
        </div>
        <div className="identity-chips">
          {state?.identities.map((identity) => (
            <span className={`identity-chip ${identity.usableForCommits ? "ok" : "warn"}`} key={`${identity.provider}-${identity.host}`}>
              {identity.provider}
              <strong>{identity.name ?? "未配置"}</strong>
            </span>
          ))}
        </div>
        <button className="secondary" type="button" onClick={() => refresh(true)} disabled={busy}>
          <RefreshCw size={16} />
          刷新
        </button>
        <button className="primary" type="button" onClick={() => setModalOpen(true)}>
          <Plus size={16} />
          新建任务
        </button>
      </header>

      <main className="main-grid">
        <nav className="sidebar">
          <div className="summary-card">
            <span>待处理优先</span>
            <strong>{(state?.metrics.needsReview ?? 0) + (state?.metrics.blocked ?? 0) + (state?.metrics.failed ?? 0)}</strong>
          </div>
          <div className="filter-list">
            {FILTERS.map((item) => (
              <button className={filter === item.id ? "active" : ""} type="button" key={item.id} onClick={() => setFilter(item.id)}>
                {item.label}
                <span>{countForFilter(state, item.id)}</span>
              </button>
            ))}
          </div>
          <div className="runtime-card">
            <Bot size={18} />
            <div>
              <span>Codex</span>
              <strong>{state?.runner.codexVersion ?? "未检测到"}</strong>
            </div>
          </div>
        </nav>

        <section className="task-column">
          <div className="metric-strip">
            <Metric icon={<GitPullRequest size={16} />} label="活跃任务" value={state?.metrics.running ?? 0} />
            <Metric icon={<ShieldCheck size={16} />} label="人工复核" value={state?.metrics.needsReview ?? 0} />
            <Metric icon={<AlertTriangle size={16} />} label="阻塞/失败" value={(state?.metrics.blocked ?? 0) + (state?.metrics.failed ?? 0)} />
            <Metric icon={<RefreshCw size={16} />} label="同步漂移" value={state?.metrics.syncDrift ?? 0} />
          </div>
          {error ? <div className="error-banner">{error}</div> : null}
          <TaskList tasks={tasks} selectedTaskId={selectedTask?.id} onSelect={(task) => setSelectedTaskId(task.id)} />
        </section>

        {selectedTask ? (
          <TaskDetail
            task={selectedTask}
            onStart={(task) => runAction(() => api.startTask(task.id))}
            onStop={(task) => runAction(() => api.stopTask(task.id))}
            onReview={(task: Task, decision) => runAction(() => api.review(task.id, decision))}
          />
        ) : (
          <aside className="detail-panel empty-detail">还没有任务。先创建一个本地任务或同步一个 GitHub/GitLab issue。</aside>
        )}
      </main>

      {modalOpen ? <NewTaskModal onClose={() => setModalOpen(false)} onCreate={createTask} onImport={importIssue} /> : null}
    </div>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<App />);
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function countForFilter(state: TaskState | null, filter: Filter): number {
  if (!state) return 0;
  if (filter === "all") return state.metrics.total;
  return state.tasks.filter((task) => task.status === filter).length;
}
