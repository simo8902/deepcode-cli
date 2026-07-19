import React from "react";
import {Box, Newline, Text} from "ink";
import { renderMarkdown } from "./markdown";
import type { SessionMessage } from "../session";

type Props = {
  message: SessionMessage;
  collapsed?: boolean;
  busy?: boolean;
};

export function MessageView({ message, collapsed, busy }: Props): React.ReactElement | null {
  if (!message.visible) {
    return null;
  }

  // When busy, suppress thinking-fluff and tool status lines (footer has it)
  if (busy && (message.meta?.asThinking || message.role === "tool")) {
    return null;
  }

  if (message.role === "user") {
    const text = message.content || "(no content)";
    return (
      <Box  marginLeft={1} marginBottom={1} flexDirection="column" marginY={0}>
        <Box flexGrow={1} gap={1}>
          <Box><Text color="#229ac3">{`>`}</Text></Box>
          <Box flexGrow={1}>
            <Text color="#229ac3">{text}</Text>
            {Array.isArray(message.contentParams) && message.contentParams.length > 0 ? (
              <Text color="#229ac3">{`  📎 ${message.contentParams.length} image attachment(s)`}</Text>
            ) : null}
          </Box>
        </Box>
      </Box>
    );
  }

  if (message.role === "assistant") {
    const isThinking = Boolean(message.meta?.asThinking);
    const content = (message.content || "").trim();

    if (isThinking) {
      const summary = buildThinkingSummary(content, message.messageParams);
      if (collapsed !== false) {
        return (
          <Box marginLeft={1} marginY={0}>
            <StatusLine bulletColor="gray" name="Thinking" params={summary} />
          </Box>
        );
      }
      return (
        <Box marginLeft={1} flexDirection="column" marginY={0}>
          <StatusLine bulletColor="gray" name="Thinking" params={summary} />
          <Box flexDirection="column">
            {content ? <Text dimColor>{renderMarkdown(content)}</Text> : null}
          </Box>
        </Box>
      );
    }

    return (
      <Box marginLeft={1} marginBottom={1} flexGrow={1} gap={1} marginY={0}>
        <Box flexDirection="column" flexGrow={1}>
          {content ? <Text>{renderMarkdown(content)}</Text> : null}
        </Box>
      </Box>
    );
  }

  if (message.role === "tool") {
    const summary = buildToolSummary(message);
    const diffLines = getToolDiffPreviewLines(summary);
    return (
      <Box flexDirection="column" marginLeft={1} marginBottom={1} marginY={0}>
        <StatusLine
          bulletColor={summary.ok ? "green" : "red"}
          name={formatStatusName(summary.name)}
          params={formatToolStatusParams(summary)}
        />
        {diffLines.length > 0 ? <DiffPreview lines={diffLines} /> : null}
      </Box>
    );
  }

  if (message.role === "system") {
    if (message.meta?.skill) {
      return (
        <Box marginY={0} marginLeft={1} marginBottom={1}>
          <Text color="magenta">⚡ Loaded skill: {message.meta.skill.name}</Text>
        </Box>
      );
    }
    if (message.meta?.isSummary) {
      return (
        <Box marginY={0} marginLeft={1} marginBottom={1}>
          <Text dimColor italic>(conversation summary inserted)</Text>
        </Box>
      );
    }
    return null;
  }

  return null;
}

