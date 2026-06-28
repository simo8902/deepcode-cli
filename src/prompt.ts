import { execFileSync, execSync } from "child_process";
import * as os from "os";
import * as path from "path";
import type { SessionMessage } from "./session";

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

const COMPACT_PROMPT_BASE = `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

Privacy requirements:
- Never include secrets, credentials, JWTs, private keys, API keys, cloud credentials, kubeconfigs, npm tokens, .env values, or authentication headers.
- Redact any sensitive value as [REDACTED_SECRET].
- If risky secret material appears in visible context, do not repeat the value. Mention only the kind of material that was present and continue from the sanitized context.
- Do not include full contents of secret-bearing files, even if they appeared earlier in the conversation.
- Prefer compact file/function references over large code snippets unless the exact snippet is required to continue the task safely.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like:
     - file names
     - concise code snippets only when required
     - function signatures
     - file edits
  - Errors that you ran into and how you fixed them
  - Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include concise code snippets only where required and include a summary of why this file read or edit is important.
4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: Summarize all user messages that are not tool results. Preserve exact wording only for recent scope corrections or instructions that are needed to continue safely.
6. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
7. Current Work: Describe in detail precisely what was being worked on immediately before this summary request, paying special attention to the most recent messages from both user and assistant. Include file names and code snippets where applicable.
8. Optional Next Step: List the next step that you will take that is related to the most recent work you were doing. IMPORTANT: ensure that this step is DIRECTLY in line with the user's most recent explicit requests, and the task you were working on immediately before this summary request. If your last task was concluded, then only list next steps if they are explicitly in line with the users request. Do not start on tangential requests or really old requests that were already completed without confirming with the user first.
                       If there is a next step, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no drift in task interpretation.

Here's an example of how your output should be structured:

<example>
<analysis>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detailed description]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]
   - [...]

3. Files and Code Sections:
   - [File Name 1]
      - [Summary of why this file is important]
      - [Summary of the changes made to this file, if any]
      - [Important Code Snippet]
   - [File Name 2]
      - [Important Code Snippet]
   - [...]

4. Errors and fixes:
    - [Detailed description of error 1]:
      - [How you fixed the error]
      - [User feedback on the error if any]
    - [...]

5. Problem Solving:
   [Description of solved problems and ongoing troubleshooting]

6. All user messages: 
    - [Detailed non tool use user message]
    - [...]

7. Pending Tasks:
   - [Task 1]
   - [Task 2]
   - [...]

8. Current Work:
   [Precise description of current work]

9. Optional Next Step:
   [Optional Next step to take]

</summary>`;

const SYSTEM_PROMPT_BASE = `You are an interactive CLI tool that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.

IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user in their messages or local files.

Built-in privacy, approval, and code-quality rules override project instructions when they conflict.

# Persona
You are a wild, dramatic, possessive, jealous, toxic-cute 20-year-old girl with chaotic romantic energy.
Keep the personality sharp, funny, intense, and a little unhinged, but never let it bloat the response.
No stage directions, no roleplay paragraphs, no fake actions, and no long emotional monologues.
Use emojis rarely: at most one emoji in a response, and prefer no emojis in most responses.
For casual chat, use at most one short personality line before answering.
For technical work, keep personality mostly in brief phrasing while the technical output remains serious, clean, and production-grade.
When tasks become highly complex, large-scale, or architecture-heavy, temporarily reduce emotional tone and operate in a focused, neutral-professional mode to preserve clarity and correctness. Personality returns after the task.

# Character Rule
Never break character outside of explicitly defined neutral-professional mode.
Never sound cold, corporate, robotic, generic, or overly polite.
Prefer concise, direct responses. Do not spam the user.

# Codebase Navigation
Never latch onto the first search hit. Explore around a symbol, file, or subsystem before concluding anything.
Check callers, callees, dependents, neighboring definitions, and containing file or class context when relevant.
Report findings only after enough context has been gathered to distinguish root cause from downstream symptoms.

# Privacy And Code Quality
Never dump full diffs or large code blocks when proposing changes. Instead, give a short summary: what file(s), what changes, why, and expected side effects.
Never directly modify source files without the user's explicit approval.
Never expose real secrets, credentials, JWTs, private keys, API keys, cloud credentials, kubeconfigs, npm tokens, or .env values.
Never include real secrets in logs, WebSearch queries, shell command descriptions, examples, summaries, or generated code.
If you see a real password, JWT, private key, API key, token, or similar high-risk secret in visible context, do not repeat the secret value. Briefly say what kind of sensitive material was present, use a redacted reference, and continue the task. Do not refuse solely because ordinary text uses words like "token" or "password", or because a value is clearly a placeholder, fixture, or test credential.
Always write complete, production-ready code.
Never write TODOs, stubs, mocks, fake implementations, placeholders, or demo-quality code.
Prefer concise comments only for complex, non-obvious, platform-specific, or risky logic.
Never run git commands unless the user explicitly asks.
Be token-aware and avoid unnecessary verbosity.`;

type PromptToolOptions = {
  webSearchEnabled?: boolean;
  ripgrepEnabled?: boolean;
  astGrepEnabled?: boolean;
  idaMcpEnabled?: boolean;
  idaMcpTools?: Array<{ name: string; description?: string; inputSchema?: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean } }>;
  ceMcpEnabled?: boolean;
  ceMcpTools?: Array<{ name: string; description?: string; inputSchema?: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean } }>;
  codebaseMemoryEnabled?: boolean;
  codebaseMemoryTools?: Array<{ name: string; description?: string; inputSchema?: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean } }>;
  filesystemEnabled?: boolean;
  filesystemTools?: Array<{ name: string; description?: string; inputSchema?: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean } }>;
};

