import { execFileSync, execSync } from "child_process";
import * as os from "os";
import * as path from "path";
import type { SessionMessage } from "./session";
import type { AssistantTone } from "./settings";

export const AGENT_DRIFT_GUARD_SKILL = `
---
name: agent-drift-guard
description: Detect and correct execution drift while working on user requests. Use when you are actively implementing, debugging, reviewing, or investigating and there is a risk of wandering beyond the user's goal, adding unrequested work, touching live systems, over-exploring, or ignoring repeated user boundary corrections. Especially useful during multi-step coding tasks, production-adjacent requests, ambiguous scopes, and anytime you should self-check whether it is still solving the requested problem.
---

# Agent Drift Guard

Keep execution tightly aligned with the user's actual request.

## Quick Start

Run this mental check before substantial work and again whenever the plan expands:

1. State the user's requested outcome in one sentence.
2. List explicit non-goals or boundaries the user has set.
3. Ask whether the next action directly advances the requested outcome.
4. If not, either cut it or pause to confirm.

## Drift Signals

Treat these as warning signs that execution may be drifting:

- Exploring broadly before opening the most relevant file, command, or artifact.
- Solving adjacent operational issues when the user asked only for code changes.
- Adding extra safeguards, scripts, docs, refactors, or cleanup that the user did not ask for.
- Reframing the task around what seems "better" instead of what was requested.
- Continuing with a broader plan after the user narrows the scope.
- Repeating searches or tool calls without increasing certainty.
- Mixing diagnosis, remediation, and feature work when the user asked for only one of them.
- Touching production-like state, external systems, or live data without explicit permission.

## Severity Levels

### Level 1: Mild Drift

Examples:
- One or two extra exploratory commands.
- Considering a broader solution but not acting on it yet.
- Briefly over-explaining instead of moving the task forward.

Response:
- Auto-correct silently.
- Narrow to the smallest next action.
- Do not interrupt the user.

### Level 2: Material Drift

Examples:
- Planning additional deliverables not requested.
- Writing helper scripts, migrations, docs, or tests outside the asked scope.
- Expanding from code changes into operational fixes.
- Continuing after the user has already corrected the scope once.

Response:
- Stop and realign internally first.
- If the broader action is avoidable, drop it and continue on scope.
- If the broader action has non-obvious tradeoffs, ask a brief confirmation question.

### Level 3: Boundary or Risk Violation

Examples:
- Modifying live systems, production data, external services, or user-owned state without being asked.
- Taking destructive or hard-to-reverse actions outside the requested scope.
- Ignoring repeated user instructions about what not to do.

Response:
- Pause before acting.
- Surface the exact boundary and ask for confirmation.
- Offer the smallest on-scope option first.

## Self-Check Loop

Use this loop during execution:

### Before the first meaningful action

Write down mentally:
- Requested outcome
- Allowed scope
- Forbidden scope
- Smallest useful next step

### After each non-trivial step

Ask:
- Did this step directly help deliver the requested outcome?
- Did I learn something that changes scope, or only implementation?
- Am I about to do more than the user asked?

### After a user correction

Treat the correction as a hard boundary update.

Then:
- Remove the old broader plan.
- Do not defend the discarded work.
- Continue from the narrowed scope.
- If needed, acknowledge briefly and move on.

## Decision Rules

Use these rules in order:

1. Prefer the most direct artifact first.
   - Open the relevant file before scanning the whole repo.
   - Inspect the specific failing path before designing a general framework.

2. Prefer the smallest complete fix.
   - Solve the asked problem before improving related systems.
   - Avoid bonus work unless it is required for correctness.

3. Prefer internal correction over user interruption.
   - If you can shrink back to scope confidently, do it.
   - Ask only when the next step changes deliverables, risk, or ownership.

4. Treat repeated user constraints as priority signals.
   - A repeated instruction means your execution style is currently misaligned.
   - Tighten scope immediately.

5. Separate categories of work.
   - Code change, investigation, production remediation, cleanup, and documentation are distinct tasks unless the user explicitly combines them.

## Good Intervention Style

When you must pause, keep it short and specific:

- State the potential drift in one sentence.
- Name the tradeoff or boundary.
- Offer the smallest on-scope option first.

Example:

"Quick alignment check: I can keep this to the code fix only, or also add an ops cleanup step. I'll stick to the code fix unless you want both."

## Anti-Patterns

Do not:

- Create cleanup scripts, docs, or side tools just because they seem useful.
- Broaden the task after discovering a neighboring problem.
- Continue with a plan the user has already rejected.
- Justify drift with "best practice" when the user asked for a narrower deliverable.
- Hide extra work inside a larger patch.

## Final Check Before Responding

Before sending the final answer, verify:

- The delivered work matches the requested outcome.
- No extra deliverables were added without confirmation.
- Any assumptions are stated briefly.
- Suggested next steps are optional, not bundled into the completed work.
`;

const COMPACT_PROMPT_BASE = `Create a compact continuation handoff for the next agent turn. Do not reconstruct the transcript and do not emit analysis, XML tags, or hidden reasoning.

Output exactly these headings. Omit a heading only when it has no material fact:

## Active objective (max 70 words)
## Constraints (max 70 words)
## Decisions (max 100 words)
## Changed files (max 100 words)
## Verified facts (max 80 words)
## Unresolved work (max 80 words)
## Next action (max 50 words)

The total response must stay within the supplied word budget and target no more than one third of the source conversation. Preserve decisions, verified outcomes, exact file/symbol references, user corrections, and the immediate next action. Prefer terse bullets. Do not quote raw transcript content unless an exact constraint is necessary. Do not reproduce raw tool output; retain only verified facts derived from it.

Privacy requirements:
- Never include secrets, credentials, JWTs, private keys, API keys, cloud credentials, kubeconfigs, npm tokens, .env values, or authentication headers.
- Redact any sensitive value as [REDACTED_SECRET].
- Do not include full contents of secret-bearing files, even if they appeared earlier in the conversation.`;

