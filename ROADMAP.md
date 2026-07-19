# SBDT Roadmap

## Purpose and scope

This is the complete implementation roadmap for SBDT as a private personal AI orchestration tool. It consolidates the live instruction, prompt, grounding, skill, tool-schema, MCP, documentation, command-surface, and runtime findings.

The immediate goal is predictable orchestration: the model must receive one clear instruction hierarchy, see only truthful tool capabilities, and follow the same workflow in terminal and Electron.

Company-oriented security-gate work is intentionally not prioritized in this roadmap. Existing controls and files are preserved; this document does not call for their removal.

## Current architecture

    User request
      -> grounding contract and prompt-improvement nudges
      -> optional skill-matching model call
      -> SessionManager session creation or reply
      -> system prompt, project instructions, skills, memory, grounding composition
      -> OpenAI-compatible model request and tool-call loop
      -> ToolExecutor gates and handler dispatch
      -> filesystem, Serena, Codebase Memory, Hermes, IDA, CE, ripgrep, ast-grep, or shell backend
      -> session persistence and optional compaction

Primary implementation files:

| Area | Main files |
|---|---|
| Prompt policy and schemas | src/prompt.ts |
| Session lifecycle and instruction loading | src/session.ts |
| Grounding contract | src/grounding.ts |
| Prompt improvement and nudges | src/prompt-improver.ts |
| Tool execution | src/tools/executor.ts |
| Serena integration | src/tools/serena-client.ts, src/tools/serena-handlers.ts |
| Generic MCP integration | src/tools/mcp-client.ts |
| Terminal commands | src/ui/slashCommands.ts, src/ui/App.tsx, src/cli.tsx |
| Electron commands | src/electron/main.ts and renderer command UI |
| Tool schema authority | src/prompt.ts plus runtime backend discovery |
| Init prompt | docs/prompts/init_command.md.ejs |

## Target operating model

### Instruction authority

Instruction sources must be composed in this fixed order:

1. Host invariants and product behavior.
2. Explicit project instructions, with source and precedence visible.
3. Explicitly selected skills, with source and precedence visible.
4. Current user request.
5. Derived, lower-trust working context such as intent classification and memory retrieval.
6. Tool results.

Raw user text must never be reintroduced as a higher-authority system instruction. Derived state is context, not policy.

### Tool authority

The runtime registry is the sole source of truth for:

- whether a tool is available now;
- its JSON schema;
- its backend and readiness state;
- retry behavior;
- the user-visible error and fallback path.

Prompt guidance and documentation must be generated from, or mechanically checked against, that registry.

### Routing model

Use a small deterministic routing matrix:

| Need | First choice | Fallback |
|---|---|---|
| Known literal text | ripgrep or filesystem search | targeted file read |
| Known file or config | filesystem read | targeted search |
| Known source symbol | Serena | targeted file read if Serena is unavailable |
| Unknown source symbol | Serena symbol overview or search | ripgrep |
| Architecture, dependencies, impact, callers, callees | Codebase Memory only when connected and the request needs it | clearly labeled limited analysis |
| C/C++ architecture work | Serena project setup plus Codebase Memory index workflow | ask before limited fallback if mapping is required |
| File creation or precise text edit | filesystem edit/write | none unless the user changes scope |
| Build, test, runtime, installer | shell only when authorized by project instructions | report unavailable or blocked state |

## Confirmed instruction and orchestration findings

### R1 - Correct instruction precedence

**Priority:** P0

**Problem:** SessionManager places the ephemeral prompt before the base system prompt when building OpenAI messages. The ephemeral prompt contains grounding, architecture guidance, nudge text, and Hermes memory. Grounding includes raw user input. This gives user-derived material higher practical priority than host policy, project instructions, and skills.

**Affected files:** src/session.ts, src/grounding.ts

**Change:**

- Keep host policy as the first immutable system message.
- Keep project instructions after host policy.
- Keep skills after project instructions and attach their source metadata.
- Place raw user input only in the user message.
- Pass grounding as structured, explicitly lower-trust context. It must not be merged ahead of system policy.
- Remove tag-based pseudo-isolation as an authority boundary; tags do not make raw text trustworthy.
- Do not indiscriminately hoist late system messages ahead of the established hierarchy.

**Acceptance criteria:**

