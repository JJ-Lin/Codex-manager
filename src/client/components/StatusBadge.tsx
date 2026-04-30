import { STATUS_LABELS } from "../../shared/status";
import type { TaskStatus } from "../../shared/types";

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`status-badge status-${status}`}>{STATUS_LABELS[status]}</span>;
}
