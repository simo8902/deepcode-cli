import type OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import type { DataCollection, NativeLlamaCppSettings, ProviderPrivacyMode, ReasoningEffort } from "../settings";
import { isApprovalResponse, type GroundingContract } from "../grounding";
import { logWarn } from "../error-logger";
import { handleAskUserQuestionTool } from "./ask-user-question-handler";
import { handleRipgrepTool } from "./ripgrep-handler";
import { handleAstGrepTool } from "./ast-grep-handler";
import {
  handleCheckOnboardingPerformedTool,
  handleDeleteMemoryTool,
  handleEditMemoryTool,
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
  handleReadMemoryTool,
  handleRenameMemoryTool,
  handleRenameSymbolTool,
  handleReplaceSymbolBodyTool,
  handleRestartLanguageServerTool,
  handleSafeDeleteSymbolTool,
  handleWriteMemoryTool,
} from "./serena-handlers";
import { handleExecuteShellCommandTool } from "./shell-handler";
import { handleWebSearchTool } from "./web-search-handler";
import { registerIdaTools } from "./ida-handler";
import { registerCeTools } from "./ce-handler";
import { registerFilesystemTools } from "./filesystem-handler";
import { registerHermesTools } from "./hermes-handler";
import { getCodebaseMemoryHealth, registerCodebaseMemoryTools } from "./codebase-memory-handler";

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
  temperature?: number;
  topP?: number;
  repetitionPenalty?: number;
  nativeLlamaCpp?: NativeLlamaCppSettings;
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
  onToolCall?: (toolName: string, params: string) => void;
  shouldStop?: () => boolean;
  grounding?: GroundingContract | null;
  approvedToolCallIds?: Set<string>;
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

export type ToolRegistrationConflictHandler = (toolName: string) => void;

export type ToolCallExecution = {
  toolCallId: string;
  content: string;
  result: ToolExecutionResult;
};

type ArchitectureGateState = {
  projectsListed: boolean;
  indexStatusChecked: boolean;
  indexReady: boolean;
  architectureMapped: boolean;
  serenaInitialized: boolean;
  fallbackApproved: boolean;
};

export type ArchitectureGateResumeState = true;

type PendingApproval = {
  fingerprint: string;
  description: string;
  approved: boolean;
  toolCall: ToolCall;
  kind: "side_effect" | "architecture_fallback";
};

export type ApprovedToolCall = {
  toolCall: ToolCall;
  kind: PendingApproval["kind"];
};

export class ToolExecutor {
  private readonly projectRoot: string;
  private readonly createOpenAIClient?: CreateOpenAIClient;
  private readonly toolHandlers = new Map<string, ToolHandler>();
  private readonly toolHandlerSources = new Map<string, string>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly architectureGates = new Map<string, ArchitectureGateState>();

  constructor(projectRoot: string, createOpenAIClient?: CreateOpenAIClient) {
    this.projectRoot = projectRoot;
    this.createOpenAIClient = createOpenAIClient;
    this.registerToolHandlers();
  }

  recordUserPrompt(sessionId: string, text: string): void {
    const pending = this.pendingApprovals.get(sessionId);
    if (!pending) return;

    if (isApprovalResponse(text)) {
      pending.approved = true;
      if (pending.kind === "architecture_fallback") {
        this.getArchitectureGate(sessionId).fallbackApproved = true;
      }
      return;
    }

    if (/\b(?:no|nope|cancel|stop|decline|abort)\b/i.test(text)) {
      this.pendingApprovals.delete(sessionId);
    }
  }

  takeApprovedToolCall(sessionId: string): ApprovedToolCall | null {
    const pending = this.pendingApprovals.get(sessionId);
    if (!pending?.approved) return null;
    this.pendingApprovals.delete(sessionId);
    return { toolCall: pending.toolCall, kind: pending.kind };
  }

