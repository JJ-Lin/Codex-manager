import { useState } from "react";
import { X } from "lucide-react";
import type { CreateTaskInput } from "../../shared/types";

interface Props {
  onClose: () => void;
  onCreate: (input: CreateTaskInput) => Promise<void>;
  onImport: (url: string) => Promise<void>;
}

export function NewTaskModal({ onClose, onCreate, onImport }: Props) {
  const [mode, setMode] = useState<"local" | "external">("local");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [checklistTemplate, setChecklistTemplate] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      if (mode === "external") {
        await onImport(externalUrl);
      } else {
        await onCreate({
          title,
          description,
          repoUrl,
          workspacePath,
          checklistTemplate,
          providerAccount: "auto",
          humanReviewRequired: true
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <div>
            <h2>新建任务</h2>
            <p>本地任务可以直接运行，GitHub/GitLab issue 会先同步为本地 canonical task。</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="segmented">
          <button className={mode === "local" ? "active" : ""} onClick={() => setMode("local")} type="button">
            本地创建
          </button>
          <button className={mode === "external" ? "active" : ""} onClick={() => setMode("external")} type="button">
            GitHub / GitLab 同步
          </button>
        </div>

        {mode === "local" ? (
          <div className="form-grid">
            <label>
              标题
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：修复同步状态显示错误" />
            </label>
            <label>
              描述
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
            </label>
            <label>
              仓库 URL
              <input value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} placeholder="git@github.com:org/repo.git" />
            </label>
            <label>
              工作区路径
              <input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder="留空则自动创建隔离 workspace" />
            </label>
            <label>
              Checklist 模板
              <textarea
                value={checklistTemplate}
                onChange={(event) => setChecklistTemplate(event.target.value)}
                rows={5}
                placeholder="- 解析任务需求&#10;- 修改实现&#10;- 运行测试&#10;- 等待人工复核"
              />
            </label>
          </div>
        ) : (
          <div className="form-grid">
            <label>
              Issue URL
              <input
                value={externalUrl}
                onChange={(event) => setExternalUrl(event.target.value)}
                placeholder="https://github.com/org/repo/issues/1 或 https://git.garena.com/group/repo/-/issues/1"
              />
            </label>
          </div>
        )}

        <div className="modal-actions">
          <button className="secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" type="button" disabled={busy || (mode === "local" ? !title.trim() : !externalUrl.trim())} onClick={submit}>
            {busy ? "处理中" : mode === "local" ? "创建任务" : "同步并创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
