import { useEffect, useState } from "react";
import { Check, Circle, ExternalLink, FileText, Pause, Play, RotateCcw, ShieldCheck, SquareTerminal } from "lucide-react";
import { checklistProgress } from "../../shared/status";
import type { StartTaskInput, Task } from "../../shared/types";
import { StatusBadge } from "./StatusBadge";

interface Props {
  task: Task;
  onStart: (task: Task, input?: StartTaskInput) => Promise<void>;
  onStop: (task: Task) => Promise<void>;
  onReview: (task: Task, decision: "approve" | "changes_requested" | "block", note?: string) => Promise<void>;
}

export function TaskDetail({ task, onStart, onStop, onReview }: Props) {
  const progress = checklistProgress(task.checklist);
  const rawEvents = task.events.filter((event) => event.kind === "runner.codex_event");
  const reviewArtifact = extractReviewArtifact(task);
  const [reviewNote, setReviewNote] = useState("");

  useEffect(() => {
    setReviewNote("");
  }, [task.id, task.status]);

  async function requestChangesAndContinue() {
    await onReview(task, "changes_requested", reviewNote.trim() || "需要继续处理复核意见");
    await onStart(task);
  }

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
            <span>{task.humanReviewReason || "Codex 已停止在可复核状态，需要你确认最终回答和产物后再归档。"}</span>
          </div>
        </div>
      ) : null}

      <div className="detail-actions">
        {task.status === "running" ? (
          <button className="secondary" type="button" onClick={() => onStop(task)}>
            <Pause size={16} />
            停止
          </button>
        ) : task.status === "needs_review" ? null : (
          <button className="primary" type="button" onClick={() => onStart(task)}>
            <Play size={16} />
            {task.status === "draft" ? "开始执行" : "继续执行"}
          </button>
        )}
        {task.status === "needs_review" ? (
          <>
            <button className="primary" type="button" onClick={() => onReview(task, "approve", reviewNote.trim() || undefined)}>
              <Check size={16} />
              复核通过并归档
            </button>
            <button className="secondary" type="button" onClick={requestChangesAndContinue}>
              <RotateCcw size={16} />
              按意见继续执行
            </button>
            <button className="secondary" type="button" onClick={() => onReview(task, "block", reviewNote.trim() || undefined)}>
              <Pause size={16} />
              标记阻塞
            </button>
          </>
        ) : null}
      </div>

      {task.status === "needs_review" ? (
        <section className="detail-section review-material">
          <div className="section-title">
            <ShieldCheck size={16} />
            复核材料
            <span className="section-hint">最终回答和产物路径</span>
          </div>
          {reviewArtifact ? (
            <>
              {reviewArtifact.files.length > 0 ? (
                <div className="review-files">
                  {reviewArtifact.files.map((file) => (
                    <a href={`/api/tasks/${task.id}/files/read?path=${encodeURIComponent(file.path)}`} target="_blank" rel="noreferrer" key={file.path}>
                      <FileText size={14} />
                      {file.label}
                    </a>
                  ))}
                </div>
              ) : null}
              <pre>{reviewArtifact.text}</pre>
            </>
          ) : (
            <div className="empty">没有提取到最终回答。请查看下方执行事件。</div>
          )}
          <label className="review-note">
            <span>复核意见</span>
            <textarea
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              placeholder="通过时可留空；如果要继续执行，在这里写清楚要补什么、改什么。"
            />
          </label>
        </section>
      ) : null}

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
          <span className="section-hint">由执行器和复核流程更新</span>
        </div>
        <div className="checklist">
          {task.checklist.map((item) => (
            <div className={`check-item check-${item.status}`} key={item.id}>
              {item.status === "done" ? <Check size={15} /> : <Circle size={15} />}
              <span>{item.label}</span>
              <small>{item.status}</small>
            </div>
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

interface ReviewArtifact {
  text: string;
  files: Array<{ label: string; path: string }>;
}

function extractReviewArtifact(task: Task): ReviewArtifact | null {
  for (const event of [...task.events].reverse()) {
    if (event.kind !== "runner.codex_event") continue;
    const payload = asRecord(event.payload);
    const method = stringValue(payload.method);
    const params = asRecord(payload.params);
    const item = asRecord(params.item);

    if (method === "item/completed" && item.type === "agentMessage") {
      const text = stringValue(item.text);
      if (text) return { text, files: extractLocalMarkdownLinks(text) };
    }

    if (method === "rawResponseItem/completed" && item.role === "assistant") {
      const text = outputTextFromRawItem(item);
      if (text) return { text, files: extractLocalMarkdownLinks(text) };
    }
  }
  return null;
}

function outputTextFromRawItem(item: Record<string, unknown>): string | null {
  const content = Array.isArray(item.content) ? item.content : [];
  const parts = content
    .map((part) => {
      const record = asRecord(part);
      return record.type === "output_text" ? stringValue(record.text) : null;
    })
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join("\n") : null;
}

function extractLocalMarkdownLinks(text: string): Array<{ label: string; path: string }> {
  const links: Array<{ label: string; path: string }> = [];
  const pattern = /\[([^\]]+)\]\((\/[^)]+)\)/g;
  for (const match of text.matchAll(pattern)) {
    links.push({ label: match[1] ?? match[2] ?? "文件", path: match[2] ?? "" });
  }
  return links.filter((link) => link.path);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