  isArchitectureGateComplete(sessionId: string): boolean {
    const state = this.architectureGates.get(sessionId);
    return state?.projectsListed === true
      && state.indexStatusChecked === true
      && state.indexReady === true
      && state.architectureMapped === true
      && state.serenaInitialized === true
      && state.fallbackApproved === false;
  }

  restoreCompletedArchitectureGate(sessionId: string, state: unknown): void {
    if (state !== true) return;
    this.architectureGates.set(sessionId, {
      projectsListed: true,
      indexStatusChecked: true,
      indexReady: true,
      architectureMapped: true,
      serenaInitialized: true,
      fallbackApproved: false
    });
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
      hooks?.onToolCall?.(toolCall.function.name, toolCall.function.arguments || "");

      const architectureBlock = this.checkArchitectureGate(sessionId, toolCall, hooks?.grounding ?? null);
      if (architectureBlock) {
        executions.push({
          toolCallId: toolCall.id,
          content: this.formatToolResult(architectureBlock),
          result: architectureBlock
        });
        break;
      }

      if (
        this.isPersistentMemoryWriteTool(toolCall.function.name) &&
        hooks?.grounding?.persistentMemoryWriteAuthorized !== true &&
        !hooks?.approvedToolCallIds?.has(toolCall.id)
      ) {
        const blocked = this.blockUnauthorizedMemoryWrite(toolCall.function.name);
        executions.push({
          toolCallId: toolCall.id,
          content: this.formatToolResult(blocked),
          result: blocked
        });
        break;
      }

      const parsedToolArgs = this.parseToolArguments(toolCall.function.arguments);
      if (hooks?.grounding?.sideEffectConfirmationRequired !== false && this.requiresConfirmation(
        toolCall.function.name,
        parsedToolArgs.ok ? parsedToolArgs.args : undefined
      ) && !hooks?.approvedToolCallIds?.has(toolCall.id)) {
        const gated = this.confirmOrAllowToolCall(sessionId, toolCall, hooks?.grounding ?? null);
        if (gated) {
          executions.push({
            toolCallId: toolCall.id,
            content: this.formatToolResult(gated),
            result: gated
          });
          break;
        }
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

  private getArchitectureGate(sessionId: string): ArchitectureGateState {
    const existing = this.architectureGates.get(sessionId);
    if (existing) return existing;
    const state: ArchitectureGateState = {
      projectsListed: false,
      indexStatusChecked: false,
      indexReady: false,
      architectureMapped: false,
      serenaInitialized: false,
      fallbackApproved: false
    };
    this.architectureGates.set(sessionId, state);
    return state;
  }

  private checkArchitectureGate(
    sessionId: string,
    toolCall: ToolCall,
    grounding: GroundingContract | null
  ): ToolExecutionResult | null {
    if (grounding?.architectureMappingRequired !== true) return null;

    const toolName = toolCall.function.name;
    const state = this.getArchitectureGate(sessionId);
    if (state.fallbackApproved) return null;

    if (toolName === "initial_instructions") {
      return null;
    }

    if (toolName === "list_projects") {
      return null;
    }

    if (toolName === "index_status") {
      if (!state.projectsListed) {
        return this.architectureSequenceError(toolName, "Call list_projects first and identify the project matching the current workspace root.");
      }
      return null;
    }

    if (toolName === "index_repository") {
      if (!state.indexStatusChecked) {
        return this.architectureSequenceError(toolName, "Call index_status before indexing. Do not guess the project or repository state.");
      }
      return null;
    }

    if (toolName === "get_architecture") {
      if (!state.indexStatusChecked) {
        return this.architectureSequenceError(toolName, "Call list_projects and index_status before requesting architecture.");
      }
      if (!state.indexReady) {
        return this.architectureSequenceError(toolName, "The index status was missing, stale, or unclear. Run index_repository with the current workspace root and mode=full first.");
      }
      return null;
    }

    if (this.isCodebaseOrientationTool(toolName)) {
      if (!state.indexStatusChecked || !state.indexReady) {
        return this.architectureSequenceError(toolName, "Complete list_projects, index_status, and full indexing when required before graph queries.");
      }
      return null;
    }

    if (this.isSerenaSemanticTool(toolName)) {
      if (!state.serenaInitialized) {
        return this.architectureSequenceError(toolName, "Call Serena initial_instructions for the current project before semantic symbol work.");
      }
      if (!state.architectureMapped) {
        const health = getCodebaseMemoryHealth(this.projectRoot);
        if (!health.ready) {
          return this.architectureFallbackQuestion(sessionId, toolCall, health.error ?? "Codebase Memory is unavailable.");
        }
        return this.architectureSequenceError(toolName, "Complete Codebase Memory architecture mapping with get_architecture before Serena symbol work.");
      }
    }

    return null;
  }

  private isCodebaseOrientationTool(toolName: string): boolean {
    return /^(?:get_graph_schema|search_graph|search_code|trace_path|query_graph|detect_changes|get_code_snippet)$/i.test(toolName);
  }

  private isSerenaSemanticTool(toolName: string): boolean {
    return /^(?:get_symbols_overview|find_symbol|find_referencing_symbols|find_implementations|find_declaration|get_diagnostics_for_file|get_diagnostics_for_symbol|replace_symbol_body|insert_after_symbol|insert_before_symbol|rename_symbol|safe_delete_symbol)$/i.test(toolName);
  }

  private architectureSequenceError(toolName: string, reason: string): ToolExecutionResult {
    return {
      ok: false,
      name: toolName,
      error: `Architecture gate blocked this tool call. ${reason}`,
      metadata: {
        architectureGate: true,
        verified: false
      },
      followUpMessages: [
        {
          role: "system",
          content: "The host enforces the C/C++ architecture sequence. Follow the required Codebase Memory and Serena orientation order; do not claim the project was mapped until those tools return successfully."
        }
      ]
    };
  }

  private architectureFallbackQuestion(
    sessionId: string,
    toolCall: ToolCall,
    reason: string
  ): ToolExecutionResult {
    const fingerprint = this.buildToolFingerprint(toolCall);
    const description = this.describeToolCall(toolCall);
    this.pendingApprovals.set(sessionId, {
      fingerprint,
      description,
      approved: false,
      toolCall,
      kind: "architecture_fallback"
    });
    return {
      ok: false,
      name: toolCall.function.name,
      error: `Codebase Memory is unavailable: ${reason}`,
      awaitUserResponse: true,
      metadata: {
        kind: "ask_user_question",
        architectureGate: true,
        questions: [
          {
            question: `The architecture/index prerequisite is unavailable (${reason}). Continue with limited Serena-only discovery for this exact action?\n\n${description}`,
            options: [
              { label: "Continue with limited Serena only", description: "Proceed without claiming that Codebase Memory architecture mapping succeeded." },
              { label: "Cancel", description: "Stop until the index prerequisite is available." }
            ]
          }
        ]
      },
      followUpMessages: [
        {
          role: "system",
          content: "The user must explicitly approve limited Serena-only fallback. If approved, execute only the exact blocked tool call and state that Codebase Memory mapping was unavailable."
        }
      ]
    };
  }

  private requiresConfirmation(toolName: string, args?: Record<string, unknown>): boolean {
    if (toolName === "AskUserQuestion" || toolName === "WebSearch") return false;
    if (toolName === "ripgrep_search" || toolName === "ast_grep_search") return false;
    if (toolName === "skills_list" || toolName === "skill_view" || toolName === "list_projects" || toolName === "get_current_config" || toolName === "check_onboarding_performed") return false;
    if (toolName === "execute_shell_command") return !this.isSafeShellProbe(args?.command);
    if (/^(?:read|list|search|get|find|trace|query|detect|check|index_status|initial_instructions|get_graph_schema|get_architecture)/i.test(toolName)) {
      return false;
    }
    return true;
  }

  private isSafeShellProbe(command: unknown): boolean {
    if (typeof command !== "string") return false;
    return /^(?:bun|cmake|git|go|java|javac|node|npm|npx|python|python3|rustc|cargo|dotnet|gcc|g\+\+|clang|clang\+\+)\s+(?:--version|-version|-V|-v|version)\s*$/i.test(command.trim());
  }

  private isPersistentMemoryWriteTool(toolName: string): boolean {
    return /^(?:write|edit|delete|rename)_memory$/i.test(toolName);
  }

  private blockUnauthorizedMemoryWrite(toolName: string): ToolExecutionResult {
    return {
      ok: false,
      name: toolName,
      error: "Host blocked persistent-memory writes because the user did not explicitly ask to remember or store this information.",
      metadata: {
        sideEffect: true,
        verification: {
          required: true,
          verified: false,
          status: "blocked_by_memory_policy"
        }
      },
      followUpMessages: [
        {
          role: "system",
          content: "Do not retry persistent-memory writes for ordinary corrections, feedback, temporary task state, or routine project context. Continue the task without saving memory unless the user explicitly asks to remember it."
        }
      ]
    };
  }

  private confirmOrAllowToolCall(
    sessionId: string,
    toolCall: ToolCall,
    grounding: GroundingContract | null
  ): ToolExecutionResult | null {
    const fingerprint = this.buildToolFingerprint(toolCall);
    const pending = this.pendingApprovals.get(sessionId);

    if (pending?.fingerprint === fingerprint && pending.approved) {
      this.pendingApprovals.delete(sessionId);
      return null;
    }

    const description = this.describeToolCall(toolCall);
    this.pendingApprovals.set(sessionId, {
      fingerprint,
      description,
      approved: false,
      toolCall,
      kind: "side_effect"
    });
    const request = grounding?.request || "the current request";
    const question = `I identified this exact side-effecting action for ${request}:\n\n${description}\n\nMay I execute it?`;
    const metadata = {
      kind: "ask_user_question",
      sideEffect: true,
      verification: {
        required: true,
        verified: false,
        status: "pending_confirmation"
      },
      approval: {
        fingerprint,
        toolName: toolCall.function.name
      },
      questions: [
        {
          question,
          options: [
            { label: "Proceed with this exact action", description: "Run only the action shown above." },
            { label: "Cancel", description: "Do not execute it; I will revise the request." }
          ]
        }
      ]
    };

    return {
      ok: false,
      name: toolCall.function.name,
      error: "Host policy blocked this side-effecting action until the user confirms the exact action.",
      awaitUserResponse: true,
      metadata,
      followUpMessages: [
        {
          role: "system",
          content: "The host blocked the side-effecting tool call pending explicit user confirmation. Do not claim that it ran. After confirmation, the host will replay the exact stored tool call; do not substitute a different command, path, format, or target."
        }
      ]
    };
  }

  private buildToolFingerprint(toolCall: ToolCall): string {
    let args: unknown = toolCall.function.arguments || "";
    try {
      args = JSON.parse(toolCall.function.arguments || "{}");
    } catch {
      // Keep malformed arguments in the fingerprint so confirmation never
      // accidentally approves a different call.
    }
    return `${toolCall.function.name}:${JSON.stringify(this.sortObject(args))}`;
  }

  private sortObject(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.sortObject(item));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, this.sortObject(item)])
    );
  }

  private describeToolCall(toolCall: ToolCall): string {
    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(toolCall.function.arguments || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        args = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      return `${toolCall.function.name} (arguments were not valid JSON)`;
    }

    for (const key of ["content", "newText", "oldText"]) {
      if (key in args) args[key] = `[${key} omitted from confirmation preview]`;
    }
    const rendered = JSON.stringify(args, null, 2);
    return `${toolCall.function.name}\n${rendered.length > 4000 ? rendered.slice(0, 4000) + "\n... (truncated)" : rendered}`;
  }

  private registerToolHandlers(): void {
    // 1. Filesystem MCP — all file I/O (read, write, edit, list, search, mkdir, move)
    this.registerBackendTools("filesystem MCP", (onConflict) =>
      registerFilesystemTools(this.toolHandlers, this.projectRoot, onConflict)
    );

    // 2. Shell — native (no Serena/Python dependency)
    this.registerToolHandler("execute_shell_command", handleExecuteShellCommandTool, "native shell");

    // Serena — symbol tools
    this.registerToolHandler("restart_language_server", handleRestartLanguageServerTool, "Serena");
    this.registerToolHandler("get_symbols_overview", handleGetSymbolsOverviewTool, "Serena");
    this.registerToolHandler("find_symbol", handleFindSymbolTool, "Serena");
    this.registerToolHandler("find_referencing_symbols", handleFindReferencingSymbolsTool, "Serena");
    this.registerToolHandler("find_implementations", handleFindImplementationsTool, "Serena");
    this.registerToolHandler("find_declaration", handleFindDeclarationTool, "Serena");
    this.registerToolHandler("get_diagnostics_for_file", handleGetDiagnosticsForFileTool, "Serena");
    this.registerToolHandler("get_diagnostics_for_symbol", handleGetDiagnosticsForSymbolTool, "Serena");
    this.registerToolHandler("replace_symbol_body", handleReplaceSymbolBodyTool, "Serena");
    this.registerToolHandler("insert_after_symbol", handleInsertAfterSymbolTool, "Serena");
    this.registerToolHandler("insert_before_symbol", handleInsertBeforeSymbolTool, "Serena");
    this.registerToolHandler("rename_symbol", handleRenameSymbolTool, "Serena");
    this.registerToolHandler("safe_delete_symbol", handleSafeDeleteSymbolTool, "Serena");

    // Serena — memory tools
    this.registerToolHandler("list_memories", handleListMemoriesTool, "Serena");
    this.registerToolHandler("read_memory", handleReadMemoryTool, "Serena");
    this.registerToolHandler("write_memory", handleWriteMemoryTool, "Serena");
    this.registerToolHandler("edit_memory", handleEditMemoryTool, "Serena");
    this.registerToolHandler("delete_memory", handleDeleteMemoryTool, "Serena");
    this.registerToolHandler("rename_memory", handleRenameMemoryTool, "Serena");

    // Serena — workflow tools
    this.registerToolHandler("initial_instructions", handleInitialInstructionsTool, "Serena");
    this.registerToolHandler("check_onboarding_performed", handleCheckOnboardingPerformedTool, "Serena");
    this.registerToolHandler("onboarding", handleOnboardingTool, "Serena");

    // Serena — config tools
    this.registerToolHandler("get_current_config", handleGetCurrentConfigTool, "Serena");

    // Native search tools
    this.registerToolHandler("ripgrep_search", handleRipgrepTool, "native search");
    this.registerToolHandler("ast_grep_search", handleAstGrepTool, "native search");

    // IDA Pro MCP tools (dynamically discovered)
    this.registerBackendTools("IDA Pro MCP", (onConflict) => registerIdaTools(this.toolHandlers, onConflict));

    // Cheat Engine MCP tools (dynamically discovered)
    this.registerBackendTools("Cheat Engine MCP", (onConflict) => registerCeTools(this.toolHandlers, onConflict));

    // Hermes Agent MCP tools (memory, skills, skill_manage)
    this.registerBackendTools("Hermes MCP", (onConflict) => registerHermesTools(this.toolHandlers, onConflict));

    // Codebase Memory MCP tools (opt-in; heavyweight indexing)
    this.registerBackendTools("Codebase Memory MCP", (onConflict) =>
      registerCodebaseMemoryTools(this.toolHandlers, this.projectRoot, onConflict)
    );


    // Non-Serena tools
    this.registerToolHandler("AskUserQuestion", handleAskUserQuestionTool, "native interaction");
    this.registerToolHandler("WebSearch", handleWebSearchTool, "native web search");
  }

  refreshIdaTools(): void {
    this.registerBackendTools("IDA Pro MCP", (onConflict) => registerIdaTools(this.toolHandlers, onConflict));
  }

  refreshCeTools(): void {
    this.registerBackendTools("Cheat Engine MCP", (onConflict) => registerCeTools(this.toolHandlers, onConflict));
  }

  refreshFilesystemTools(): void {
    this.registerBackendTools("filesystem MCP", (onConflict) =>
      registerFilesystemTools(this.toolHandlers, this.projectRoot, onConflict)
    );
  }

  refreshHermesTools(): void {
    this.registerBackendTools("Hermes MCP", (onConflict) => registerHermesTools(this.toolHandlers, onConflict));
  }

  refreshCodebaseMemoryTools(): void {
    this.registerBackendTools("Codebase Memory MCP", (onConflict) =>
      registerCodebaseMemoryTools(this.toolHandlers, this.projectRoot, onConflict)
    );
  }

  getToolHandlerSource(toolName: string): string | null {
    return this.toolHandlerSources.get(toolName) ?? null;
  }

  private registerToolHandler(toolName: string, handler: ToolHandler, source: string): void {
    if (this.toolHandlers.has(toolName)) {
      this.reportToolHandlerCollision(toolName, source);
      return;
    }
    this.toolHandlers.set(toolName, handler);
    this.toolHandlerSources.set(toolName, source);
  }

  private registerBackendTools(
    source: string,
    register: (onConflict: ToolRegistrationConflictHandler) => void
  ): void {
    const namesBeforeRegistration = new Set(this.toolHandlers.keys());
    register((toolName) => {
      if (this.toolHandlerSources.get(toolName) !== source) {
        this.reportToolHandlerCollision(toolName, source);
      }
    });
    for (const toolName of this.toolHandlers.keys()) {
      if (!namesBeforeRegistration.has(toolName)) {
        this.toolHandlerSources.set(toolName, source);
      }
    }
  }

  private reportToolHandlerCollision(toolName: string, incomingSource: string): void {
    const existingSource = this.toolHandlerSources.get(toolName) ?? "an earlier registration";
    logWarn({
      timestamp: new Date().toISOString(),
      location: "ToolExecutor.registerToolHandlers",
      message: "Tool handler collision detected; keeping the first registered handler.",
      data: { toolName, existingSource, incomingSource }
    });
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
      return this.verifyToolResult(toolName, {}, {
        ok: false,
        name: toolName,
        error: `Unknown tool: ${toolName}`
      });
    }

    const parsedArgs = this.parseToolArguments(toolCall.function.arguments);
    if (!parsedArgs.ok) {
      return this.verifyToolResult(toolName, {}, {
        ok: false,
        name: toolName,
        error: parsedArgs.error
      });
    }

    try {
      const result = await handler(parsedArgs.args, {
        sessionId,
        projectRoot: this.projectRoot,
        toolCall,
        createOpenAIClient: this.createOpenAIClient,
        onProcessStart: hooks?.onProcessStart,
        onProcessExit: hooks?.onProcessExit
      });
      const verifiedResult = this.verifyToolResult(toolName, parsedArgs.args, result);
      this.advanceArchitectureGate(sessionId, toolName, verifiedResult);
      return verifiedResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.verifyToolResult(toolName, {}, {
        ok: false,
        name: toolName,
        error: message
      });
    }
  }

  private advanceArchitectureGate(sessionId: string, toolName: string, result: ToolExecutionResult): void {
    if (!result.ok) return;
    const state = this.architectureGates.get(sessionId);
    if (!state) return;

    if (toolName === "initial_instructions") {
      state.serenaInitialized = true;
    } else if (toolName === "list_projects") {
      state.projectsListed = true;
    } else if (toolName === "index_status") {
      state.indexStatusChecked = true;
      state.indexReady = this.isFreshIndexReport(result.output);
    } else if (toolName === "index_repository") {
      state.indexReady = true;
    } else if (toolName === "get_architecture") {
      state.architectureMapped = true;
    }
  }

  private isFreshIndexReport(output: string | undefined): boolean {
    const text = (output ?? "").toLowerCase();
    if (!text) return false;
    if (/(?:stale|missing|not indexed|no index|indexing|in progress|failed|failure|error|not found)/i.test(text)) {
      return false;
    }
    if (/(?:indexed|ready|fresh|current|complete|healthy)\s*["']?\s*[:=]\s*(?:false|0|no)\b/i.test(text)) {
      return false;
    }
    return /(?:indexed|ready|fresh|current|complete|up[- ]to[- ]date|healthy)/i.test(text);
  }

  private verifyToolResult(
    toolName: string,
    args: Record<string, unknown>,
    result: ToolExecutionResult
  ): ToolExecutionResult {
    if (!this.requiresConfirmation(toolName, args)) return result;

    const metadata: Record<string, unknown> = { ...(result.metadata ?? {}), sideEffect: true };
    if (!result.ok) {
      metadata.verification = {
        required: true,
        verified: false,
        status: "failed",
        reason: result.error ?? "The side-effecting tool reported failure."
      };
      return { ...result, metadata };
    }

    if (toolName === "execute_shell_command") {
      const exitCode = metadata.exitCode;
      const verified = exitCode === 0;
      metadata.verification = {
        required: true,
        verified,
        status: verified ? "verified" : "failed",
        source: "host_checked_exit_code",
        exitCode
      };
      return { ...result, metadata };
    }

    const candidatePath = this.resolveVerificationPath(args);
    if (!candidatePath) {
      metadata.verification = {
        required: true,
        verified: true,
        status: "verified",
        source: "tool_result",
        note: "The tool returned success and did not expose a host-checkable path."
      };
      return { ...result, metadata };
    }

    const exists = fs.existsSync(candidatePath);
    let verified = exists;
    let note = exists ? "Expected path exists after the action." : "Expected path is missing after the action.";

    if (toolName === "write_file" && typeof args.content === "string" && exists) {
      try {
        verified = fs.readFileSync(candidatePath, "utf8") === args.content;
        note = verified ? "Written file content matches the requested content." : "Written file content does not match the requested content.";
      } catch (error) {
        verified = false;
        note = `Host could not read the written file: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    if (toolName === "edit_file" && Array.isArray(args.edits) && exists) {
      try {
        const actual = fs.readFileSync(candidatePath, "utf8");
        const edits = args.edits.filter((edit): edit is Record<string, unknown> => Boolean(edit && typeof edit === "object" && !Array.isArray(edit)));
        verified = edits.every((edit) => {
          const newText = typeof edit.newText === "string" ? edit.newText : "";
          const oldText = typeof edit.oldText === "string" ? edit.oldText : "";
          return newText ? actual.includes(newText) : !oldText || !actual.includes(oldText);
        });
        note = verified ? "Edited file contains the requested replacement text." : "Edited file does not contain the requested replacement text.";
      } catch (error) {
        verified = false;
        note = `Host could not read the edited file: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    if (toolName === "create_directory") {
      try {
        verified = exists && fs.statSync(candidatePath).isDirectory();
      } catch {
        verified = false;
      }
      note = verified ? "Expected directory exists after the action." : "Expected directory is missing after the action.";
    }

    if (/^(?:delete|remove)/i.test(toolName)) {
      verified = !exists;
      note = verified ? "Expected path is absent after deletion." : "Expected path still exists after deletion.";
    }

    metadata.verification = {
      required: true,
      verified,
      status: verified ? "verified" : "failed",
      source: "host_checked_filesystem",
      path: candidatePath,
      note
    };
    return {
      ...result,
      metadata,
      ...(verified ? {} : { ok: false, error: `${result.error ? result.error + " " : ""}${note}` })
    };
  }

  private resolveVerificationPath(args: Record<string, unknown>): string | null {
    const raw = [args.path, args.destination, args.target, args.relative_path, args.file_path]
      .find((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (!raw) return null;
    return path.isAbsolute(raw) ? raw : path.resolve(this.projectRoot, raw);
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
