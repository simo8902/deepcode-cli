import { DeepRedact } from "@hackylabs/deep-redact";

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const API_KEY_VALUE_PATTERN =
  /\b(?:sk-or-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[0-9A-Z]{16})\b/g;
const ASSIGNMENT_SECRET_PATTERN =
  /\b(?:api[_-]?key|authorization|bearer|client[_-]?secret|jwt|password|private[_-]?key|refresh[_-]?token|secret|token)\b\s*[:=]\s*["']?[^"',\s}]{8,}/gi;
const PASSWORD_PHRASE_PATTERN =
  /\b(password|passwd|pwd)\b\s+(?:is\s+|as\s+|=+\s*)?["']?[^"',\s}]{4,}/gi;
const HIGH_RISK_ASSIGNMENT_SECRET_PATTERN =
  /\b(?:api[_-]?key|authorization|bearer|client[_-]?secret|jwt|private[_-]?key|refresh[_-]?token|token)\b\s*[:=]\s*["']?(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sk-or-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[0-9A-Z]{16})/gi;
const STRICT_SECRET_VALUE_NEAR_KEYWORD_PATTERN =
  /(\b[A-Za-z0-9_]*(?:api[_-]?key|authorization|bearer|client[_-]?secret|jwt|password|passwd|pwd|private[_-]?key|refresh[_-]?token|secret|token)[A-Za-z0-9_]*\b(?:\\\||\||\s*[:=]\s*|\s+)["']?[!$%&*?@#-]?)([A-Za-z0-9+/_=-]{4,})/gi;
const STRICT_SECRET_KEYWORD_CONTEXT_PATTERN =
  /\b[A-Za-z0-9_]*(?:api[_-]?key|authorization|bearer|client[_-]?secret|jwt|password|passwd|pwd|private[_-]?key|refresh[_-]?token|secret|token)[A-Za-z0-9_]*\b/i;
const STRICT_PUNCTUATED_SECRET_VALUE_PATTERN =
  /(?<![A-Za-z0-9+/_=-])([!$%&*?@#][A-Za-z0-9+/_=-]{4,})(?![A-Za-z0-9+/_=-])/g;
const HIGH_ENTROPY_TOKEN_PATTERN =
  /(?<![A-Za-z0-9+/_=-])[A-Za-z0-9+/_=-]{32,}(?![A-Za-z0-9+/_=-])/g;
const TEST_PLACEHOLDER_CONTEXT_PATTERN =
  /\b(?:demo|dummy|example|fake|fixture|mock|placeholder|sample|test|testing)\b/i;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\(?:[^\\\s"'{}[\],:]+\\)*[^\\\s"'{}[\],:]*/g;
const POSIX_PATH_PATTERN = /(?<![:\w])\/(?:Users|home|tmp|var|etc|mnt|opt|workspace|root)\/[^\s"'{}[\],)]*/g;
const PROVIDER_SECRET_STRING_TEST_PATTERN =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\b(?:sk-or-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[0-9A-Z]{16})\b|\b[A-Za-z0-9_]*(?:api[_-]?key|authorization|bearer|client[_-]?secret|jwt|password|passwd|pwd|private[_-]?key|refresh[_-]?token|secret|token)[A-Za-z0-9_]*\b|(?<![A-Za-z0-9+/_=-])[A-Za-z0-9+/_=-]{32,}(?![A-Za-z0-9+/_=-])/i;

const providerStrictRedactor = new DeepRedact({
  serialize: false,
  replacement: "[REDACTED_SECRET]",
  blacklistedKeys: [
    /api[_-]?key/i,
    /authorization/i,
    /bearer/i,
    /client[_-]?secret/i,
    /jwt/i,
    /password/i,
    /passwd/i,
    /pwd/i,
    /private[_-]?key/i,
    /refresh[_-]?token/i,
    /secret/i,
    /token/i
  ],
  stringTests: [
    {
      pattern: PROVIDER_SECRET_STRING_TEST_PATTERN,
      replacer: (value) => redactHighRiskString(value)
    }
  ]
});

export type PipelineSanitizationResult = {
  value: unknown;
  redactedSensitiveContent: boolean;
};

export function containsHighRiskSecret(value: unknown): boolean {
  let found = false;
  walkStrings(value, (text) => {
    if (
      JWT_PATTERN.test(text) ||
      PRIVATE_KEY_PATTERN.test(text) ||
      hasKnownApiKeyValue(text) ||
      hasHighRiskAssignmentSecret(text) ||
      hasHighEntropySecret(text)
    ) {
      found = true;
    }
    resetPatterns();
  });
  return found;
}

export function sanitizeForModelPipeline(value: unknown): PipelineSanitizationResult {
  const redactedSensitiveContent = containsHighRiskSecret(value);
  return {
    value: sanitizeValue(value),
    redactedSensitiveContent
  };
}

export function sanitizeForProviderStrict(value: unknown): PipelineSanitizationResult {
  const redactedValue = providerStrictRedactor.redact(value);
  const redactedSensitiveContent =
    safeJsonStringify(value) !== safeJsonStringify(redactedValue) ||
    containsHighRiskSecret(value) ||
    containsStrictSecretPattern(value);
  return {
    value: redactedValue,
    redactedSensitiveContent
  };
}

export function sanitizeToolCallsForReplay(toolCalls: unknown[] | null): unknown[] | null {
  if (!toolCalls) {
    return null;
  }
  return toolCalls.map((toolCall) => {
    if (!toolCall || typeof toolCall !== "object") {
      return toolCall;
    }
    const record = toolCall as Record<string, unknown>;
    const fn = record.function;
    if (!fn || typeof fn !== "object") {
      return { ...record };
    }
    return {
      ...record,
      function: {
        ...(fn as Record<string, unknown>),
        arguments: "{\"redacted\":true}"
      }
    };
  });
}

export function assertNoHighRiskSecretsForModel(value: unknown): void {
  void value;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    result[key] = sanitizeValue(val);
  }
  return result;
}

function redactString(value: string): string {
  resetPatterns();
  return value
    .replace(PRIVATE_KEY_PATTERN, "[REDACTED_PRIVATE_KEY]")
    .replace(JWT_PATTERN, "[REDACTED_JWT]")
    .replace(API_KEY_VALUE_PATTERN, "[REDACTED_API_KEY]")
    .replace(ASSIGNMENT_SECRET_PATTERN, (match) => {
      const separatorIndex = Math.max(match.indexOf("="), match.indexOf(":"));
      return separatorIndex >= 0
        ? `${match.slice(0, separatorIndex + 1)}[REDACTED_SECRET]`
        : "[REDACTED_SECRET]";
    })
    .replace(PASSWORD_PHRASE_PATTERN, (_match, label: string) => `${label} [REDACTED_SECRET]`)
    .replace(HIGH_ENTROPY_TOKEN_PATTERN, (match) =>
      isHighEntropySecretCandidate(match) ? "[REDACTED_HIGH_ENTROPY_SECRET]" : match
    )
    .replace(WINDOWS_PATH_PATTERN, "[REDACTED_PATH]")
    .replace(POSIX_PATH_PATTERN, "[REDACTED_PATH]");
}

function redactHighRiskString(value: string): string {
  resetPatterns();
  let redacted = value
    .replace(PRIVATE_KEY_PATTERN, "[REDACTED_PRIVATE_KEY]")
    .replace(JWT_PATTERN, "[REDACTED_JWT]")
    .replace(API_KEY_VALUE_PATTERN, "[REDACTED_API_KEY]")
    .replace(HIGH_RISK_ASSIGNMENT_SECRET_PATTERN, (match) => {
      const separatorIndex = Math.max(match.indexOf("="), match.indexOf(":"));
      return separatorIndex >= 0
        ? `${match.slice(0, separatorIndex + 1)}[REDACTED_SECRET]`
        : "[REDACTED_SECRET]";
    })
    .replace(STRICT_SECRET_VALUE_NEAR_KEYWORD_PATTERN, (_match, prefix: string) =>
      `${prefix}[REDACTED_SECRET]`
    )
    .replace(HIGH_ENTROPY_TOKEN_PATTERN, (match) =>
      isHighEntropySecretCandidate(match) ? "[REDACTED_HIGH_ENTROPY_SECRET]" : match
    );
  if (STRICT_SECRET_KEYWORD_CONTEXT_PATTERN.test(value)) {
    redacted = redacted.replace(STRICT_PUNCTUATED_SECRET_VALUE_PATTERN, "[REDACTED_SECRET]");
  }
  return redacted;
}

function containsStrictSecretPattern(value: unknown): boolean {
  let found = false;
  walkStrings(value, (text) => {
    if (
      STRICT_SECRET_VALUE_NEAR_KEYWORD_PATTERN.test(text) ||
      (
        STRICT_SECRET_KEYWORD_CONTEXT_PATTERN.test(text) &&
        STRICT_PUNCTUATED_SECRET_VALUE_PATTERN.test(text)
      )
    ) {
      found = true;
    }
    resetPatterns();
  });
  return found;
}

function hasHighEntropySecret(text: string): boolean {
  resetPatterns();
  let match: RegExpExecArray | null;
  while ((match = HIGH_ENTROPY_TOKEN_PATTERN.exec(text)) !== null) {
    if (
      isHighEntropySecretCandidate(match[0]) &&
      !hasTestPlaceholderContext(text, match.index, match.index + match[0].length)
    ) {
      resetPatterns();
      return true;
    }
  }
  resetPatterns();
  return false;
}

function hasKnownApiKeyValue(text: string): boolean {
  resetPatterns();
  let match: RegExpExecArray | null;
  while ((match = API_KEY_VALUE_PATTERN.exec(text)) !== null) {
    if (!hasTestPlaceholderContext(text, match.index, match.index + match[0].length)) {
      resetPatterns();
      return true;
    }
  }
  resetPatterns();
  return false;
}

function hasHighRiskAssignmentSecret(text: string): boolean {
  resetPatterns();
  let match: RegExpExecArray | null;
  while ((match = HIGH_RISK_ASSIGNMENT_SECRET_PATTERN.exec(text)) !== null) {
    if (!hasTestPlaceholderContext(text, match.index, match.index + match[0].length)) {
      resetPatterns();
      return true;
    }
  }
  resetPatterns();
  return false;
}

function hasTestPlaceholderContext(text: string, start: number, end: number): boolean {
  const contextStart = Math.max(0, start - 80);
  const contextEnd = Math.min(text.length, end + 80);
  return TEST_PLACEHOLDER_CONTEXT_PATTERN.test(text.slice(contextStart, contextEnd));
}

function isHighEntropySecretCandidate(token: string): boolean {
  const normalized = token.replace(/^=+|=+$/g, "");
  if (normalized.length < 32 || /^\d+$/.test(normalized) || /^([A-Za-z0-9+/_=-])\1+$/.test(normalized)) {
    return false;
  }

  const entropy = shannonEntropy(normalized);
  if (/^[a-f0-9]+$/i.test(normalized)) {
    return normalized.length >= 40 && entropy >= 3.4;
  }

  return countCharacterClasses(normalized) >= 3 && entropy >= 4.2;
}

function countCharacterClasses(value: string): number {
  return [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[+/_=-]/.test(value)
  ].filter(Boolean).length;
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function walkStrings(value: unknown, visit: (text: string) => void): void {
  if (typeof value === "string") {
    visit(value);
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walkStrings(item, visit);
    }
    return;
  }
  for (const val of Object.values(value as Record<string, unknown>)) {
    walkStrings(val, visit);
  }
}

function resetPatterns(): void {
  JWT_PATTERN.lastIndex = 0;
  PRIVATE_KEY_PATTERN.lastIndex = 0;
  API_KEY_VALUE_PATTERN.lastIndex = 0;
  ASSIGNMENT_SECRET_PATTERN.lastIndex = 0;
  PASSWORD_PHRASE_PATTERN.lastIndex = 0;
  HIGH_RISK_ASSIGNMENT_SECRET_PATTERN.lastIndex = 0;
  STRICT_SECRET_VALUE_NEAR_KEYWORD_PATTERN.lastIndex = 0;
  STRICT_PUNCTUATED_SECRET_VALUE_PATTERN.lastIndex = 0;
  HIGH_ENTROPY_TOKEN_PATTERN.lastIndex = 0;
  WINDOWS_PATH_PATTERN.lastIndex = 0;
  POSIX_PATH_PATTERN.lastIndex = 0;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}