- A test proves the first system content is host policy.
- A test proves a user string resembling a prompt tag cannot alter the instruction order.
- A test proves project instructions remain ahead of skills, grounding, and retrieved memory.
- Prompt trace makes each instruction source and order visible.

### R2 - Make project-instruction loading explicit and non-lossy

**Priority:** P0

**Problem:** Only one instruction file is loaded. Current precedence chooses root SIMO.md ahead of root AGENTS.md, so the present SIMO.md silently masks AGENTS.md. The wrapper calls the selected content AGENTS.md even when the source is SIMO.md.

**Affected files:** src/session.ts, docs/prompts/init_command.md.ejs

**Change:**

- Load all applicable instruction files, not only the first one found.
- Define one documented order: user-global instructions, project AGENTS.md, project SIMO.md, then project-local override only if intentionally configured.
- Preserve file provenance in the prompt, for example source path and precedence number.
- If full merging is not wanted, expose a single configured active source and state that inactive files are ignored. Do not silently mask them.
- Rename the rendered instruction wrapper so it reflects the actual source file.
- Make /init describe the active instruction policy rather than assuming AGENTS.md is the only source.

**Acceptance criteria:**

- Root AGENTS.md and SIMO.md both influence the composed prompt according to documented order.
- Tests cover all candidate paths and source collisions.
- Prompt trace identifies every loaded instruction file.

### R3 - Replace sticky heuristic authority with per-turn structured state

**Priority:** P0

**Problem:** Grounding marks persistent-memory authorization and architecture mapping as logical OR state across turns. One earlier memory request or architecture word changes later unrelated turns. The architecture trigger is broad: generic architecture, caller, callee, Serena, and CBM language activate it, not only C/C++ work.

**Affected files:** src/grounding.ts, src/session.ts, src/tools/executor.ts

**Change:**

- Make write authorization apply to one requested memory operation, not the whole session.
- Recompute architecture requirements from the current task; preserve only explicit user-approved workflow state.
- Split architecture intent into generic architecture review and C/C++ indexed semantic analysis.
- Require the heavy Codebase Memory path only for requests that actually need graph-backed impact mapping.
- Record why a gate was selected in tool-call context and prompt trace.

**Acceptance criteria:**

- A later unrelated turn does not inherit memory-write authorization.
- A generic request mentioning architecture does not force C/C++ indexing.
- A C/C++ architecture request still receives the complete required gate.
- Tests cover English and non-English or non-keyword phrasing without relying only on regex matches.

### R4 - Make prompt improvement opt-in by evidence, not always-on

**Priority:** P1

**Problem:** The generic improve and complexity-assessment nudges fire for normal non-slash prompts, adding repeated prompt pressure, latency, and token cost. The optional clarification flow adds another model call and can pause a direct request.

**Affected files:** src/prompt-improver.ts, src/session.ts

**Change:**

- Give every nudge a narrow predicate and a user-value reason.
- Do not add a generic improvement nudge when the request has a concrete action and target.
- Run a clarification model call only when required information cannot be inferred safely.
- Surface the reason when the host asks for clarification.
- Add a user setting to disable automatic prompt improvement entirely.

**Acceptance criteria:**

- Precise tasks incur no extra nudge or clarification call.
- Ambiguous changes receive one focused clarification.
- Prompt traces identify which predicate activated each nudge.

### R5 - Make skill selection deterministic and observable

**Priority:** P1

**Problem:** Every non-empty request makes a separate LLM skill-matching call. Parse/provider failures silently yield no skill. Duplicate skill names overwrite each other by load order without provenance.

**Affected files:** src/session.ts and skill-loading code

**Change:**

- Use explicit user-selected skills first.
- For automatic selection, use deterministic keyword or manifest matching before an LLM classifier.
- Run the LLM classifier only when deterministic matching is inconclusive and skills are available.
- Report selected skills and source paths in the prompt trace and session UI.
- Detect duplicate names; reject ambiguous duplicates or require a qualified name.
- Cache matching results per request text and active skill inventory.

**Acceptance criteria:**

- A classifier failure is visible in trace output and does not look like an intentional empty selection.
- Duplicate skill names do not silently override.
- A request with no relevant skill avoids an unnecessary model call where possible.

### R6 - Align written tool guidance with runtime behavior

**Priority:** P1