export const TOOL_SOURCE_BADGES: Record<string, { label: string; color: string }> = {
  // Filesystem MCP
  read_file: { label: "fs", color: "#64748b" },
  read_text_file: { label: "fs", color: "#64748b" },
  read_multiple_files: { label: "fs", color: "#64748b" },
  read_media_file: { label: "fs", color: "#64748b" },
  write_file: { label: "fs", color: "#64748b" },
  edit_file: { label: "fs", color: "#64748b" },
  create_directory: { label: "fs", color: "#64748b" },
  list_directory: { label: "fs", color: "#64748b" },
  list_directory_with_sizes: { label: "fs", color: "#64748b" },
  directory_tree: { label: "fs", color: "#64748b" },
  move_file: { label: "fs", color: "#64748b" },
  search_files: { label: "fs", color: "#64748b" },
  get_file_info: { label: "fs", color: "#64748b" },
  list_allowed_directories: { label: "fs", color: "#64748b" },
  // Codebase Memory MCP
  index_repository: { label: "cbm", color: "#f472b6" },
  index_status: { label: "cbm", color: "#f472b6" },
  list_projects: { label: "cbm", color: "#f472b6" },
  delete_project: { label: "cbm", color: "#f472b6" },
  search_graph: { label: "cbm", color: "#f472b6" },
  search_code: { label: "cbm", color: "#f472b6" },
  trace_path: { label: "cbm", color: "#f472b6" },
  detect_changes: { label: "cbm", color: "#f472b6" },
  query_graph: { label: "cbm", color: "#f472b6" },
  get_graph_schema: { label: "cbm", color: "#f472b6" },
  get_code_snippet: { label: "cbm", color: "#f472b6" },
  get_architecture: { label: "cbm", color: "#f472b6" },
  manage_adr: { label: "cbm", color: "#f472b6" },
  ingest_traces: { label: "cbm", color: "#f472b6" },
  // Serena
  restart_language_server: { label: "serena", color: "#38bdf8" },
  get_symbols_overview: { label: "serena", color: "#38bdf8" },
  find_symbol: { label: "serena", color: "#38bdf8" },
  find_referencing_symbols: { label: "serena", color: "#38bdf8" },
  find_implementations: { label: "serena", color: "#38bdf8" },
  find_declaration: { label: "serena", color: "#38bdf8" },
  get_diagnostics_for_file: { label: "serena", color: "#38bdf8" },
  get_diagnostics_for_symbol: { label: "serena", color: "#38bdf8" },
  replace_symbol_body: { label: "serena", color: "#38bdf8" },
  insert_after_symbol: { label: "serena", color: "#38bdf8" },
  insert_before_symbol: { label: "serena", color: "#38bdf8" },
  rename_symbol: { label: "serena", color: "#38bdf8" },
  safe_delete_symbol: { label: "serena", color: "#38bdf8" },
  list_memories: { label: "serena", color: "#38bdf8" },
  read_memory: { label: "serena", color: "#38bdf8" },
  write_memory: { label: "serena", color: "#38bdf8" },
  edit_memory: { label: "serena", color: "#38bdf8" },
  delete_memory: { label: "serena", color: "#38bdf8" },
  rename_memory: { label: "serena", color: "#38bdf8" },
  initial_instructions: { label: "serena", color: "#38bdf8" },
  check_onboarding_performed: { label: "serena", color: "#38bdf8" },
  onboarding: { label: "serena", color: "#38bdf8" },
  get_current_config: { label: "serena", color: "#38bdf8" },
  // Native
  ripgrep_search: { label: "rg", color: "#c084fc" },
  ast_grep_search: { label: "sg", color: "#c084fc" },
  AskUserQuestion: { label: "ask", color: "#fbbf24" },
  WebSearch: { label: "web", color: "#fbbf24" },
};

function getToolBadge(name: string): { label: string; color: string } {
  return TOOL_SOURCE_BADGES[name] ?? { label: "", color: "#f97316" };
}

function StatusLine({
  bulletColor,
  name,
  params
}: {
  bulletColor: "gray" | "green" | "red";
  name: string;
  params: string;
}): React.ReactElement {
  const badge = getToolBadge(name);
  return (
    <Text wrap="truncate-end" dimColor>
      {[
        badge.label ? <Text key="badge" color={badge.color}>{badge.label} › </Text> : null,
        <Text key="name" bold>{name}</Text>,
        params ? <Text key="params" color="gray">{`  ${params}`}</Text> : null
      ]}
    </Text>
  );
}

function formatToolStatusParams(summary: ToolSummary): string {
  // Suppress query display for WebSearch — keeps chat clean
  if (summary.name === "WebSearch") return "";
  const params = firstNonEmptyLine(summary.params);
  return params;
}

type ToolSummary = {
  name: string;
  params: string;
  ok: boolean;
  metadata: Record<string, unknown> | null;
};

type DiffPreviewLine = {
  marker: string;
  content: string;
  kind: "added" | "removed" | "context";
};

function buildToolSummary(message: SessionMessage): ToolSummary {
  const payload = parseToolPayload(message.content);
  const metaFunctionName =
    message.meta?.function && typeof (message.meta.function as { name?: unknown }).name === "string"
      ? (message.meta.function as { name: string }).name
      : null;
  const name = payload.name || metaFunctionName || "tool";
  const params = name === "AskUserQuestion"
    ? extractAskUserQuestionParams(message) || getMetaParams(message)
    : getMetaParams(message);

  return {
    name,
    params,
    ok: payload.ok !== false,
    metadata: payload.metadata
  };
}

