# SBDT Maintainer Guide

This is the operational reference for the private SBDT orchestration runtime. The live implementation is authoritative; this document explains ownership and update rules without duplicating per-tool schemas.

## Instruction order

`SessionManager.createSession` composes the fixed system block in this order:

1. Host policy from `src/prompt.ts:getSystemPrompt`.
2. Default `AGENT_DRIFT_GUARD_SKILL`.
3. User-global instructions: `~/.sbdt/AGENTS.md`, then `~/.sbdt/SIMO.md`.
4. Project instructions: `./AGENTS.md`, `./SIMO.md`, `./.sbdt/AGENTS.md`, then `./.sbdt/SIMO.md`.
5. Explicitly selected skills, with their source path.
6. The user request as a user message.
7. Derived lower-trust context: grounding, architecture guidance, nudges, and scoped Hermes memory.
8. Tool results.

User text is never promoted into system authority. If a project has no project-local instruction source, normal tasks receive an automatic `./AGENTS.md` bootstrap instruction; `/init` is the explicit regenerate command.

## Tool registry ownership

| Concern | Owner | Rule |
|---|---|---|
| Outbound model schemas | `src/prompt.ts:getTools` | Advertise MCP schemas only after the backend has discovered them. |
| Tool dispatch and collision policy | `src/tools/executor.ts:ToolExecutor` | The first registered handler wins; collisions are logged with both backend names. |
| Filesystem MCP lifecycle | `src/tools/filesystem-handler.ts` | `filesystemMcpPath` takes precedence over npm-global discovery. |
| Serena lifecycle | `src/tools/serena-client.ts` and `serena-handlers.ts` | Resolve `tools/serena-1.6.0`; the host performs one restart/retry. |
| Hermes lifecycle | `src/tools/hermes-handler.ts` | Require `HERMES_REPO_DIR` or `hermesRepoDir`; do not guess home-directory paths. |
| Codebase Memory lifecycle | `src/tools/codebase-memory-handler.ts` | Connect only when requested or required by the C/C++ architecture gate. |

Do not add static per-tool Markdown schemas. They drifted from runtime behavior and were deliberately removed. If a new backend has dynamic tools, add its discovery, prompt publication, executor registration, readiness trace, and refresh path together.

## Commands and surfaces

`src/slash-command-manifest.ts` owns command metadata. Terminal, CLI, and Electron must derive their visible command inventory from it. All current built-ins are supported on all three surfaces:

`/skills`, `/new`, `/init`, `/resume`, `/exit`, `/ida`, `/CE`, `/cbm`, `/model`, `/log`.

Add a command by updating the manifest first, then implementing every declared surface and its tests. If a command is not supported everywhere, list only its actual surfaces; never advertise it on an unsupported one.

## State and traces

Per-project state lives under `~/.sbdt/projects/<project>/`. The active session index keeps 50 entries; older session JSONL and prompt-trace artifacts move to `archive/` with an archive index. A completed architecture gate persists only as `architectureGateCompleted: true`; partial gate state and fallback approval never persist.

Prompt traces record instruction sources, selected skills, ephemeral context, backend readiness, and tool execution provenance. Use them to diagnose orchestration behavior before widening prompt guidance or changing routing.

## Change checklist

For an instruction or tool change, update the owning runtime path first, then its trace and focused regression coverage. Keep `docs/orchestration-contract.md`, this guide, and `ROADMAP.md` aligned with the implementation. Do not run builds or tests automatically; maintainers run the documented checks themselves.
