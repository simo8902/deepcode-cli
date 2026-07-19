# SBDT Orchestration Contract

## Status

This document is the Phase 0 baseline and Phase 1 authority record for the private SBDT tool. It describes the intended authority model, inventories current contributors, and records the implemented precedence changes.

## Intended instruction authority

1. Host policy and product behavior.
2. Project instruction files, with their source paths and precedence visible.
3. Explicitly selected skills, with source paths visible.
4. The current user request.
5. Derived lower-trust context: grounding, memory retrieval, and nudges, appended after the fixed system block.
6. Tool results.

Raw user input is only user content. It must not be injected into a higher-authority instruction position.

## Current live instruction contributors

| Contributor | Current source | Current delivery | Phase 1 action |
|---|---|---|---|
| Host policy | src/prompt.ts getSystemPrompt | Leading system message | Keep first and immutable |
| Default drift guard | src/prompt.ts AGENT_DRIFT_GUARD_SKILL | Leading system message | Keep after host policy |
| Project or user instructions | user-home AGENTS.md, user-home SIMO.md, root AGENTS.md, root SIMO.md, project-local AGENTS.md, project-local SIMO.md | All non-empty sources load in that explicit order. If no project-local source exists, an automatic bootstrap instruction asks the model to create `./AGENTS.md` during the first normal task. | Implemented |
| Selected skills | user and project skill directories | System context after project instructions | Implemented |
| User request | SessionManager buildUserMessage | User message | Keep as user content |
| Grounding | src/grounding.ts | Ephemeral prompt after fixed system block | Implemented |
| Architecture guidance | SessionManager buildArchitectureGuidance | Ephemeral prompt only for C/C++ architecture mapping | Implemented |
| Prompt-improvement nudge | src/prompt-improver.ts | Ephemeral prompt | Activate only when evidence requires it |
| Hermes snapshot | Hermes handler | Ephemeral prompt | Keep lower-trust and prompt-scoped |

## Current skill inventory contributors

| Order | Root | Behavior |
|---|---|---|
| 1 | ~/.agents/skills | Earlier matching skill may be overwritten |
| 2 | ./.sbdt/skills | Legacy project root; duplicate names require a source-qualified command |
| 3 | ./.agents/skills | Project root; duplicate names require a source-qualified command |

Explicit selections win. Exact unambiguous names are selected deterministically; the LLM matcher is only a fallback. Duplicate skill names are retained and require a source-qualified command rather than silently overwriting one another.

## Current tool-registry contributors

| Backend | Registration contributor | Availability source |
|---|---|---|
| Filesystem MCP | filesystem-handler.ts | Handler names are eager; discovered schemas are runtime state |
| Shell | executor.ts | Native handler |
| Serena | executor.ts and serena-handlers.ts | Client health and handler availability |
| ripgrep and ast-grep | executor.ts | Local executable discovery |
| IDA Pro | ida-handler.ts | Dynamic discovery |
| Cheat Engine | ce-handler.ts | Dynamic discovery |
| Hermes | hermes-handler.ts | Eager known names plus discovery |
| Codebase Memory | codebase-memory-handler.ts | Opt-in discovery |
| AskUserQuestion and WebSearch | executor.ts | Native handlers |

The prompt trace records the discovered capability snapshot. The runtime registry is the schema and readiness authority.

## Current command contributors

| Surface | Source |
|---|---|
| Terminal slash menu | src/ui/slashCommands.ts |
| Terminal dispatch | src/ui/App.tsx and prompt input flow |
| CLI help | src/cli.tsx |
| Electron dispatch | src/electron/main.ts |
| Electron command presentation | Electron renderer command UI |

Phase 2 uses src/slash-command-manifest.ts as the shared command manifest. Terminal, CLI help, and Electron dispatch now consume its metadata; /cbm is supported in Electron.

## Phase 2 capability boundary

Filesystem MCP schemas are now published to the model only after the running MCP reports them through discovery. Static compatibility definitions are removed from the outgoing schema list, so a model cannot call a filesystem tool merely because a static prompt definition existed. Serena guidance now matches the host behavior: one automatic dead-process restart/retry, then a reported final failure and a dedicated fallback. ToolExecutor now records the first backend owner for every handler and emits a collision warning when a different backend attempts the same name.

## Trace contract

Each session prompt trace now records:

- the active instruction sources, their nominal priority, role, and path;
- whether grounding, architecture guidance, a nudge, and Hermes memory were injected;
- backend readiness and discovered tool snapshots;
- selected skills and their source paths;
- tool execution outcome and retry metadata when a handler provides it.

The trace records the implemented transport ordering: fixed system sources first, then ephemeral derived context.

## Legacy backlog validation

The prior runtime backlog items O1 through O11 in ROADMAP.md have been source-validated. O2 is closed because SerenaClient already wraps McpClient. O3 is reduced to its remaining synchronous persistence work. The remaining items are confirmed implementation backlog, not unvalidated hypotheses.

## Tool-documentation disposition

Static `docs/tools` references were removed in Phase 4. They had no runtime consumer and had drifted from the actual schemas and Windows behavior. The runtime registry is the sole schema authority: a tool is advertised only when its backend reports it ready, and its live discovered schema is sent with the model request. Do not reintroduce static per-tool schemas without a generated source and a schema-drift check.
