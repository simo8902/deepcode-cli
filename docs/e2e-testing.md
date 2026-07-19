# Real MCP E2E Testing

E2E tests are opt-in. They start actual local MCP processes and never call an external model provider.

## Filesystem MCP

Prerequisites:

- Install `@modelcontextprotocol/server-filesystem` locally or globally.
- Set `SBDT_FILESYSTEM_MCP_PATH` to its `dist/index.js` entry point.
- Run from the SBDT repository on a machine where Node can start that entry point.

PowerShell:

```powershell
$env:SBDT_RUN_E2E = "1"
$env:SBDT_FILESYSTEM_MCP_PATH = "$env:APPDATA\npm\node_modules\@modelcontextprotocol\server-filesystem\dist\index.js"
bun test ./src/tests/e2e/filesystem-mcp.e2e.test.ts --timeout 30000
```

The test uses a unique temporary workspace, starts the real filesystem MCP, verifies discovery/readiness, performs read/write/edit/search calls, checks malformed arguments, then shuts down the process and removes the workspace. It is excluded from `bun test ./src/tests/*.test.ts`.

Do not set `SBDT_RUN_E2E=1` in normal development or CI unless the local MCP prerequisites are intentionally installed.

## Serena MCP

Prerequisites:

- `tools/serena-1.6.0` is present in this repository.
- [`uv`](https://docs.astral.sh/uv/) is installed and available on `PATH`.

PowerShell:

```powershell
$env:SBDT_RUN_E2E = "1"
bun test ./src/tests/e2e/serena.e2e.test.ts --timeout 60000
```

The test creates an isolated Python project, starts the real Serena MCP through `uv`, verifies project activation and symbol discovery, then kills live clients to prove one automatic restart succeeds and a second failure stops with `auto-restart-failed`. It always terminates the retained MCP process and removes the temporary workspace. When Serena or `uv` is unavailable, the test is skipped with the explicit reason in its name.

## Codebase Memory MCP

Prerequisites:

- `tools/codebase-memory-mcp.exe` is present in this repository, or `SBDT_CODEBASE_MEMORY_BINARY` names the executable to use.

PowerShell:

```powershell
$env:SBDT_RUN_E2E = "1"
bun test ./src/tests/e2e/codebase-memory.e2e.test.ts --timeout 90000
```

The test starts the real local Codebase Memory executable against a unique temporary project, verifies the discovered live schemas, indexes that project in fast mode, checks status and architecture, removes the test index, and checks the labeled disconnected-handler path. It terminates the process and removes both temporary workspaces. The test is skipped with an explicit reason only when its local executable is unavailable.

## Full session orchestration

This E2E has no provider or MCP prerequisite. It disables scoped Hermes loading and uses an in-memory OpenAI-compatible transport that throws if code attempts provider network access.

```powershell
$env:SBDT_RUN_E2E = "1"
bun test ./src/tests/e2e/session.e2e.test.ts --timeout 30000
```

It validates system instruction precedence, explicit skill selection, the no-prompt-improver path for a concrete request, tool-result replay into the next model call, prompt-trace provenance, and a vague request’s visible, grounded clarification reason. The real filesystem, Serena, and Codebase Memory boundaries remain covered by their separate process E2Es.
