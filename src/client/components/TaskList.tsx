import { AlertTriangle, CheckCircle2, CircleDot, GitBranch, ShieldCheck } from "lucide-react";
import { checklistProgress } from "../../shared/status";
import { externalRefLabel } from "../../shared/external";
import type { Task } from "../../shared/types";
import { StatusBadge } from "./StatusBadge";

export function TaskList({ tasks, selectedTaskId, onSelect }: { tasks: Task[]; selectedTaskId?: string; onSelect: (task: Task) => void }) {
  return (
    <div className="task-list">
      {tasks.map((task) => {
        const progress = checklistProgress(task.checklist);
        return (
          <button
            type="button"
            className={`task-row ${selectedTaskId === task.id ? "selected" : ""}`}
            key={task.id}
            onClick={() => onSelect(task)}
          >
            <div className="task-row-main">
              <div className="task-title-line">
                {task.status === "needs_review" ? <ShieldCheck size={16} /> : task.status === "failed" ? <AlertTriangle size={16} /> : <CircleDot size={16} />}
                <span>{task.title}</span>
              </div>
              <div className="task-meta">
                <StatusBadge status={task.status} />
                <span>{task.currentStep ?? "等待更新"}</span>
                <span>{progress.label} checks</span>
                {task.orchestrationMode === "symphony_blackbox" ? <span>黑盒</span> : null}
              </div>
            </div>
            <div className="task-row-side">
              <span className="source-chip">{externalRefLabel(task.sourceRef)}</span>
              {task.branchName ? (
                <span className="branch-chip">
                  <GitBranch size={13} />
                  {task.branchName}
                </span>
              ) : null}
              {progress.done === progress.total && progress.total > 0 ? <CheckCircle2 className="done-icon" size={16} /> : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