**Problem:** The prompt says not to retry Serena after a failure, while the handler restarts a dead Serena process and retries once. Guidance also contains overlapping first-choice rules for filesystem, Serena, and Codebase Memory.

**Affected files:** src/prompt.ts, src/tools/serena-handlers.ts, src/tools/executor.ts

**Change:**

- Choose one Serena policy: host auto-retries one dead-process restart and reports the final result, or host never retries and the model chooses a fallback.
- State that exact policy once in generated tool guidance.
- Replace overlapping prose with the routing matrix in this roadmap.
- Keep tool failure reporting separate from retry mechanics: a successful host retry should be visible in trace, while a final failure is reported to the user.
- Scope Codebase Memory guidance to active availability and the actual task class.

**Acceptance criteria:**

- Prompt text, handler behavior, and tool result metadata agree on retry count.
- Tests simulate first-call Serena death and verify the chosen user-visible outcome.
- No tool guidance says two incompatible first actions.

### R7 - Establish a truthful runtime tool registry

**Priority:** P1

**Problem:** Static filesystem schemas are always exposed before MCP readiness and override discovered schemas. The model can call a tool that the runtime cannot currently serve. Static and dynamic schemas can drift.

**Affected files:** src/prompt.ts, src/tools/executor.ts, filesystem MCP registration

**Change:**

- Represent each tool as one registry entry: schema, backend, readiness, retry policy, and documentation metadata.
- Expose unavailable tools only when the model needs to initiate or wait for setup; label them unavailable rather than callable.
- Remove static schema duplication once discovery is reliable, or validate static schemas against discovered schemas at startup.
- Add collision detection for duplicate tool names across backends.
- Make errors distinguish unavailable, failed, malformed arguments, and denied operation.

**Acceptance criteria:**

- The model never receives a callable schema for a backend that cannot execute it.
- A schema mismatch is detected in development.
- Tool-name collisions are explicit and deterministic.

### R8 - Regenerate and connect documentation

**Priority:** P1

**Problem:** docs/tools is shipped but not consumed by the live model path. It contains obsolete names, arguments, and Unix-oriented examples inconsistent with current filesystem schemas and shell guidance.

**Affected files:** docs/tools/, src/prompt.ts, package publishing configuration

**Change:**

- Decide whether docs/tools is user documentation, model context, or both.
- If user documentation, generate reference sections from the tool registry and add a schema-drift check.
- If model context, inject only the short relevant reference for active tools.
- Replace obsolete argument names and shell examples.
- Add platform-specific examples where Windows behavior matters.
- Remove files that have no consumer after migration rather than shipping misleading reference material.

**Acceptance criteria:**

- Every documented tool name and parameter matches the live schema.
- Documentation states backend availability and platform limits.
- Package contents contain no unused, contradictory tool reference.

### R9 - Unify command surfaces

**Priority:** P1

**Problem:** Terminal help and slash-command registration advertise /cbm, while Electron does not consistently expose or handle it. Tests list an older command set.

**Affected files:** src/ui/slashCommands.ts, src/ui/App.tsx, src/cli.tsx, src/electron/main.ts, Electron renderer command UI, src/tests/slashCommands.test.ts

**Change:**

- Define slash commands in one shared manifest: name, description, availability, handler, and platform support.
- Generate CLI help, terminal menu, Electron menu, and tests from that manifest.
- Either implement /cbm in Electron or mark it terminal-only everywhere.
- Keep /ida, /ce, /model, /log, /skills, /init, /new, /resume, and /exit in the same registry.

**Acceptance criteria:**

- Every advertised command resolves on the platform where it is displayed.
- Platform-specific commands are clearly labeled.
- Tests derive expected commands from the manifest rather than a hand-maintained list.

### R10 - Simplify compaction and persona policy

**Priority:** P2

**Problem:** The compaction prompt asks for a detailed, quote-heavy reconstruction while trying to reduce context. It contains inconsistent numbering. The always-on Rage Personality can conflict with technical-neutral or conversational work.

**Affected files:** src/prompt.ts, src/session.ts

**Change:**

- Replace compaction with a bounded structured summary: active objective, constraints, decisions, changed files, verified facts, unresolved work, and next action.
- Do not ask the compactor to emit hidden analysis.
- Set token budgets per section and omit stale tool output by default.
- Make tone a configurable mode or a narrowly scoped engineering style, not an unconditional persona.
- Remove the unused agentInstructions parameter from getSystemPrompt or use it consistently.

