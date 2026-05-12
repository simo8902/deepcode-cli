import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { sanitizeLogPayload } from "./error-logger";

const DEBUG_LOG_FILE = "debug.log";

export type OpenAIChatCompletionDebugEntry = {
  timestamp: string;
  location: string;
  requestId?: string;
  sessionId?: string;
  model?: string;
  baseURL?: string;
  durationMs?: number;
  params?: Record<string, unknown>;
  request: Record<string, unknown>;
  response?: unknown;
  responseChunks?: unknown[];
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
};

export function logOpenAIChatCompletionDebug(entry: OpenAIChatCompletionDebugEntry): void {
  try {
    const logPath = getDebugLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify(sanitizeDebugEntry(entry))}\n`, "utf8");
  } catch {
    // Debug logging must never affect CLI behavior.
  }
}

export function getDebugLogPath(): string {
  return path.join(os.homedir(), ".deepcode", "logs", DEBUG_LOG_FILE);
}

export function normalizeDebugError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }
  return {
    name: "UnknownError",
    message: String(error)
  };
}

function toSerializable(value: unknown): unknown {
  const seen = new WeakSet<object>();

  function walk(current: unknown): unknown {
    if (typeof current === "bigint") {
      return current.toString();
    }
    if (current instanceof Error) {
      return normalizeDebugError(current);
    }
    if (!current || typeof current !== "object") {
      return current;
    }
    if (seen.has(current)) {
      return "[Circular]";
    }
    seen.add(current);
    if (Array.isArray(current)) {
      return current.map(walk);
    }
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(current)) {
      result[key] = walk(val);
    }
    return result;
  }

  return walk(value);
}

function sanitizeDebugEntry(entry: OpenAIChatCompletionDebugEntry): unknown {
  const serializable = toSerializable(entry) as Record<string, unknown>;
  return {
    ...serializable,
    request: sanitizeLogPayload(entry.request),
    response:
      entry.response && typeof entry.response === "object"
        ? sanitizeLogPayload(entry.response as Record<string, unknown>)
        : entry.response,
    responseChunks: Array.isArray(entry.responseChunks)
      ? entry.responseChunks.map((chunk) =>
          chunk && typeof chunk === "object"
            ? sanitizeLogPayload(chunk as Record<string, unknown>)
            : chunk
        )
      : entry.responseChunks,
    error:
      entry.error && typeof entry.error === "object"
        ? sanitizeLogPayload(entry.error as Record<string, unknown>)
        : entry.error
  };
}
