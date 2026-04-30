import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type JsonRecord = Record<string, unknown>;

export interface AppServerProtocolMessage extends JsonRecord {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export interface AppServerProtocolClientOptions {
  codexBin: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  onNotification?: (message: AppServerProtocolMessage) => void;
  onServerRequest?: (message: AppServerProtocolMessage) => Promise<unknown> | unknown;
  onStderr?: (line: string) => void;
  onStdoutLine?: (line: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

export class AppServerProtocolClient {
  readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private readonly pending = new Map<number | string, PendingRequest>();
  private closed = false;

  constructor(private readonly options: AppServerProtocolClientOptions) {
    this.child = spawn(options.codexBin, ["app-server"], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, FORCE_COLOR: "0" }
    });

    this.child.stdout.on("data", (chunk: Buffer) => {
      this.stdoutBuffer = consumeLines(this.stdoutBuffer + chunk.toString("utf8"), (line) => this.handleStdoutLine(line));
    });

    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderrBuffer = consumeLines(this.stderrBuffer + chunk.toString("utf8"), (line) => this.options.onStderr?.(line));
    });

    this.child.on("error", (error) => {
      this.rejectAll(error);
    });

    this.child.on("close", (code, signal) => {
      this.closed = true;
      this.rejectAll(new Error(`codex app-server 已退出：${signal ?? code ?? "unknown"}`));
      this.options.onExit?.(code, signal);
    });
  }

  pid(): number | null {
    return this.child.pid ?? null;
  }

  async initialize(): Promise<unknown> {
    const result = await this.request("initialize", {
      capabilities: { experimentalApi: true },
      clientInfo: {
        name: "codex-manager",
        title: "Codex Manager",
        version: "0.1.0"
      }
    });
    this.notify("initialized", {});
    return result;
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
    if (this.closed) return Promise.reject(new Error("codex app-server 已关闭"));
    const id = this.nextId++;
    const message: AppServerProtocolMessage = { id, method };
    if (params !== undefined) message.params = params;
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 响应超时`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      });
    });
    this.send(message);
    return promise;
  }

  notify(method: string, params?: unknown): void {
    const message: AppServerProtocolMessage = { method };
    if (params !== undefined) message.params = params;
    this.send(message);
  }

  respond(id: number | string, result: unknown): void {
    this.send({ id, result });
  }

  respondError(id: number | string, message: string): void {
    this.send({ id, error: { message } });
  }

  shutdown(signal: NodeJS.Signals = "SIGTERM"): void {
    if (this.closed) return;
    this.closed = true;
    this.child.kill(signal);
  }

  private send(message: AppServerProtocolMessage): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleStdoutLine(line: string): void {
    this.options.onStdoutLine?.(line);
    const trimmed = line.trim();
    if (!trimmed) return;

    const message = parseJsonRecord(trimmed);
    if (!message) {
      this.options.onNotification?.({ method: "stdout", params: { line: trimmed } });
      return;
    }

    if (message.method && message.id !== undefined) {
      void this.handleServerRequest(message);
      return;
    }

    if (message.id !== undefined) {
      this.handleResponse(message);
      return;
    }

    if (message.method) {
      this.options.onNotification?.(message);
    }
  }

  private handleResponse(message: AppServerProtocolMessage): void {
    const id = message.id;
    if (id === undefined) return;
    const pending = this.pending.get(id);
    if (!pending) {
      this.options.onNotification?.(message);
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (message.error !== undefined) {
      pending.reject(new Error(formatProtocolError(message.error)));
      return;
    }
    pending.resolve(message.result);
  }

  private async handleServerRequest(message: AppServerProtocolMessage): Promise<void> {
    const id = message.id;
    if (id === undefined) return;
    try {
      const result = await this.options.onServerRequest?.(message);
      this.respond(id, result ?? {});
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.respondError(id, detail);
    }
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

function consumeLines(buffer: string, onLine: (line: string) => void): string {
  let remaining = buffer;
  for (;;) {
    const index = remaining.indexOf("\n");
    if (index < 0) return remaining;
    const line = remaining.slice(0, index).replace(/\r$/, "");
    remaining = remaining.slice(index + 1);
    onLine(line);
  }
}

function parseJsonRecord(line: string): AppServerProtocolMessage | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as AppServerProtocolMessage) : null;
  } catch {
    return null;
  }
}

function formatProtocolError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as JsonRecord).message;
    if (typeof message === "string") return message;
  }
  return JSON.stringify(error);
}