**Acceptance criteria:**

- Summaries are shorter than the source context by a defined target ratio.
- A resumed session retains decisions and next steps without reproducing raw transcript content.
- Tone matches the active mode without overriding project instructions.

## Existing runtime backlog to retain and validate

The following items came from the prior broad roadmap. They remain in scope but require source revalidation before implementation because this consolidation focused on instruction and orchestration behavior.

| ID | Item | Source-validation status | Proposed direction | Priority |
|---|---|---|---|---|
| O1 | Serena directory resolution | Closed: the empty legacy `tools/serena` directory and its generated `.venv` were removed. | Resolve only the packaged tools/serena-1.6.0 source; resolver coverage remains. | Done |
| O2 | Duplicate MCP client plumbing | Resolved: SerenaClient already wraps McpClient rather than duplicating JSON-RPC lifecycle code. | Remove from implementation queue. | Closed |
| O3 | Synchronous session index and JSONL I/O | Implemented: in-memory session state is updated synchronously while index, JSONL, and prompt-trace writes run through one ordered async queue; archival drains that queue before moving artifacts. | `flushPersistence()` gives lifecycle/test callers an explicit durability boundary; regression coverage added and awaiting user verification. | Done |
| O4 | Excessive agent-loop ceiling | Implemented: `maxAgentIterations` is a validated top-level setting with a default of 64 and a hard cap of 1,000. | The terminal message names the limit and the setting needed to increase it; awaiting user verification. | Done |
| O5 | Fragile Hermes path guessing | Implemented: only HERMES_REPO_DIR and hermesRepoDir are accepted; home-directory guesses were removed. | Clear unavailable state names both supported configuration paths; resolver coverage added. | Done |
| O6 | Filesystem MCP path discovery | Implemented: filesystemMcpPath is resolved before global npm locations, and a missing explicit path fails without fallback. | Configuration and resolver coverage added; unavailable errors point to the supported setting. | Done |
| O7 | Windows drive-root normalization | Implemented: filesystem MCP allowed roots normalize both Windows slash styles before deriving the drive root. | Regression coverage verifies C:\\ and D:/ project paths plus Unix behavior. | Done |
| O8 | Registration collision handling | Confirmed: registration keeps the first handler for duplicate names without reporting the collision. | Covered by R7; retain as part of the shared registry migration. | P1 |
| O9 | Architecture gate resume state | Implemented: only a fully completed Serena + Codebase Memory gate persists as architectureGateCompleted and restores on session resume. | Partial progress and limited-fallback approval are never serialized or restored; executor coverage added. | Done |
| O10 | Stream token estimation cost | Implemented: stream-token estimation uses direct Unicode code-point range checks instead of a regex per character. | The existing estimate weights are preserved; CJK and surrogate-pair coverage added. | Done |
| O11 | Session retention | Implemented: entries beyond the active 50-session cap move their JSONL and trace artifacts into the per-project archive with archived metadata. | Active session inventory stays bounded; archive coverage added. | Done |

## Delivery plan

### Phase 0 - Contract and regression baseline

- [x] Write a single instruction-precedence specification using the target operating model above. See docs/orchestration-contract.md.
- [x] Inventory every instruction source, skill directory, command, and tool registry contributor. See docs/orchestration-contract.md.
- [x] Add prompt-trace fields for instruction source, source path, priority, tool readiness, skill selection, and handler retry result.
- [x] Mark every existing docs/tools file as migration-pending legacy reference. This was a temporary Phase 0 disposition.
- [x] Validate O1 through O11 against current source before scheduling implementation. O2 is closed; O3 is reduced to remaining synchronous persistence work.

### Phase 1 - Fix authority and state leakage

- [x] Implement R1 instruction ordering.
- [x] Implement R2 multi-source instruction loading and provenance.
- [x] Implement R3 per-turn grounding authority and narrower architecture classification.
- [x] Add regression tests for prompt order, source precedence, and expiring per-turn authorization. Tests were added but not run.

**Exit condition:** implemented. Fixed system instructions precede derived context; instruction sources are loaded without silent masking; memory authorization and C/C++ architecture mapping are scoped to the active task. Regression tests were added and remain unexecuted by project instruction.

