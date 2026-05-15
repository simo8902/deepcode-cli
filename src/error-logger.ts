import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const LOG_DIR = path.join(os.homedir(), ".deepcode", "logs");
const ERROR_LOG_PATH = path.join(LOG_DIR, "error.log");
const WARN_LOG_PATH = path.join(LOG_DIR, "warn.log");

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

export type WarnLogEntry = {
  timestamp: string;
  location: string;
  message: string;
  sessionId?: string;
  data?: Record<string, unknown>;
};

export function logWarn(entry: WarnLogEntry): void {
  try {
    ensureLogDir();
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(WARN_LOG_PATH, line, "utf8");

    const MAX_ENTRIES = 100;
    const raw = fs.readFileSync(WARN_LOG_PATH, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length > MAX_ENTRIES) {
      fs.writeFileSync(WARN_LOG_PATH, lines.slice(-MAX_ENTRIES).join("\n") + "\n", "utf8");
    }
  } catch {
    // Never disrupt main flow
  }
}

/**
 * Mask sensitive values (API keys, tokens) that may appear in error messages
 * or response bodies.
 */
export function maskSensitive(text: string): string {
  return (
    text
      // Mask Bearer tokens in Authorization headers
      .replace(
        /(Authorization:\s*Bearer\s+)[^\s\r\n]+/gi,
        "$1***MASKED***"
      )
      // Mask JWTs wherever they appear.
      .replace(
        /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
        "***MASKED_JWT***"
      )
      // Mask PEM private key blocks.
      .replace(
        /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
        "-----BEGIN PRIVATE KEY-----***MASKED***-----END PRIVATE KEY-----"
      )
      // Mask "apiKey" or "api_key" values in JSON-like strings
      .replace(
        /((?:api[Kk]ey|api_key|secret|token|password|jwt|private[_-]?key)\s*[:=]\s*"?)[^",}\s]+/gi,
        "$1***MASKED***"
      )
  );
}

const CONTENT_REDACTION_PREVIEW = 0;
const SENSITIVE_KEY_PATTERN =
  /(?:api[_-]?key|authorization|bearer|client[_-]?secret|credential|jwt|password|private[_-]?key|refresh[_-]?token|secret|token)/i;
const REDACTED_TEXT_KEY_PATTERN =
  /^(?:content|reasoning|reasoning_content|reasoning_text|reasoning_details|reasoning_summary|thinking|thinking_content|thought|thoughts)$/i;
const TOOL_ARGUMENTS_KEY_PATTERN = /^arguments$/i;

/**
 * Truncate a content string for logging: keep a short prefix and append the
 * total length so the payload structure is preserved while content bloat is
 * avoided.
 */
function redactContent(value: string): string {
  if (CONTENT_REDACTION_PREVIEW > 0 && value.length <= CONTENT_REDACTION_PREVIEW) {
    return maskSensitive(value);
  }
  return `[REDACTED content, ${value.length} chars]`;
}

/**
 * Deep-clone a request payload, only truncating `content` fields whose value
 * is a string.  Every other field is kept exactly as-is so the logged request
 * mirrors the original API payload (no fields added or removed).
 */
export function sanitizeLogPayload(
  request: Record<string, unknown>
): Record<string, unknown> {
  function walk(value: unknown, key = ""): unknown {
    if (typeof value === "string") {
      if (REDACTED_TEXT_KEY_PATTERN.test(key)) {
        return redactContent(value);
      }
      return maskSensitive(value);
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => walk(item));
    }

    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(record)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = typeof val === "string" ? "***MASKED***" : "[REDACTED sensitive field]";
      } else if (TOOL_ARGUMENTS_KEY_PATTERN.test(key)) {
        result[key] = typeof val === "string" ? `[REDACTED tool arguments, ${val.length} chars]` : "[REDACTED tool arguments]";
      } else if (REDACTED_TEXT_KEY_PATTERN.test(key)) {
        result[key] = typeof val === "string" ? redactContent(val) : "[REDACTED content field]";
      } else {
        result[key] = walk(val, key);
      }
    }

    return result;
  }

  return walk(request) as Record<string, unknown>;
}

export type ApiErrorLogEntry = {
  timestamp: string;
  location: string;
  requestId: string;
  sessionId?: string;
  model?: string;
  baseURL?: string;
  error: {
    name: string;
    message: string;
    stack?: string;
  };
  request: Record<string, unknown>;
  response?: unknown;
};

/**
 * Write an API error log entry to ~/.deepcode/logs/error.log.
 */
export function logApiError(entry: ApiErrorLogEntry): void {
  try {
    ensureLogDir();

    const logLine: Record<string, unknown> = {
      timestamp: entry.timestamp,
      location: entry.location,
      requestId: entry.requestId,
      sessionId: entry.sessionId,
      model: entry.model,
      baseURL: entry.baseURL,
      error: {
        name: entry.error.name,
        message: maskSensitive(entry.error.message),
        stack: entry.error.stack ? maskSensitive(entry.error.stack) : undefined,
      },
      request: sanitizeLogPayload(entry.request),
    };

    if (entry.response !== undefined) {
      logLine.response =
        entry.response && typeof entry.response === "object"
          ? sanitizeLogPayload(entry.response as Record<string, unknown>)
          : typeof entry.response === "string"
            ? maskSensitive(entry.response)
            : entry.response;
    }

    const newLine = JSON.stringify(logLine) + "\n";
    fs.appendFileSync(ERROR_LOG_PATH, newLine, "utf8");

    // Keep only the last N entries
    const MAX_ENTRIES = 20;
    const raw = fs.readFileSync(ERROR_LOG_PATH, "utf8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length > MAX_ENTRIES) {
      fs.writeFileSync(
        ERROR_LOG_PATH,
        lines.slice(-MAX_ENTRIES).join("\n") + "\n",
        "utf8"
      );
    }
  } catch {
    // Silently ignore logging failures to avoid disrupting the main flow
  }
}
