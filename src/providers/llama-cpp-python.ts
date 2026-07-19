import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";
import { fileURLToPath } from "url";
import type { NativeLlamaCppSettings } from "../settings";

type WorkerReply = {
  id?: string;
  event?: string;
  ok?: boolean;
  error?: string;
  message?: Record<string, unknown>;
  usage?: unknown;
};

export type NativeLlamaProgress = {
  event: string;
  [key: string]: unknown;
};

export type NativeLlamaCppCompletion = {
  choices: Array<{ message: Record<string, unknown> }>;
  usage?: unknown;
};

type PendingRequest = {
  resolve: (reply: WorkerReply) => void;
  reject: (error: Error) => void;
  type: string;
  startedAt: number;
  heartbeat?: ReturnType<typeof setInterval>;
};

export class LlamaCppPythonWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private stderr = "";
  private configKey: string | null = null;
  private debugLogEnabled = false;
  private activeSessionId: string | null = null;
  private progressListener: ((progress: NativeLlamaProgress) => void) | null = null;

  setProgressListener(listener: ((progress: NativeLlamaProgress) => void) | null): void {
    this.progressListener = listener;
  }

  async initialize(
    sessionId: string,
    config: NativeLlamaCppSettings,
    messages: unknown[],
    tools: unknown[],
    generation: { temperature?: number; topP?: number; repetitionPenalty?: number },
    debugLogEnabled: boolean
  ): Promise<void> {
    this.debugLogEnabled = debugLogEnabled;
    this.activeSessionId = sessionId;
    await this.ensureStarted(config);
    this.log("init", { config, messages, tools, generation });
    await this.request("init", { sessionId, config, messages, tools, generation });
  }

  async append(sessionId: string, messages: unknown[]): Promise<void> {
    if (messages.length === 0) return;
    this.log("append", { messages });
    await this.request("append", { sessionId, messages });
  }

  async complete(sessionId: string): Promise<NativeLlamaCppCompletion> {
    this.log("complete_request", {});
    const reply = await this.request("complete", { sessionId });
    if (!reply.message) {
      throw new Error("Native llama.cpp worker returned no assistant message");
    }
    const completion = { choices: [{ message: reply.message }], usage: reply.usage };
    this.log("complete_response", completion);
    return completion;
  }

  async reset(sessionId: string): Promise<void> {
    if (!this.child) return;
    await this.request("reset", { sessionId });
  }

  private async ensureStarted(config: NativeLlamaCppSettings): Promise<void> {
    const configKey = JSON.stringify({
      pythonPath: config.pythonPath ?? "python",
      modelPath: config.modelPath,
      chatFormat: config.chatFormat,
      nCtx: config.nCtx,
      nGpuLayers: config.nGpuLayers
    });
    if (this.child && this.configKey === configKey) return;

    this.stop();
    if (!config.modelPath?.trim()) {
      throw new Error("nativeLlamaCpp.modelPath is required when nativeLlamaCpp.enabled is true");
    }

    const workerPath = process.env.SBDT_NATIVE_LLAMA_WORKER_PATH?.trim()
      || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "python", "llama_cpp_worker.py");
    this.stderr = "";
    const child = spawn(config.pythonPath?.trim() || "python", ["-u", workerPath], {
      stdio: "pipe",
      windowsHide: true
    });
    this.child = child;
    this.configKey = configKey;
    this.live("worker_started", { pythonPath: config.pythonPath ?? "python", modelPath: config.modelPath });

    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      this.stderr = `${this.stderr}${text}`.slice(-8_000);
      this.log("worker_stderr", { text });
    });
    child.on("error", (error) => {
      if (this.child === child) this.failAll(error);
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      const suffix = this.stderr.trim() ? `: ${this.stderr.trim()}` : "";
      this.failAll(new Error(`Native llama.cpp worker exited (${code ?? "null"}/${signal ?? "none"})${suffix}`));
      this.child = null;
      this.configKey = null;
    });
  }

  private request(type: string, payload: Record<string, unknown>): Promise<WorkerReply> {
    if (!this.child?.stdin.writable) {
      return Promise.reject(new Error("Native llama.cpp worker is not running"));
    }
    const id = randomUUID();
    const body = JSON.stringify({ id, type, ...payload });
    return new Promise<WorkerReply>((resolve, reject) => {
      const startedAt = Date.now();
      const heartbeat = setInterval(() => {
        this.live("waiting", { request: type, elapsedSeconds: Math.floor((Date.now() - startedAt) / 1_000) });
      }, 1_000);
      this.pending.set(id, { resolve, reject, type, startedAt, heartbeat });
      this.child?.stdin.write(`${body}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (pending?.heartbeat) clearInterval(pending.heartbeat);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private handleLine(line: string): void {
    let reply: WorkerReply;
    try {
      reply = JSON.parse(line) as WorkerReply;
    } catch {
      return;
    }
    if (reply.event) {
      this.live(reply.event, reply);
      return;
    }
    if (!reply.id) return;
    const pending = this.pending.get(reply.id);
    if (!pending) return;
    this.pending.delete(reply.id);
    if (pending.heartbeat) clearInterval(pending.heartbeat);
    this.live("request_complete", { request: pending.type, elapsedMs: Date.now() - pending.startedAt });
    if (reply.ok === false) {
      this.log("worker_error", { error: reply.error || "Native llama.cpp worker request failed" });
      pending.reject(new Error(reply.error || "Native llama.cpp worker request failed"));
      return;
    }
    pending.resolve(reply);
  }

  private failAll(error: Error): void {
    this.log("worker_failure", { error: error.message });
    for (const pending of this.pending.values()) {
      if (pending.heartbeat) clearInterval(pending.heartbeat);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private stop(): void {
    const child = this.child;
    const hadWorker = child !== null || this.pending.size > 0;
    this.child = null;
    this.configKey = null;
    if (child && !child.killed) child.kill();
    if (hadWorker) {
      this.failAll(new Error("Native llama.cpp worker was restarted"));
    }
  }

  private log(event: string, payload: Record<string, unknown>): void {
    if (!this.debugLogEnabled) return;
    try {
      const logPath = path.join(os.homedir(), ".sbdt", "logs", "native-llama.jsonl");
      const readableLogPath = path.join(os.homedir(), ".sbdt", "logs", "native-llama.log");
      const entry = {
        timestamp: new Date().toISOString(),
        sessionId: this.activeSessionId,
        event,
        ...payload
      };
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
      fs.appendFileSync(readableLogPath, `${JSON.stringify(entry, null, 2)}\n\n`, "utf8");
    } catch {
      // Debug logging must never break inference.
    }
  }

  private live(event: string, payload: Record<string, unknown>): void {
    if (!this.debugLogEnabled) return;
    try {
      const entry = { ...payload, event };
      this.log("live_progress", entry);
      this.progressListener?.({ event, ...payload });
    } catch {
      // Live diagnostics must never break inference.
    }
  }
}
