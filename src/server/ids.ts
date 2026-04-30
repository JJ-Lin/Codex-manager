import { randomUUID } from "node:crypto";

export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

export function slugifyWorkspaceKey(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "task";
}
