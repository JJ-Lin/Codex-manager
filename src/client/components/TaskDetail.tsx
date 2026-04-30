import { Check, Circle, ExternalLink, FileText, Pause, Play, RotateCcw, ShieldCheck, SquareTerminal } from "lucide-react";
import { checklistProgress } from "../../shared/status";
import type { ChecklistItem, Task } from "../../shared/types";
import { StatusBadge } from "./StatusBadge";

interface Props {
  task: Task;
  onStart: (task: Task) => Promise<void>;
  onStop: (task: Task) => Promise<void>;
  onChecklist: (item: ChecklistItem) => Promise<void>;
  onReview: (task: Task, decision: "approve" | "changes_requested" | "block") => Promise<void>;
}

export function TaskDetail({ task, onStart, onStop, onChecklist, onReview }: Props) {
  const progress = checklistProgress(task.checklist);
  const rawEvents = task.events.filter((event) => event.kind === "runner.codex_event");

  return (
    <aside className="detail-panel">
      <div className="detail-header">
        <div>
          <div className="detail-status">
            <StatusBadge status={task.status} />
            {task.humanReviewRequired ? <span className="review-chip">Human Review</span> : null}
          </div>
          <h2>{task.title}</h2>
          <p>{task.description || "没有额外描述。"}</p>
        </div>
      </div>

      {task.status === "needs_review" ? (
        <div className="review-callout">
          <ShieldCheck size={18} />
          <div>
            <strong>需要人工复核</strong>
            <span>{task.humanReviewReason || "Codex 已停止在可复核状态，需要你确认结果后再归档。"}</span>
          </div>
        </div>
      ) : null}

      <div className="detail-actions">
        {task.status === "running" ? (
          <button className="secondary" type="button" onClick={() => onStop(task)}>
            <Pause size={16} />
            停止
          </button>
        ) : (
          <button className="primary" type="button" onClick={() => onStart(task)}>
            <Play size={16} />
            继续执行
          </button>
        )}
        <button className="secondary" type="button" onClick={() => onReview(task, "approve")} disabled={task.status !== "needs_review"}>
          <Check size={16} />
          复核通过
        </button>
        <button className="secondary" type="button" onClick={() => onReview(task, "changes_requested")}>
          <RotateCcw size={16} />
          请求修改
        </button>
      </div>

      <section className="detail-section current-step">
        <div className="section-title">
          <SquareTerminal size={16} />
          当前步骤
        </div>
        <div className="current-step-box">
          <strong>{task.currentStep || "等待下一步"}</strong>
          <span>
            Checklist {progress.label}，原始 Codex 事件 {rawEvents.length} 条。
          </span>
        </div>
      </section>

      <section className="detail-section">
        <div className="section-title">
          <Check size={16} />
          Checklist
        </div>
        <div className="checklist">
          {task.checklist.map((item) => (
            <button className={`check-item check-${item.status}`} type="button" key={item.id} onClick={() => onChecklist(item)}>
              {item.status === "done" ? <Check size={15} /> : <Circle size={15} />}
              <span>{item.label}</span>
              <small>{item.status}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="detail-section evidence-grid">
        <InfoRow label="工作区" value={task.workspacePath || "自动创建"} />
        <InfoRow label="仓库" value={task.repoUrl || "未绑定"} />
        <InfoRow label="账号" value={task.providerAccount || "auto"} />
        <InfoRow label="Codex session" value={task.lastCodexSessionId || "尚未捕获"} />
        {task.sourceRef?.url ? <InfoRow label="来源" value={task.sourceRef.url} href={task.sourceRef.url} /> : null}
      </section>

      <section className="detail-section">
        <div className="section-title">
          <FileText size={16} />
          执行事件
        </div>
        <div className="event-stream">
          {task.events.length === 0 ? (
            <div className="empty">还没有事件。</div>
          ) : (
            [...task.events].reverse().map((event) => (
              <div className={`event event-${event.kind.replaceAll(".", "-")}`} key={event.id}>
                <span>{new Date(event.createdAt).toLocaleTimeString()}</span>
                <strong>{event.kind}</strong>
                <p>{event.message}</p>
              </div>
            ))
          )}
        </div>
      </section>
    </aside>
  );
}

function InfoRow({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer">
          {value}
          <ExternalLink size={13} />
        </a>
      ) : (
        <strong>{value}</strong>
      )}
    </div>
  );
}
