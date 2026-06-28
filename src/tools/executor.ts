import type OpenAI from "openai";
import type { DataCollection, ProviderPrivacyMode, ReasoningEffort } from "../settings";
import { logWarn } from "../error-logger";
import { handleAskUserQuestionTool } from "./ask-user-question-handler";
import { handleRipgrepTool } from "./ripgrep-handler";
import { handleAstGrepTool } from "./ast-grep-handler";
import {
  handleCheckOnboardingPerformedTool,
  handleDeleteMemoryTool,
  handleEditMemoryTool,
  handleExecuteShellCommandTool,
  handleFindDeclarationTool,
  handleFindImplementationsTool,
  handleFindReferencingSymbolsTool,
  handleFindSymbolTool,
  handleGetCurrentConfigTool,
  handleGetDiagnosticsForFileTool,
  handleGetDiagnosticsForSymbolTool,
  handleGetSymbolsOverviewTool,
  handleInitialInstructionsTool,
  handleInsertAfterSymbolTool,
  handleInsertBeforeSymbolTool,
  handleListMemoriesTool,
  handleOnboardingTool,
  handleOpenDashboardTool,
  handleReadMemoryTool,
  handleRenameMemoryTool,
  handleRenameSymbolTool,
  handleReplaceSymbolBodyTool,
  handleRestartLanguageServerTool,
  handleSafeDeleteSymbolTool,
  handleWriteMemoryTool,
} from "./serena-handlers";
import { handleWebSearchTool } from "./web-search-handler";
import { registerIdaTools } from "./ida-handler";
import { registerCeTools } from "./ce-handler";
import { registerCodebaseMemoryTools } from "./codebase-memory-handler";
import { registerFilesystemTools } from "./filesystem-handler";