function getMetaParams(message: SessionMessage): string {
  return typeof message.meta?.paramsMd === "string" ? message.meta.paramsMd.trim() : "";
}

function extractAskUserQuestionParams(message: SessionMessage): string {
  const fromFunction = extractQuestionsFromToolFunction(message.meta?.function);
  if (fromFunction) {
    return fromFunction;
  }

  const params = getMetaParams(message);
  if (!params) {
    return "";
  }

  try {
    const parsed = JSON.parse(params);
    return extractQuestionsFromValue(parsed);
  } catch {
    return "";
  }
}

function extractQuestionsFromToolFunction(toolFunction: unknown): string {
  if (!toolFunction || typeof toolFunction !== "object") {
    return "";
  }
  const args = (toolFunction as { arguments?: unknown }).arguments;
  if (typeof args !== "string" || !args.trim()) {
    return "";
  }
  try {
    const parsed = JSON.parse(args);
    return extractQuestionsFromValue((parsed as { questions?: unknown })?.questions);
  } catch {
    return "";
  }
}

function extractQuestionsFromValue(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return "";
      }
      return typeof (item as { question?: unknown }).question === "string"
        ? (item as { question: string }).question.trim()
        : "";
    })
    .filter(Boolean)
    .join(" / ");
}

function parseToolPayload(
  content: string | null
): { name: string | null; ok: boolean; metadata: Record<string, unknown> | null } {
  if (!content) {
    return { name: null, ok: true, metadata: null };
  }

  try {
    const parsed = JSON.parse(content) as { name?: unknown; ok?: unknown; metadata?: unknown };
    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : null,
      ok: parsed.ok !== false,
      metadata: isPlainRecord(parsed.metadata) ? parsed.metadata : null
    };
  } catch {
    return { name: null, ok: true, metadata: null };
  }
}

function getToolDiffPreviewLines(summary: ToolSummary): DiffPreviewLine[] {
  const DIFF_TOOLS = new Set(["edit", "write", "replace_content", "create_text_file"]);
  if (!summary.ok || !DIFF_TOOLS.has(summary.name.toLowerCase())) {
    return [];
  }
  const diffPreview = summary.metadata?.diff_preview;
  if (typeof diffPreview !== "string" || !diffPreview.trim()) {
    return [];
  }
  return parseDiffPreview(diffPreview);
}

export function parseDiffPreview(diffPreview: string): DiffPreviewLine[] {
  return diffPreview
    .split("\n")
    .filter((line) => line && !line.startsWith("--- ") && !line.startsWith("+++ ") && !line.startsWith("@@ "))
    .map((line) => {
      if (line.startsWith("+")) {
        return { marker: "+", content: line.slice(1), kind: "added" };
      }
      if (line.startsWith("-")) {
        return { marker: "-", content: line.slice(1), kind: "removed" };
      }
      return {
        marker: " ",
        content: line.startsWith(" ") ? line.slice(1) : line,
        kind: "context"
      };
    });
}

function DiffPreview({ lines }: { lines: DiffPreviewLine[] }): React.ReactElement {
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text dimColor>└ Changes</Text>
      <Box flexDirection="column" marginLeft={2}>
        {lines.map((line, index) => (
          <Text key={`${index}-${line.marker}-${line.content}`} wrap="truncate-end">
            <Text color={line.kind === "added" ? "green" : line.kind === "removed" ? "red" : "gray"}>
              {line.marker}
            </Text>
            <Text color={line.kind === "added" ? "green" : line.kind === "removed" ? "red" : undefined}>
              {line.content}
            </Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatStatusName(value: string): string {
  if (!value) return "Tool";
  return value;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

function firstNonEmptyLine(value: string): string {
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/\s+/g, " ");
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function buildThinkingSummary(content: string, messageParams: unknown | null): string {
  if (content) {
    const normalized = content.replace(/\r?\n/g, " ").replace(/\s+/g, " ");
    let result = truncate(normalized, 100);
    if (result.endsWith(":") || result.endsWith("：")) {
      result = result.slice(0, -1);
    }
    return result;
  }

  const params = messageParams as { reasoning_content?: unknown } | null | undefined;
  if (typeof params?.reasoning_content === "string" && params.reasoning_content.trim()) {
    return "(reasoning...)";
  }

  return "";
}