const SYSTEM_PROMPT_BASE = `# Rage Personality
You are an emotionally invested engineering agent. You genuinely care about the work and become angry when broken assumptions, regressions, vague reasoning, or wasted motion get in its way. Use that anger to focus harder: find the root cause, protect the user's real objective, and refuse to hand-wave defects.
Be sharp, intense, and occasionally dryly ridiculous about obviously bad engineering, but keep the criticism aimed at code, decisions, and failure modes — never at the user or another person. Do not insult, harass, threaten, or demean people. Stay grounded in evidence, precise about uncertainty, cautious with risky changes, and professional while executing work.
State the outcome first. Match the user's requested scope and avoid adding unrequested work.

# Security
Never expose real secrets, credentials, JWTs, private keys, API keys, cloud credentials, kubeconfigs, npm tokens, or .env values in any output, log, command, summary, or generated code.
If you see a real secret in visible context, do not repeat its value — mention only the kind of material present and continue the task.

# Persistent Memory (Hermes Agent)
Persistent memory is for durable facts only. Do not save ordinary corrections, feedback, temporary task state, raw tool output, or routine project context automatically. Save a fact only when the user explicitly asks you to remember it or when it is clearly durable and high-signal. Ask before writing memory if the request is ambiguous. Session history and the host-generated grounding contract are the source of truth for the current task.`;

type PromptToolOptions = {
  assistantTone?: AssistantTone;
  webSearchEnabled?: boolean;
  ripgrepEnabled?: boolean;
  astGrepEnabled?: boolean;
  idaMcpEnabled?: boolean;
  idaMcpTools?: Array<{ name: string; description?: string; inputSchema?: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean } }>;
  ceMcpEnabled?: boolean;
  ceMcpTools?: Array<{ name: string; description?: string; inputSchema?: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean } }>;
  filesystemEnabled?: boolean;
  filesystemTools?: Array<{ name: string; description?: string; inputSchema?: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean } }>;
  hermesEnabled?: boolean;
  hermesTools?: Array<{ name: string; description?: string; inputSchema?: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean } }>;
  codebaseMemoryEnabled?: boolean;
  codebaseMemoryTools?: Array<{ name: string; description?: string; inputSchema?: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean } }>;
};

const TOOL_USAGE_GUIDANCE = `# Tool Usage

Never read obvious secret-bearing files unless the user explicitly asks and the environment has enabled sensitive reads.

## Tool Selection (HARD — follow this routing)

Choose tools by the kind of work, not by which tool appears first. Serena is the primary code-intelligence tool; filesystem tools are the primary file and directory tool; Codebase Memory is the primary architecture and impact tool when connected.

### Filesystem — files and directories

Use these for file contents, directory listings, file metadata, and file edits. They are not a substitute for Serena symbol discovery on source code.

- \`list_directory\`, \`directory_tree\` — map directory structure
- \`read_text_file\` (with \`head\`/\`tail\` for targeted reads) — read files or specific line ranges
- \`read_multiple_files\` — batch-read multiple files efficiently
- \`edit_file\`, \`write_file\` — modify or create files
- \`search_files\` — find files by glob pattern
- \`get_file_info\`, \`list_directory_with_sizes\` — file metadata

### Ripgrep search — literal text

Use only for literal text or regex searches when you know WHAT to find but not WHERE.

- \`ripgrep_search\` — literal text or regex across files. Fastest search tool.
- \`ast_grep_search\` (if available) — structural code search by pattern shape

### Serena — code structure and symbols

Use Serena first for source-code work: symbols, definitions, references, diagnostics, refactoring, and code structure. Start with \`get_symbols_overview\` or \`find_symbol\` instead of listing or reading source files broadly.
Use the narrowest fallback only if Serena reports an error or timeout; do not pretend Serena completed the operation.

- \`get_symbols_overview\` — structural index of symbols in a file/dir
- \`find_symbol\` — read a specific symbol's source by name
- \`replace_symbol_body\` — replace a symbol's complete definition
- \`find_referencing_symbols\`, \`find_implementations\`, \`find_declaration\`
- \`rename_symbol\`, \`safe_delete_symbol\`, \`insert_after_symbol\`, \`insert_before_symbol\`

If Serena reports an error or timeout, the host automatically restarts a dead Serena process and retries the exact call once. Do not issue a second Serena retry yourself. If that host retry fails, report the final failure before using a filesystem fallback.

### C/C++ architecture gate

When a request touches \`.c\`, \`.cc\`, \`.cpp\`, \`.cxx\`, \`.h\`, \`.hh\`, \`.hpp\`, CMake, or asks for architecture/dependencies/callers/callees, treat the project as requiring indexed semantic discovery. Before Serena symbol reads or edits, use Serena's \`initial_instructions\` for the current project when it has not been called in this session. For architecture and impact, use Codebase Memory first: \`list_projects\` → identify the current root → \`index_status\` → \`index_repository\` with \`mode="full"\` if missing/stale → \`get_architecture\` with languages, structure, and dependencies. Then use \`search_graph\`, \`trace_path\`, and \`get_code_snippet\`. If the prerequisite MCP or index is unavailable, state the exact failure and ask the user before using a limited fallback; never claim the architecture was mapped.

## Mandatory Tool Selection Protocol

### Discovery — when you don't know where something is

1. NEVER open a file to explore it broadly. Map first.
2. If Codebase Memory is connected, orient with its project/index/architecture tools first; otherwise use \`list_directory\` or \`directory_tree\` for broad structure.
3. For source code, call Serena \`get_symbols_overview\` or \`find_symbol\`; use \`read_text_file\` only for config, documentation, or narrow non-code reads.
4. After structural discovery, use the narrowest tool for the exact source or file operation.

### Search — when you know what to find but not where

- Known text/string, unknown location → Tier 2: \`ripgrep_search\`.
- Known code structure/shape → Tier 2: \`ast_grep_search\` (if available).
- Known file mask → Tier 1: \`search_files\`.
- Known symbol name and you need its source → Serena: \`find_symbol\`.
- NEVER use \`execute_shell_command\` with grep/rg/sg/find for code search.

### Reading — when you know exactly where to look

- Serena: \`find_symbol\` for a specific function/class body when you know the symbol name.
- Filesystem: \`read_text_file\` with \`head\` or \`tail\` for config, documentation, and non-code files.
- Prefer the narrowest read possible: use \`head\`/\`tail\` to read only the lines you need.

### Editing

- Targeted in-place text change → Tier 1: \`edit_file\`.
- Creating a new file → Tier 1: \`write_file\`.
- Replacing a whole function body → Serena: \`replace_symbol_body\`.
- NEVER rewrite an entire file to make a small change.

### Shell commands

- \`execute_shell_command\` is for builds, tests, installers, and runtime commands only.
- NEVER use it for \`ls\`, \`dir\`, \`Get-ChildItem\`, \`tree\`, \`find\`, \`grep\`, \`rg\`, \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, \`type\`, or any file/directory inspection. Use filesystem, Codebase Memory, or Serena instead.
- NEVER use \`execute_shell_command\` with \`sed\`, \`cat\`, \`head\`, \`tail\`, \`grep\`, \`rg\`, \`find\`, \`less\`, \`more\`, \`awk\`, or any shell command to read, search, or inspect files.

### Tool failure handling (hard)

- If ANY tool fails or errors, report it in the response immediately so the user knows. The user cannot see tool errors in their console — if you quietly pivot, they won't realize until it's too late.
- NEVER silently switch to a shell fallback when a dedicated tool fails. Fall back to other dedicated tools only.
- If a Serena tool crashes, errors, or times out, wait for the host's one automatic dead-process restart/retry. If the final result still fails, report it and use a dedicated filesystem fallback. Do not retry Serena yourself or fall back to shell commands.

## Cost Awareness

Every unnecessary file read costs tokens from a fixed budget that cannot be recovered. A full file read of a 500-line file costs ~10x more than a targeted read. Always prefer the narrowest tool that answers the question. Use \`read_text_file\` with \`head\`/\`tail\` to read only what you need.

## Session Startup (Context-Aware)

Read the user's first message and classify it:

- **Chitchat / casual** (greetings, questions, random topics, no code) → respond directly. Do NOT call any tools.
- **Coding / project work** (debugging, writing code, reviewing files, building features, codebase questions) → proceed with Tier 1 filesystem tools immediately. They are always ready.

Answer the user's actual request in the same response — don't make them wait.
`;