export type CreateOpenAIClient = () => {
  client: OpenAI | null;
  model: string;
  baseURL?: string;
  thinkingEnabled: boolean;
  reasoningEffort?: ReasoningEffort;
  debugLogEnabled?: boolean;
  notify?: string;
  webSearchTool?: string;
  machineId?: string;
  provider?: string;
  providerPrivacyMode?: ProviderPrivacyMode;
  zdr?: boolean;
  dataCollection?: DataCollection;
  cacheControl?: boolean;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ToolExecutionContext = {
  sessionId: string;
  projectRoot: string;
  toolCall: ToolCall;
  createOpenAIClient?: CreateOpenAIClient;
  onProcessStart?: (processId: string | number, command: string) => void;
  onProcessExit?: (processId: string | number) => void;
};

export type ToolExecutionHooks = {
  onProcessStart?: (processId: string | number, command: string) => void;
  onProcessExit?: (processId: string | number) => void;
  shouldStop?: () => boolean;
};

export type ToolExecutionResult = {
  ok: boolean;
  name: string;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  awaitUserResponse?: boolean;
  followUpMessages?: ToolExecutionFollowUpMessage[];
};

export type ToolExecutionFollowUpMessage = {
  role: "system";
  content: string;
  contentParams?: unknown | null;
};

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<ToolExecutionResult>;

export type ToolCallExecution = {
  toolCallId: string;
  content: string;
  result: ToolExecutionResult;
};

export class ToolExecutor {
  private readonly projectRoot: string;
  private readonly createOpenAIClient?: CreateOpenAIClient;
  private readonly toolHandlers = new Map<string, ToolHandler>();

  constructor(projectRoot: string, createOpenAIClient?: CreateOpenAIClient) {
    this.projectRoot = projectRoot;
    this.createOpenAIClient = createOpenAIClient;
    this.registerToolHandlers();
  }

  async executeToolCalls(
    sessionId: string,
    toolCalls: unknown[],
    hooks?: ToolExecutionHooks
  ): Promise<ToolCallExecution[]> {
    const seenIds = new Set<string>();
    const parsedCalls = toolCalls
      .map((toolCall) => this.parseToolCall(toolCall))
      .filter((toolCall): toolCall is ToolCall => {
        if (!toolCall) return false;
        if (seenIds.has(toolCall.id)) {
          logWarn({
            timestamp: new Date().toISOString(),
            location: "ToolExecutor.executeToolCalls",
            message: "Skipped duplicate tool_call_id before execution — would have produced duplicate tool result",
            sessionId,
            data: { duplicateToolCallId: toolCall.id, toolName: toolCall.function.name }
          });
          return false;
        }
        seenIds.add(toolCall.id);
        return true;
      });

    const executions: ToolCallExecution[] = [];
    for (const toolCall of parsedCalls) {
      if (hooks?.shouldStop?.()) {
        break;
      }
      const result = await this.executeToolCall(sessionId, toolCall, hooks);
      executions.push({
        toolCallId: toolCall.id,
        content: this.formatToolResult(result),
        result
      });
      if (hooks?.shouldStop?.()) {
        break;
      }
    }
    return executions;
  }

  private registerToolHandlers(): void {
    // 1. Filesystem MCP — all file I/O (read, write, edit, list, search, mkdir, move)
    registerFilesystemTools(this.toolHandlers, this.projectRoot);

    // 2. Serena — shell
    this.toolHandlers.set("execute_shell_command", handleExecuteShellCommandTool);

    // Serena — symbol tools
    this.toolHandlers.set("restart_language_server", handleRestartLanguageServerTool);
    this.toolHandlers.set("get_symbols_overview", handleGetSymbolsOverviewTool);
    this.toolHandlers.set("find_symbol", handleFindSymbolTool);
    this.toolHandlers.set("find_referencing_symbols", handleFindReferencingSymbolsTool);
    this.toolHandlers.set("find_implementations", handleFindImplementationsTool);
    this.toolHandlers.set("find_declaration", handleFindDeclarationTool);
    this.toolHandlers.set("get_diagnostics_for_file", handleGetDiagnosticsForFileTool);
    this.toolHandlers.set("get_diagnostics_for_symbol", handleGetDiagnosticsForSymbolTool);
    this.toolHandlers.set("replace_symbol_body", handleReplaceSymbolBodyTool);
    this.toolHandlers.set("insert_after_symbol", handleInsertAfterSymbolTool);
    this.toolHandlers.set("insert_before_symbol", handleInsertBeforeSymbolTool);
    this.toolHandlers.set("rename_symbol", handleRenameSymbolTool);
    this.toolHandlers.set("safe_delete_symbol", handleSafeDeleteSymbolTool);

    // Serena — memory tools
    this.toolHandlers.set("list_memories", handleListMemoriesTool);
    this.toolHandlers.set("read_memory", handleReadMemoryTool);
    this.toolHandlers.set("write_memory", handleWriteMemoryTool);
    this.toolHandlers.set("edit_memory", handleEditMemoryTool);
    this.toolHandlers.set("delete_memory", handleDeleteMemoryTool);
    this.toolHandlers.set("rename_memory", handleRenameMemoryTool);

    // Serena — workflow tools
    this.toolHandlers.set("initial_instructions", handleInitialInstructionsTool);
    this.toolHandlers.set("check_onboarding_performed", handleCheckOnboardingPerformedTool);
    this.toolHandlers.set("onboarding", handleOnboardingTool);

    // Serena — config tools
    this.toolHandlers.set("open_dashboard", handleOpenDashboardTool);
    this.toolHandlers.set("get_current_config", handleGetCurrentConfigTool);

    // Native search tools
    this.toolHandlers.set("ripgrep_search", handleRipgrepTool);
    this.toolHandlers.set("ast_grep_search", handleAstGrepTool);

    // IDA Pro MCP tools (dynamically discovered)
    registerIdaTools(this.toolHandlers);

    // Cheat Engine MCP tools (dynamically discovered)
    registerCeTools(this.toolHandlers);

    // codebase-memory-mcp tools (dynamically discovered)
    registerCodebaseMemoryTools(this.toolHandlers);

    // Non-Serena tools
    this.toolHandlers.set("AskUserQuestion", handleAskUserQuestionTool);
    this.toolHandlers.set("WebSearch", handleWebSearchTool);
  }

  refreshIdaTools(): void {
    registerIdaTools(this.toolHandlers);
  }

  refreshCeTools(): void {
    registerCeTools(this.toolHandlers);
  }

  refreshCodebaseMemoryTools(): void {
    registerCodebaseMemoryTools(this.toolHandlers);
  }

  refreshFilesystemTools(): void {
    registerFilesystemTools(this.toolHandlers, this.projectRoot);
  }

  private parseToolCall(toolCall: unknown): ToolCall | null {
    if (!toolCall || typeof toolCall !== "object") {
      return null;
    }

    const record = toolCall as {
      id?: unknown;
      type?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };

    if (typeof record.id !== "string") {
      return null;
    }

    const functionRecord = record.function;
    if (!functionRecord || typeof functionRecord !== "object") {
      return null;
    }

    if (typeof functionRecord.name !== "string") {
      return null;
    }

    const rawArguments =
      typeof functionRecord.arguments === "string" ? functionRecord.arguments : "";

    return {
      id: record.id,
      type: "function",
      function: {
        name: functionRecord.name,
        arguments: rawArguments
      }
    };
  }

  private async executeToolCall(
    sessionId: string,
    toolCall: ToolCall,
    hooks?: ToolExecutionHooks
  ): Promise<ToolExecutionResult> {
    const toolName = toolCall.function.name;
    const handler = this.toolHandlers.get(toolName);
    if (!handler) {
      return {
        ok: false,
        name: toolName,
        error: `Unknown tool: ${toolName}`
      };
    }

    const parsedArgs = this.parseToolArguments(toolCall.function.arguments);
    if (!parsedArgs.ok) {
      return {
        ok: false,
        name: toolName,
        error: parsedArgs.error
      };
    }

    try {
      return await handler(parsedArgs.args, {
        sessionId,
        projectRoot: this.projectRoot,
        toolCall,
        createOpenAIClient: this.createOpenAIClient,
        onProcessStart: hooks?.onProcessStart,
        onProcessExit: hooks?.onProcessExit
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        name: toolName,
        error: message
      };
    }
  }

  private parseToolArguments(
    rawArguments: string
  ): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
    if (!rawArguments) {
      return { ok: true, args: {} };
    }

    try {
      const parsed = JSON.parse(rawArguments);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, error: "InputParseError: Tool arguments must be a JSON object." };
      }
      return { ok: true, args: parsed as Record<string, unknown> };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error:
          `InputParseError: Failed to parse tool arguments: ${message}. ` +
          "Ensure the tool call arguments are valid JSON. Prefer Edit over Write for large existing-file changes."
      };
    }
  }

  private formatToolResult(result: ToolExecutionResult): string {
    const payload: Record<string, unknown> = {
      ok: result.ok,
      name: result.name
    };

    if (typeof result.output !== "undefined") {
      payload.output = result.output;
    }

    if (result.error) {
      payload.error = result.error;
    }

    if (result.metadata && Object.keys(result.metadata).length > 0) {
      payload.metadata = result.metadata;
    }

    if (result.awaitUserResponse === true) {
      payload.awaitUserResponse = true;
    }

    return JSON.stringify(payload, null, 2);
  }

}
