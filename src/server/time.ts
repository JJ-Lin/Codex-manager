export function nowIso(): string {
  return new Date().toISOString();
}

export function secondsAgoLabel(iso?: string | null): string {
  if (!iso) return "从未";
  const delta = Math.max(0, Date.now() - new Date(iso).getTime());
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) return `${seconds}s 前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m 前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h 前`;
  return `${Math.floor(hours / 24)}d 前`;
}