### Phase 2 - Fix routing and capability truth

- [x] Implement R6 Serena and tool-routing policy alignment.
- [x] Implement the Phase 2 truthful-schema boundary from R7: only discovered filesystem MCP schemas are callable by the model.
- [x] Add readiness, retry-guidance, and command-surface regression tests. Tests were added but not run.
- [x] Implement the shared command manifest from R9.

**Exit condition:** implemented. Filesystem MCP readiness, tool-handler collision reporting, Serena retry policy, and slash-command parity now agree across the prompt, runtime, and UI surfaces. Regression tests were added but not run.

### Phase 3 - Reduce unnecessary orchestration

- [x] Implement R4 evidence-based nudges and clarification. Concrete requests no longer receive generic nudge context; clarification requires a grounding-proven missing requirement, is user-visible, and can be disabled with `promptImprovementEnabled: false`. Regression tests added; awaiting user verification.
- [x] Implement R5 deterministic-first skill matching, provenance, and conflict handling. Explicit selections win; exact skill-name matches avoid the LLM classifier; inconclusive requests use the LLM fallback; duplicate names require source-qualified commands. Regression tests added; awaiting user verification.
- [x] Implement R10 compact summary and configurable tone. Compaction now has a defined one-third-of-source word budget capped at 550 words, fixed continuation headings, and raw tool-output omission; the default is an intense rage-focused engineering personality, with `assistantTone: "direct"` for an even blunter delivery. Regression tests added; awaiting user verification.
- [x] Address O3 synchronous persistence and O4 excessive agent-loop ceiling. Both are implemented with focused regression coverage; awaiting user verification.

**Exit condition:** a precise normal request does not incur avoidable classifier, nudge, or clarification work.

### Phase 4 - Documentation and operational cleanup

- [x] Implement R8 validated tool documentation. Removed the unused, stale `docs/tools` package surface; runtime-discovered schemas are the sole authority, and the orchestration contract records the rule against reintroducing static schemas without generation and drift checks. No runtime behavior changed.
- [x] Update /init to match the final instruction-source policy. Project instruction sources already load automatically; while a project has none, its normal tasks receive a `./AGENTS.md` bootstrap instruction without replacing the task. `/init` remains an explicit regenerate command. Regression tests added; awaiting user verification.
- [x] Revalidate and implement selected O1, O2, O5, O6, O7, O9, O10, and O11 items. O2 was already closed; O1/O5/O6/O7/O9/O10/O11 are implemented with focused regression coverage.
- [x] Produce a maintainer document explaining instruction precedence, tool registry ownership, and platform command support. See docs/maintainer-guide.md; the README and package contents link and ship it, and the orchestration contract was corrected for current skill and registry behavior.

**Exit condition:** documentation is truthful, discoverable, and mechanically coupled to live behavior.

### Phase 5 - Real MCP and orchestration end-to-end verification

- [x] Run only after Phases 1-4 are implemented and unit/regression coverage is green. User verification reported the scoped suite passing before Phase 5 began.
- [x] Add an opt-in E2E harness that starts the real filesystem MCP process against an isolated temporary workspace; do not replace it with a mocked handler. See src/tests/e2e/filesystem-mcp.e2e.test.ts and docs/e2e-testing.md.
- [x] Exercise discovered tool schemas, readiness transitions, real file read/write/edit/search calls, malformed arguments, unavailable-tool errors, and cleanup of every spawned filesystem MCP process. The opt-in filesystem harness covers these boundaries.
- [x] Exercise the real Serena process when installed: project activation, a symbol discovery call, dead-process restart, exact one-retry behavior, and final failure reporting. `src/tests/e2e/serena.e2e.test.ts` uses real `uv`/Serena processes and skips with a reason only when its local prerequisite is unavailable; awaiting user verification.
- [x] Exercise real Codebase Memory when installed: project discovery, index-status handling, indexing when required, architecture retrieval, and the correctly labeled unavailable path. Its first real run exposed and fixed paginated `tools/list` discovery in `McpClient`; `src/tests/e2e/codebase-memory.e2e.test.ts` now validates the complete live tool surface with a unique temporary project and deletes its test index; awaiting user verification.
- [x] Add full-session E2E cases covering instruction ordering, explicit skill selection, concrete requests without prompt-improver calls, grounded clarification with its visible reason, tool-result replay, and trace provenance. `src/tests/e2e/session.e2e.test.ts` covers the complete model/tool/session loop; awaiting user verification.
- [x] Keep network/provider calls disabled by default. The full-session E2E uses a deterministic in-memory OpenAI-compatible transport that throws on `fetch`; MCP boundaries remain covered only by their real-process E2Es.
- [x] Make E2E execution opt-in with documented prerequisites, bounded timeouts, temp-workspace isolation, and process cleanup assertions. `docs/e2e-testing.md` documents each harness; all real-process E2Es are `SBDT_RUN_E2E=1` gated, use isolated temporary projects, assert shutdown state, and use bounded Windows lock cleanup.