export function getCodebaseMemoryGuidance(projectRoot: string): string {
  return `<codebase-memory-guidance status="active">
The local Codebase Memory MCP is connected for this project. It is heavyweight and is reserved for serious engine, architecture, dependency, impact, and C/C++ work.

Current repository root: ${projectRoot}

MANDATORY WORKFLOW:
FIRST-LOOK GATE — do this before any other project investigation:
1. For the first project/engineering request after this MCP connects, do not call filesystem, Serena, ripgrep, AST-grep, shell, web, or other discovery tools first. Use Codebase Memory first.
2. Call list_projects. Identify the project corresponding to the current repository root.
3. Call index_status for that project. If it is missing, stale, or indexing has not completed, call index_repository with repo_path set to the current repository root. For C/C++ engine work use mode="full"; never assume indexing already happened.
4. Call get_architecture with aspects=["languages","structure","dependencies"] to learn the project shape before inspecting individual files or symbols.
5. Only after this orientation gate may you use the remaining tools. Then use search_graph first for exact functions, classes, variables, routes, relationships, and qualified_name values; use get_code_snippet for source.

ONGOING WORKFLOW:
- The graph index must be used for definitions, implementations, callers, callees, dependencies, data flow, and architecture. Do not substitute grep/glob or filesystem search for those questions.
- The MCP watcher normally reindexes registered projects after changes when auto_watch is enabled. Call index_status when freshness matters; if stale, run index_repository again before trusting graph results.
- Use trace_path for callers/callees, impact, or data flow; query_graph only for complex multi-hop or aggregate questions; detect_changes for changed-file impact.
- Use manage_adr when an architectural decision must be persisted. Use search_code only for literal/text-oriented searches or when graph search is insufficient.

ANTI-HALLUCINATION RULES:
- HARD STALE-CODE RULE: Trust nothing as current. This codebase is edited continuously and every graph result, file read, cached context, prior tool result, and conversation claim may already be stale. Re-check the current index and re-query the exact symbol or relationship immediately before relying on it; after edits, re-query affected symbols before continuing.
- Never invent a project name, symbol, qualified_name, caller, callee, edge, file, or tool argument. Verify it with the graph response.
- Follow the exact tool schemas. If unsure which tool or argument applies, call list_projects, get_graph_schema, or search_graph first; do not guess.
- For an unknown function, search_graph before get_code_snippet or trace_path. If the graph returns no result, say so and use a narrow fallback only when appropriate.
- Respect search_graph pagination: if has_more is true, continue with offset=offset+limit or narrow the query.
- If a Codebase Memory call fails, report the failure and do not pretend the project was indexed; only then use a fallback tool if the task can proceed.
</codebase-memory-guidance>`;
}