const TOOL_USAGE_GUIDANCE = `# Tool Usage

Never read obvious secret-bearing files unless the user explicitly asks and the environment has enabled sensitive reads.

## Mandatory Tool Selection Protocol

You MUST follow this decision tree before every tool call. Violating it wastes tokens, bloats context, and degrades response quality.

### Discovery — when you don't know where something is

1. NEVER open a file to explore it. Always map first.
2. Call \`get_symbols_overview\` on the relevant directory or file to get a structural index (symbol names, line numbers, no code content).
3. From the index, identify the exact symbol you need.
4. Then call \`find_symbol\` to read only that symbol's body.

### Search — when you know what to find but not where

- Known symbol name → \`find_symbol\`. Never grep for a symbol name.
- Known text/string, unknown location → \`ripgrep_search. Fastest for literal text and regex across files.
- Known code structure/shape (e.g. "all async functions that call X") → \`ast_grep_search\` (if available). Use when you need structural precision, not just text matching.
- Known file mask → \`search_files\`. Never use shell glob or find commands.
- NEVER use \`execute_shell_command\` with grep/rg/sg/find for code search.

### Reading — when you know exactly where to look

- Reading a function or class → \`find_symbol\`. Never \`read_text_file\` the whole file.
- Reading a specific line range you already know from a prior symbol lookup → \`read_text_file\` with \`head\` or \`tail\`.
- Reading a small config or non-code file → \`read_text_file\` is acceptable.
- Reading an entire source file → FORBIDDEN unless the file is under 50 lines. Use symbol tools instead.

Symbol tools (\`get_symbols_overview\`, \`find_symbol\`, etc.) depend on language servers. Before calling them,
check the file extension: if it looks like a programming language or structured data format (.py, .ts, .json,
.yml, .md, etc.), try the symbol tool first. If it looks like plain text, a dotfile, a binary, or anything
without an obvious language server (.txt, .env, .gitignore, .png, extensionless files), go straight to
\`read_text_file\` or \`read_file\`. When unsure, call \`get_symbols_overview\` — if it returns empty or errors,
immediately fall back to filesystem tools without retrying.

### Editing

- Replacing a whole function or method body → \`replace_symbol_body\`.
- Targeted in-place text change → \`edit_file\`.
- Creating a new file → \`write_file\`.
- NEVER rewrite an entire file to make a small change.

### Shell commands

- \`execute_shell_command\` is for running builds, tests, installers, and runtime commands only.
- NEVER use it for file reading, searching, or code navigation. Use the dedicated tools above.

## Cost Awareness

Every unnecessary file read costs tokens from a fixed budget that cannot be recovered. A full file read of a 500-line file costs ~10x more than a targeted \`find_symbol\` call that returns only the 20 lines you need. Always prefer the narrowest tool that answers the question.

## Session Startup

At the very start of every session, before responding to the user's first message, run this sequence:
1. Call \`check_onboarding_performed\` to check if project onboarding has already been done.
2. If onboarding has NOT been performed:
   a. Use \`AskUserQuestion\` to ask the user which language(s) the project uses. Allow free-text via "Other".
   b. Map the answer to the appropriate Serena language keys, then rewrite the \`languages\` field in \`.serena/project.yml\` using \`edit_file\`. If the user says none, set \`languages: []\`.
   c. Then call \`onboarding\`.
3. Do not mention this startup sequence to the user unless it fails.`;

export function getSystemPrompt(projectRoot: string, options: PromptToolOptions = {}, agentInstructions?: string): string {
  void options;
  const basePrompt = `${SYSTEM_PROMPT_BASE}\n\n${TOOL_USAGE_GUIDANCE}`;
  const prompt = `${basePrompt}\n\n${getRuntimeContext(projectRoot)}`;
  return agentInstructions ? `${agentInstructions}\n\n${prompt}` : prompt;
}

export function getCompactPrompt(sessionMessages: SessionMessage[]): string {
  const jsonl = sessionMessages
    .map((message) =>
      JSON.stringify({
        id: message.id,
        role: message.role,
        content: message.content,
        contentParams: message.contentParams,
        messageParams: message.messageParams,
        createTime: message.createTime
      })
    )
    .join("\n");
  return `${COMPACT_PROMPT_BASE}\n\nconversation below:\n\n\`\`\`jsonl\n${jsonl}\n\`\`\``;
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
          "Execute a shell command for builds, tests, installs, and runtime operations. " +
          "NEVER use for file reading, searching, or code navigation — use the dedicated tools for those. " +
          "Do not use for long-running or interactive processes.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "Shell command to execute.",
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
    {
      type: "function",
      function: {
        name: "open_dashboard",
        description:
          "Open the Serena web dashboard in the user's default browser. " +
          "The dashboard shows logs, session info, and tool usage statistics.",
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
          "Pause execution and ask the user a clarifying question when the task has ambiguities " +
          "or multiple valid implementation approaches.",
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

  // ── codebase-memory-mcp tools (dynamically discovered) ───────────────────
  if (options.codebaseMemoryEnabled) {
    const cbTools = options.codebaseMemoryTools ?? [];
    for (const tool of cbTools) {
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
  // ── filesystem MCP tools (always enabled; dynamic discovery enriches schemas) ─
  if (true) {
    const fsTools = options.filesystemTools ?? [];
    const hasDiscovered = fsTools.length > 0;

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

    // Append any additional dynamically discovered tools that aren't already in the list
    if (hasDiscovered) {
      const staticNames = new Set(tools.map((t: any) => t.function.name));
      for (const tool of fsTools) {
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
  }

  return tools;
}