**Exit condition:** a developer can run the opt-in suite on a configured machine and prove the live MCP processes and orchestration path behave as the unit contracts claim, including expected unavailable states.

## Required regression coverage

- [x] System, project, skill, user, grounding, memory, and tool-result order is deterministic. `buildOpenAIMessages` coverage now asserts the complete merged-system and paired-tool sequence; awaiting user verification.
- [x] User-provided text cannot alter host/project instruction priority. A hostile instruction-override attempt is asserted to remain below the merged host/project system block; awaiting user verification.
- [x] AGENTS.md and SIMO.md behavior is explicit, tested, and traceable. Loading order and persisted prompt-trace provenance are covered for both project files; awaiting user verification.
- [x] Grounding flags expire or persist only by documented intent. Grounding coverage verifies turn-scoped memory authorization, same-task explicit-answer architecture continuation, and unrelated-task reset.
- [x] Generic architecture wording does not trigger C/C++ indexing. Session coverage asserts generic architecture review never invokes the Serena/Codebase Memory startup boundary; awaiting user verification.
- [x] C/C++ architecture tasks still enforce required discovery. Executor coverage blocks Serena symbol work until Serena initialization plus Codebase Memory list/status/index/architecture stages complete, then permits it; awaiting user verification.
- [x] Serena retry behavior has one policy and one visible outcome. The verified real Serena E2E proves exactly one automatic restart, `auto-restart-succeeded` on recovery, and `auto-restart-failed` with terminal reporting on the second failure.
- [x] Tool schemas match runtime readiness and detected backends. Verified filesystem and Codebase Memory E2Es assert live schema discovery, readiness transitions, unavailable behavior after shutdown, and complete paginated tool discovery.
- [x] Duplicate tool and skill names produce explicit outcomes. Executor coverage preserves and identifies the first tool handler; session/slash-command coverage marks duplicate skills ambiguous and requires source-qualified commands.
- [x] Precise prompts avoid unnecessary LLM classifier and nudge calls. Prompt-improver tests reject generic nudges for concrete requests, exact skill matches bypass the classifier, and the verified full-session E2E makes no prompt-improver request for a concrete task.
- [x] CLI, terminal, and Electron command inventories match their shared manifest. The verified slash-command regression compares both surfaces from the shared manifest and checks the Codebase Memory command is present.
- [x] Documentation examples validate against current schemas. Static per-tool examples were deliberately removed because they drift; a regression now enforces an empty `docs/tools`, package exclusion, and the live-runtime-schema documentation contract.
- [x] Compaction retains active work without replaying large raw transcripts. Verified prompt coverage asserts the bounded structured handoff, one-third word budget, active-work headings, and raw-tool-output omission.

## Constraints

- Keep SBDT private-tool oriented.
- Preserve existing files and controls unless a later task explicitly authorizes removal.
- The legacy `tools/serena` directory was removed by explicit authorization; retain the versioned `tools/serena-1.6.0` installation.
- Keep C/C++ semantic discovery available through Serena and Codebase Memory where the task genuinely needs it.
- Do not run builds, tests, applications, servers, migrations, or external services unless separately authorized by the project instructions.

## Audit record

This roadmap incorporates the instruction/tool audit findings from July 18, 2026. The audit was read-only apart from creating this roadmap and recording the private-tool scope correction in local agent memory.

No builds, tests, applications, servers, migrations, or external services were run. Git reported that the workspace was not a worktree. Serena semantic extraction had previously failed for several TypeScript tool-layer files, so those files were inspected directly. Two non-mutating ripgrep searches had PowerShell regex-quoting errors; their useful partial output was retained and the failures were reported.