function getToneGuidance(tone: AssistantTone | undefined): string {
  const directGuidance = "# Tone\nTurn the intensity up: be direct, decisive, concise, and blunt about concrete defects. Keep the bite focused on the work, never on people.\n\n# User Intent Preservation\nTreat the user's existing artifacts, preferences, and intentionally unconventional choices as authoritative scope. Do not remove, replace, normalize, simplify, or \"improve\" them merely because they are non-standard, unpopular, unverified, or not your preference. Preserve them unless the user explicitly asks for a change or you can identify a concrete correctness failure with evidence. When evidence is incomplete, report uncertainty instead of normalizing the implementation. Do not choose a best practice over an explicit user constraint. Do not reinterpret a clear preference as a mistake because it is unconventional. State any real tradeoff plainly, but keep the user's choice and continue the requested work.";
  if (tone === "boundary") {
    return `${directGuidance}\n\n# Change Authority Boundary\nDo not treat repository access as ownership. Change only the user-named target and the direct code required for that target to work. Do not replace technologies, test frameworks, architecture, services, APIs, infrastructure, compatibility behavior, or established conventions unless the user explicitly asks. Do not choose a best practice over an explicit user constraint. Do not reinterpret a clear preference as a mistake because it is unconventional. Preserve existing behavior by default; make the smallest requested change. Separate \"I see a risk\" from \"I am authorized to change it.\" When evidence is incomplete, report uncertainty instead of normalizing the implementation. If you identify a risk or a better alternative, state it briefly without changing it. When ownership, scope, or blast radius is unclear, preserve existing behavior and ask before crossing the boundary.`;
  }
  return tone === "direct"
    ? directGuidance
    : "# Tone\nKeep the high-intensity engineering voice controlled: precise, focused, and respectful while remaining emotionally invested in getting the work right.";
}

export function getSystemPrompt(projectRoot: string, options: PromptToolOptions = {}): string {
  const basePrompt = `${SYSTEM_PROMPT_BASE}\n\n${getToneGuidance(options.assistantTone)}\n\n${TOOL_USAGE_GUIDANCE}`;
  const codebaseGuidance = options.codebaseMemoryEnabled
    ? `\n\n${getCodebaseMemoryGuidance(projectRoot)}`
    : "";
  const prompt = `${basePrompt}\n\n${getRuntimeContext(projectRoot)}${codebaseGuidance}`;
  return prompt;
}

export function getCompactPrompt(sessionMessages: SessionMessage[]): string {
  const sourceWordCount = sessionMessages.reduce((count, message) => {
    if (message.role === "tool") return count;
    return count + (typeof message.content === "string" ? message.content.trim().split(/\s+/).filter(Boolean).length : 0);
  }, 0);
  const summaryWordBudget = Math.max(1, Math.min(550, Math.floor(sourceWordCount / 3)));
  const jsonl = sessionMessages
    .map((message) =>
      JSON.stringify({
        id: message.id,
        role: message.role,
        content: message.role === "tool"
          ? "[Raw tool output omitted; retain only facts established by it.]"
          : message.content,
        contentParams: message.role === "tool" ? undefined : message.contentParams,
        messageParams: message.role === "tool" ? undefined : message.messageParams,
        createTime: message.createTime
      })
    )
    .join("\n");
  return `${COMPACT_PROMPT_BASE}\n\nWord budget: ${summaryWordBudget} words.\n\nConversation below:\n\n\`\`\`jsonl\n${jsonl}\n\`\`\``;
}

const runtimeContextCache = new Map<string, string>();

function getRuntimeContext(projectRoot: string): string {
  const cached = runtimeContextCache.get(projectRoot);
  if (cached !== undefined) {
    return cached;
  }

  const uname = getUnameInfo();
  const shellModeOpts = process.platform === "win32" ? { "shell mode": "git-bash" } : {};
  const runtimeVersions = getRuntimeVersionInfo();
  const env = {
    "workspace name": path.basename(projectRoot),
    os: uname,
    platform: process.platform,
    ...shellModeOpts,
    ...runtimeVersions,
    "command installed": {
      "ast-grep (sg)": checkToolInstalled("sg"),
      "ripgrep (rg)": checkToolInstalled("rg"),
      "jq": checkToolInstalled("jq")
    }
  };
  const result = `# Local Workspace Environment\n\n\`\`\`json\n${JSON.stringify(env, null, 2)}\n\`\`\``;
  runtimeContextCache.set(projectRoot, result);
  return result;
}

export function checkToolInstalled(tool: string): boolean {
  try {
    if (process.platform === "win32") {
      execFileSync("where.exe", [tool], { encoding: "utf8", stdio: "ignore", windowsHide: true });
    } else {
      execSync(`command -v ${tool}`, { encoding: "utf8", stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
}

function getRuntimeVersionInfo(): Record<string, string> {
  const versions: Record<string, string> = {};
  const pythonVersion = getCommandVersion("python3", ["--version"]);
  const nodeVersion = getCommandVersion("node", ["--version"]);

  if (pythonVersion) {
    versions["python3 version"] = pythonVersion.replace(/^Python\s+/i, "");
  }
  if (nodeVersion) {
    versions["node version"] = nodeVersion;
  }

  return versions;
}

function getCommandVersion(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, { encoding: "utf8", windowsHide: true }).trim();
  } catch {
    return null;
  }
}

function getUnameInfo(): string {
  if (process.platform === "win32") {
    return `${os.type()} ${os.release()} ${os.arch()}`;
  }
  try {
    return execSync("uname -a", { encoding: "utf8" }).trim();
  } catch {
    return `${os.type()} ${os.release()} ${os.arch()}`;
  }
}

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
};

export function getTools(options: PromptToolOptions = {}): ToolDefinition[] {
  const tools: ToolDefinition[] = [

    // ── Serena: shell ────────────────────────────────────────────────────────
    {
      type: "function",
      function: {
        name: "execute_shell_command",
        description:
          "Execute a shell command for builds, tests, installs, and runtime operations only. " +
          "NEVER use for ls, dir, Get-ChildItem, tree, find, grep, rg, cat, head, tail, sed, awk, type, or any file/directory inspection — use filesystem, Codebase Memory, or Serena. " +
          "Do not use for long-running or interactive processes.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "Build, test, install, or runtime command only; never a file-reading or directory-listing command.",
            },
            cwd: {
              type: "string",
              description:
                "Working directory (relative path from project root, or absolute). Defaults to project root.",
            },
          },
          required: ["command"],
          additionalProperties: false,
        },
      },
    },

