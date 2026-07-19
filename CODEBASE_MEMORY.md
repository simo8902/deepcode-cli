# Codebase Memory MCP

Heavy, opt-in repository intelligence for engine development and serious architecture work.

## Enable

Run `/cbm` in the SBDT prompt. This starts the local binary from:

`tools/codebase-memory-mcp.exe`

The versioned source-folder locations are also accepted:

`tools/codebase-memory-mcp-0.9.0/build/c/codebase-memory-mcp.exe`

The source checkout is not required at runtime when the direct `tools/` binary is used.

The binary must already be built locally. SBDT does not download, build, or start it automatically.

## Use

After `/cbm`, call the exposed tools directly. Typical order:

1. `index_repository` with `repo_path` set to the repository root.
2. `index_status` to check indexing.
3. `search_graph`, `trace_path`, or `get_code_snippet` for targeted investigation.
4. `get_architecture` for a high-level view.

Use it only when graph-level code understanding is worth the indexing cost; normal prompts keep it disconnected.