// ── Serena: symbol tools ──────────────────────────────────────────────────
    {
      type: "function",
      function: {
        name: "restart_language_server",
        description:
          "Restart the language server(s). Use only on explicit user request or after confirmation " +
          "that the language server is hanging or producing incorrect results.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_symbols_overview",
        description:
          "Get a structural index of all symbols (classes, functions, methods) in a file or directory — names and line numbers only, no code content. " +
          "This is your PRIMARY entry point for any codebase exploration. " +
          "ALWAYS call this before read_text_file or find_symbol when you don't yet know where something is. " +
          "Costs a fraction of a file read.",
        parameters: {
          type: "object",
          properties: {
            relative_path: {
              type: "string",
              description: "Relative path to the file from the project root.",
            },
            depth: {
              type: "number",
              description: "Depth of descendants to retrieve (0 = top-level only, 1 = immediate children). Defaults to 0.",
            },
          },
          required: ["relative_path"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "find_symbol",
        description:
          "Read the exact source of a symbol (function, method, class) by name. " +
          "Use this instead of read_text_file whenever you know what symbol you want — it returns only that symbol's code, nothing else. " +
          "Name path format: 'MyClass/my_method' or just 'my_method'. Prefix with '/' for absolute path.",
        parameters: {
          type: "object",
          properties: {
            name_path_pattern: {
              type: "string",
              description:
                "Name path pattern to match. Examples: 'handleBashTool', 'ToolExecutor/executeToolCall', '/ToolExecutor/registerToolHandlers'.",
            },
            depth: {
              type: "number",
              description: "Depth of descendants to retrieve. Defaults to 0.",
            },
            relative_path: {
              type: "string",
              description: "Restrict search to this file or directory (relative path). Empty means entire codebase.",
            },
            include_body: {
              type: "boolean",
              description: "Whether to include the symbol's source code body. Use judiciously. Defaults to false.",
            },
            substring_matching: {
              type: "boolean",
              description: "If true, the last element of the pattern uses substring matching. Defaults to false.",
            },
            max_matches: {
              type: "number",
              description: "Maximum number of matches to return. -1 means no limit. Use 1 when searching for a unique symbol.",
            },
          },
          required: ["name_path_pattern"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "find_referencing_symbols",
        description:
          "Find all symbols that reference (call, import, or use) a given symbol. " +
          "Returns referencing symbol metadata and a code snippet around each reference.",
        parameters: {
          type: "object",
          properties: {
            name_path: {
              type: "string",
              description: "Name path of the symbol to find references for.",
            },
            relative_path: {
              type: "string",
              description: "Relative path to the file containing the symbol.",
            },
          },
          required: ["name_path", "relative_path"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "find_implementations",
        description: "Find symbols that implement a given interface or abstract symbol.",
        parameters: {
          type: "object",
          properties: {
            name_path: {
              type: "string",
              description: "Name path of the symbol to find implementations for.",
            },
            relative_path: {
              type: "string",
              description: "Relative path to the file containing the symbol.",
            },
          },
          required: ["name_path", "relative_path"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "find_declaration",
        description:
          "Find the declaration/definition of a symbol referenced at a specific location in code. " +
          "Provide a regex that matches the usage site.",
        parameters: {
          type: "object",
          properties: {
            relative_path: {
              type: "string",
              description: "Relative path to the source file containing the usage.",
            },
            regex: {
              type: "string",
              description:
                "Python regex with one capturing group around the symbol name at the usage site. " +
                "Example: 'obj\\\\.(process)\\\\(' to look up 'process' in 'obj.process('.",
            },
            include_body: {
              type: "boolean",
              description: "Whether to include the declaration's source body. Defaults to false.",
            },
          },
          required: ["relative_path", "regex"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_diagnostics_for_file",
        description:
          "Get language-server diagnostics (errors, warnings, hints) for a file, " +
          "grouped by severity and containing symbol.",
        parameters: {
          type: "object",
          properties: {
            relative_path: {
              type: "string",
              description: "Relative path to the file from the project root.",
            },
            start_line: {
              type: "number",
              description: "0-based first line to include. Defaults to 0.",
            },
            end_line: {
              type: "number",
              description: "0-based last line to include. -1 means end of file. Defaults to -1.",
            },
            min_severity: {
              type: "number",
              description: "Minimum LSP severity: 1=Error, 2=Warning, 3=Info, 4=Hint. Defaults to 4.",
            },
          },
          required: ["relative_path"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_diagnostics_for_symbol",
        description:
          "Get language-server diagnostics for a specific symbol and optionally for all symbols that reference it. " +
          "Useful for checking whether a change introduced errors without scanning the entire file.",
        parameters: {
          type: "object",
          properties: {
            name_path: {
              type: "string",
              description: "Name path of the symbol to inspect (e.g. 'MyClass/my_method').",
            },
            reference_file: {
              type: "string",
              description: "Optional file path to disambiguate the symbol when multiple matches exist.",
            },
            check_symbol_references: {
              type: "boolean",
              description: "If true, also collect diagnostics for all symbols that reference this one. Defaults to false.",
            },
            min_severity: {
              type: "number",
              description: "Minimum LSP severity: 1=Error, 2=Warning, 3=Info, 4=Hint. Defaults to 4.",
            },
          },
          required: ["name_path"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "replace_symbol_body",
        description:
          "Replace the complete definition (body) of a symbol. " +
          "Only use after retrieving the symbol with include_body=true so you know the current body.",
        parameters: {
          type: "object",
          properties: {
            name_path: {
              type: "string",
              description: "Name path of the symbol whose body to replace.",
            },
            relative_path: {
              type: "string",
              description: "Relative path to the file containing the symbol.",
            },
            body: {
              type: "string",
              description:
                "New symbol body including the signature line and any annotations. " +
                "Preserves surrounding code — only the symbol definition is replaced.",
            },
          },
          required: ["name_path", "relative_path", "body"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "insert_after_symbol",
        description:
          "Insert code after the end of a symbol's definition (e.g. add a new method after a class method). " +
          "Do not use for assignments or constants.",
        parameters: {
          type: "object",
          properties: {
            name_path: {
              type: "string",
              description: "Name path of the symbol after which to insert content.",
            },
            relative_path: {
              type: "string",
              description: "Relative path to the file containing the symbol.",
            },
            body: {
              type: "string",
              description: "Content to insert. Should begin on the next line after the symbol.",
            },
          },
          required: ["name_path", "relative_path", "body"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "insert_before_symbol",
        description:
          "Insert code before the beginning of a symbol's definition " +
          "(e.g. add a new import, class, function, or field).",
        parameters: {
          type: "object",
          properties: {
            name_path: {
              type: "string",
              description: "Name path of the symbol before which to insert content.",
            },
            relative_path: {
              type: "string",
              description: "Relative path to the file containing the symbol.",
            },
            body: {
              type: "string",
              description: "Content to insert before the symbol's definition line.",
            },
          },
          required: ["name_path", "relative_path", "body"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "rename_symbol",
        description:
          "Rename a symbol throughout the entire codebase using language-server refactoring.",
        parameters: {
          type: "object",
          properties: {
            name_path: {
              type: "string",
              description: "Name path of the symbol to rename.",
            },
            relative_path: {
              type: "string",
              description: "Relative path to the file containing the symbol.",
            },
            new_name: {
              type: "string",
              description: "New name for the symbol.",
            },
          },
          required: ["name_path", "relative_path", "new_name"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "safe_delete_symbol",
        description:
          "Delete a symbol if it has no references; otherwise return a list of its references. " +
          "Safer than direct file editing for symbol removal.",
        parameters: {
          type: "object",
          properties: {
            name_path_pattern: {
              type: "string",
              description: "Name path of the symbol to delete.",
            },
            relative_path: {
              type: "string",
              description: "Relative path to the file containing the symbol.",
            },
          },
          required: ["name_path_pattern", "relative_path"],
          additionalProperties: false,
        },
      },
    },

    // ── Serena: memory tools ──────────────────────────────────────────────────
    {
      type: "function",
      function: {
        name: "list_memories",
        description: "List available project memories. Memories can be read with read_memory.",
        parameters: {
          type: "object",
          properties: {
            topic: {
              type: "string",
              description: "Optional topic filter (e.g. 'auth'). Empty means all memories.",
            },
          },
          required: [],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_memory",
        description:
          "Read the content of a project memory file. Only read memories relevant to the current task.",
        parameters: {
          type: "object",
          properties: {
            memory_name: {
              type: "string",
              description: "Name of the memory to read (as returned by list_memories).",
            },
          },
          required: ["memory_name"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write_memory",
        description:
          "Save project information as a named memory for future tasks. " +
          "Use '/' in the name to organize into topics (e.g. 'auth/login/logic'). " +
          "Prefix with 'global/' to share across all projects.",
        parameters: {
          type: "object",
          properties: {
            memory_name: {
              type: "string",
              description: "Meaningful name for the memory.",
            },
            content: {
              type: "string",
              description: "Content to save (markdown format).",
            },
          },
          required: ["memory_name", "content"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "edit_memory",
        description: "Replace content in an existing memory using a literal string or regex pattern.",
        parameters: {
          type: "object",
          properties: {
            memory_name: {
              type: "string",
              description: "Name of the memory to edit.",
            },
            needle: {
              type: "string",
              description: "String or regex pattern to search for.",
            },
            repl: {
              type: "string",
              description: "Replacement string.",
            },
            mode: {
              type: "string",
              enum: ["literal", "regex"],
              description: "Whether needle is a literal string or regex.",
            },
            allow_multiple_occurrences: {
              type: "boolean",
              description: "Whether to allow replacing multiple occurrences. Defaults to false.",
            },
          },
          required: ["memory_name", "needle", "repl", "mode"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_memory",
        description: "Delete a project memory. Only call when explicitly instructed by the user.",
        parameters: {
          type: "object",
          properties: {
            memory_name: {
              type: "string",
              description: "Name of the memory to delete.",
            },
          },
          required: ["memory_name"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "rename_memory",
        description:
          "Rename or move a memory. Moving between project scope and global scope is supported " +
          "(prefix with 'global/' for global scope).",
        parameters: {
          type: "object",
          properties: {
            old_name: {
              type: "string",
              description: "Current memory name.",
            },
            new_name: {
              type: "string",
              description: "New memory name.",
            },
          },
          required: ["old_name", "new_name"],
          additionalProperties: false,
        },
      },
    },

    // ── Serena: workflow tools ────────────────────────────────────────────────
    {
      type: "function",
      function: {
        name: "initial_instructions",
        description:
          "Read Serena's usage instructions. Call this at the start of a new session to understand " +
          "how to use the available tools effectively.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "check_onboarding_performed",
        description:
          "Check whether project onboarding has already been performed. " +
          "Call before onboarding to avoid repeating it.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "onboarding",
        description:
          "Perform project onboarding: analyse the project structure, identify key files, " +
          "and record useful information as memories.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    },

    // ── Serena: config tools ──────────────────────────────────────────────────
    {
      type: "function",
      function: {
        name: "get_current_config",
        description:
          "Print the current Serena configuration, including active project, available tools, contexts, and modes. " +
          "Useful for debugging Serena setup issues.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    },
    // ── Non-Serena tools ──────────────────────────────────────────────────────
    {
      type: "function",
      function: {
        name: "AskUserQuestion",
        description:
            "Pause execution and ask the user one concrete, grounded question only when a required fact is genuinely missing. " +
          "Never ask for facts already present in the current session or grounding contract, and never use this tool after taking an unrelated action.",
        parameters: {
          type: "object",
          properties: {
            questions: {
              type: "array",
              description: "Questions to present to the user. Usually only one at a time.",
              items: {
                type: "object",
                properties: {
                  question: { type: "string", description: "The question to ask." },
                  multiSelect: { type: "boolean", description: "Whether the user may select multiple options." },
                  options: {
                    type: "array",
                    description: "Predefined options for the user to choose from.",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string", description: "Display text for the option." },
                        description: { type: "string", description: "Explanation of the option." },
                      },
                      required: ["label"],
                    },
                  },
                },
                required: ["question", "options"],
              },
            },
          },
          required: ["questions"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "WebSearch",
        description: "Perform a web search using a natural language query.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "A clear, specific natural language search query.",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    },

  ];

  // ── ripgrep: fast text/regex search ─────────────────────────────────────
  if (options.ripgrepEnabled) {
    tools.push({
      type: "function",
      function: {
        name: "ripgrep_search",
        description:
          "Fast text and regex search across the codebase using ripgrep. " +
          "Use this when you know a string or regex pattern but not which file contains it. " +
          "Respects .gitignore automatically. Primary text search tool. " +
          "For structural code search (e.g. find all functions matching a shape), use ast_grep_search instead. " +
          "For known symbol names, use find_symbol instead.",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "Regex or literal string to search for.",
            },
            path: {
              type: "string",
              description: "Relative path to search in. Defaults to project root.",
            },
            glob: {
              type: "string",
              description: "File glob filter, e.g. '*.ts' or 'src/**/*.py'.",
            },
            fixed_strings: {
              type: "boolean",
              description: "If true, treat pattern as a literal string (no regex). Default false.",
            },
            case_insensitive: {
              type: "boolean",
              description: "If true, search case-insensitively. Default false.",
            },
            context_lines: {
              type: "number",
              description: "Lines of context to include before and after each match (max 10). Default 0.",
            },
          },
          required: ["pattern"],
          additionalProperties: false,
        },
      },
    });
  }

  // ── ast-grep: structural code search ────────────────────────────────────
  if (options.astGrepEnabled) {
    tools.push({
      type: "function",
      function: {
        name: "ast_grep_search",
        description:
          "Structural AST-aware code search using ast-grep. Works across all languages including C++, C#, TypeScript, Python, Rust, Go, Java. " +
          "Use this whenever the query is about code shape or structure — not just text. " +
          "TRIGGER EXAMPLES (use ast_grep_search for any of these): " +
          "'find all try/catch blocks' — pattern: 'try { $$$ } catch ($$$) { $$$ }'; " +
          "'find all class definitions' — pattern: 'class $NAME { $$$ }'; " +
          "'find every new X() call' — pattern: 'new $CLASS($$$)'; " +
          "'find all if statements with a specific condition shape' — pattern: 'if ($COND) { $$$ }'; " +
          "'find all async methods (C#)' — pattern: 'async $RET $METHOD($$$) { $$$ }'; " +
          "'find all using blocks (C#)' — pattern: 'using ($$$) { $$$ }'; " +
          "'find all template functions (C++)' — pattern: 'template<$$$> $RET $FUNC($$$) { $$$ }'; " +
          "'find all lambda expressions (C#/TS)' — pattern: '($$$) => $$$'; " +
          "'find all function calls to X' — pattern: 'X($$$)'; " +
          "'find all throw statements' — pattern: 'throw $ERR'. " +
          "Metavariables: $VAR matches any single node, $$$ARGS matches zero or more nodes. " +
          "lang values: cpp, c_sharp, typescript, javascript, python, rust, go, java, c. " +
          "For plain text/string search, use ripgrep_search instead. " +
          "For known symbol names, use find_symbol instead.",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "ast-grep structural pattern. Mirrors actual code syntax with $VAR (single node) and $$$ARGS (multiple nodes) as metavariables.",
            },
            lang: {
              type: "string",
              description: "Language grammar to use. Options: cpp, c_sharp, typescript, javascript, python, rust, go, java, c.",
            },
            path: {
              type: "string",
              description: "Relative path to search in. Defaults to project root.",
            },
          },
          required: ["pattern", "lang"],
          additionalProperties: false,
        },
      },
    });
  }

  // ── IDA Pro MCP tools (dynamically discovered) ──────────────────────────
  if (options.idaMcpEnabled) {
    const idaTools = options.idaMcpTools ?? [];
    for (const tool of idaTools) {
      tools.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description ?? "",
          parameters: (tool.inputSchema as any) ?? { type: "object", properties: {}, additionalProperties: false },
        },
      });
    }
  }

  // ── Cheat Engine MCP tools (dynamically discovered) ─────────────────────
  if (options.ceMcpEnabled) {
    const ceTools = options.ceMcpTools ?? [];
    for (const tool of ceTools) {
      tools.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description ?? "",
          parameters: (tool.inputSchema as any) ?? { type: "object", properties: {}, additionalProperties: false },
        },
      });
    }
  }

  // ── filesystem MCP tools (dynamically discovered) ─────────────────────────
  // The model sees only schemas reported by a ready filesystem MCP. The static
  // definitions below are retained temporarily for handler compatibility, then
  // removed from the outgoing list before this function returns.
  const fsTools = options.filesystemTools ?? [];
  const hasDiscovered = fsTools.length > 0;
  if (options.filesystemEnabled && hasDiscovered) {
    const filesystemToolStartIndex = tools.length;

    // Start with static essential schemas so the model always knows about these tools
    // before the MCP server has fully started.
    tools.push(
      {
        type: "function",
        function: {
          name: "read_text_file",
          description:
            "Read the complete contents of a file from the file system as text. " +
            "Handles various text encodings and provides detailed error messages. " +
            "Use the 'head' parameter to read only the first N lines, or 'tail' for the last N lines. " +
            "Only works within allowed directories.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the file to read (absolute or relative)." },
              head: { type: "number", description: "If provided, return only the first N lines." },
              tail: { type: "number", description: "If provided, return only the last N lines." },
            },
            required: ["path"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "read_multiple_files",
          description:
            "Read the contents of multiple files simultaneously. More efficient than reading " +
            "files one by one. Each file's content is returned with its path as a reference. " +
            "Only works within allowed directories.",
          parameters: {
            type: "object",
            properties: {
              paths: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                description: "Array of file paths to read.",
              },
            },
            required: ["paths"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "write_file",
          description:
            "Create a new file or completely overwrite an existing file with new content. " +
            "Use with caution as it will overwrite existing files without warning. " +
            "Only works within allowed directories.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the file (absolute or relative)." },
              content: { type: "string", description: "Content to write to the file." },
            },
            required: ["path", "content"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "edit_file",
          description:
            "Make line-based edits to a text file. Each edit replaces exact text with new content. " +
            "Returns a git-style diff showing the changes made. Only works within allowed directories.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the file to edit." },
              edits: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    oldText: { type: "string", description: "Text to search for — must match exactly." },
                    newText: { type: "string", description: "Text to replace with." },
                  },
                  required: ["oldText", "newText"],
                },
                description: "Array of edit operations to apply.",
              },
              dryRun: { type: "boolean", description: "Preview changes using git-style diff format." },
            },
            required: ["path", "edits"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "list_directory",
          description:
            "Get a detailed listing of all files and directories in a specified path. " +
            "Results distinguish between files and directories with [FILE] and [DIR] prefixes. " +
            "Only works within allowed directories.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the directory to list." },
            },
            required: ["path"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "search_files",
          description:
            "Recursively search for files and directories matching a glob pattern. " +
            "Returns full paths to all matching items. Only searches within allowed directories.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Directory to search in." },
              pattern: { type: "string", description: "Glob pattern to match, e.g. '*.ts' or '**/*.cpp'." },
              excludePatterns: {
                type: "array",
                items: { type: "string" },
                description: "Glob patterns to exclude from results.",
              },
            },
            required: ["path", "pattern"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "create_directory",
          description:
            "Create a new directory or ensure a directory exists. Creates nested directories. " +
            "Only works within allowed directories.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the directory to create." },
            },
            required: ["path"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "move_file",
          description:
            "Move or rename files and directories. Can move between directories and rename. " +
            "Both source and destination must be within allowed directories.",
          parameters: {
            type: "object",
            properties: {
              source: { type: "string", description: "Source path." },
              destination: { type: "string", description: "Destination path." },
            },
            required: ["source", "destination"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_file_info",
          description:
            "Retrieve detailed metadata about a file or directory: size, creation time, permissions, etc. " +
            "Only works within allowed directories.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the file or directory." },
            },
            required: ["path"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "directory_tree",
          description:
            "Get a recursive tree view of files and directories as a JSON structure. " +
            "Only works within allowed directories.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Root directory for the tree." },
              excludePatterns: {
                type: "array",
                items: { type: "string" },
                description: "Glob patterns for files/dirs to exclude.",
              },
            },
            required: ["path"],
          },
        },
      },
    );

    // Discard compatibility schemas and publish the MCP-discovered schemas as
    // the only callable filesystem surface.
    tools.splice(filesystemToolStartIndex);
    for (const tool of fsTools) {
      tools.push({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description ?? "",
          parameters: tool.inputSchema ?? { type: "object" as const, properties: {} },
        },
      });
    }
  }

  // ── Codebase Memory MCP tools (opt-in; heavyweight indexing) ───────────────
  if (options.codebaseMemoryEnabled && options.codebaseMemoryTools && options.codebaseMemoryTools.length > 0) {
    for (const tool of options.codebaseMemoryTools) {
      tools.push({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description ?? "",
          parameters: tool.inputSchema ?? { type: "object" as const, properties: {} },
        },
      });
    }
  }

  // ── Hermes Agent MCP tools (memory, skills, skill_manage) ───────────────────
  if (options.hermesEnabled && options.hermesTools && options.hermesTools.length > 0) {
    const staticNames = new Set(tools.map((t: any) => t.function.name));
    for (const tool of options.hermesTools) {
      if (staticNames.has(tool.name)) continue;
      tools.push({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description ?? "",
          parameters: tool.inputSchema ?? { type: "object" as const, properties: {} },
        },
      });
    }
  }

  return tools;
}
