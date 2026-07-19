import { test } from "bun:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const runE2E = process.env.SBDT_RUN_E2E === "1";
const configuredBinary = process.env.SBDT_CODEBASE_MEMORY_BINARY?.trim();
const codebaseMemoryBinary = configuredBinary || path.resolve(process.cwd(), "tools", "codebase-memory-mcp.exe");
const binaryPresent = fs.existsSync(codebaseMemoryBinary);
const skipReason = !runE2E
  ? "set SBDT_RUN_E2E=1"
  : !binaryPresent
    ? `Codebase Memory binary is unavailable: ${codebaseMemoryBinary}`
    : null;
const codebaseMemoryE2ETest = skipReason ? test.skip : test;

async function removeWorkspaceAfterProcessExit(workspace: string): Promise<void> {
  let lastLockError: unknown;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      fs.rmSync(workspace, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" && code !== "EPERM") throw error;
      lastLockError = error;
      await new Promise<void>((resolve) => setTimeout(resolve, 125));
    }
  }
  throw lastLockError;
}

codebaseMemoryE2ETest(`Codebase Memory MCP indexes an isolated project and reports unavailable state${skipReason ? ` [skipped: ${skipReason}]` : ""}`, async () => {
  const {
    getCodebaseMemoryClient,
    getCodebaseMemoryHealth,
    getDiscoveredCodebaseMemoryTools,
    handleCodebaseMemoryTool,
    shutdownCodebaseMemoryMcp,
    startCodebaseMemoryMcp,
  } = await import("../../tools/codebase-memory-handler");
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sbdt-codebase-memory-e2e-"));
  const unavailableWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "sbdt-codebase-memory-unavailable-e2e-"));
  const projectName = `sbdt_e2e_${process.pid}_${Date.now()}`;
  let indexCreated = false;

  fs.writeFileSync(path.join(workspace, "app.py"), [
    "def greet(name: str) -> str:",
    "    return f'hello {name}'",
    "",
    "def main() -> str:",
    "    return greet('world')",
    ""
  ].join("\n"));

  try {
    const unavailable = await handleCodebaseMemoryTool({}, {
      projectRoot: unavailableWorkspace,
      toolCall: { function: { name: "get_architecture", arguments: "{}" } }
    } as any);
    assert.equal(unavailable.ok, false);
    assert.match(unavailable.error ?? "", /Codebase Memory is not connected/);

    assert.equal(getCodebaseMemoryHealth(workspace).ready, false);
    await startCodebaseMemoryMcp(workspace);
    assert.equal(getCodebaseMemoryHealth(workspace).ready, true);

    const discoveredNames = getDiscoveredCodebaseMemoryTools(workspace).map((tool) => tool.name);
    for (const toolName of ["list_projects", "index_repository", "index_status", "get_architecture"]) {
      assert.ok(discoveredNames.includes(toolName), `Expected discovered Codebase Memory tool: ${toolName}`);
    }

    const client = getCodebaseMemoryClient(workspace);
    assert.ok(client, "Codebase Memory MCP client was not retained after readiness.");

    const projectsBeforeIndex = await client.callTool("list_projects", {});
    assert.notEqual(projectsBeforeIndex.isError, true);
    const projectsBeforeIndexText = projectsBeforeIndex.content
      .filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n");
    assert.doesNotMatch(projectsBeforeIndexText, new RegExp(projectName));

    const indexResult = await client.callTool("index_repository", {
      repo_path: workspace,
      name: projectName,
      mode: "fast",
      persistence: false,
    });
    assert.notEqual(indexResult.isError, true);
    indexCreated = true;

    const projectsAfterIndex = await client.callTool("list_projects", {});
    assert.notEqual(projectsAfterIndex.isError, true);
    const projectsAfterIndexText = projectsAfterIndex.content
      .filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n");
    assert.match(projectsAfterIndexText, new RegExp(projectName));

    const indexStatus = await client.callTool("index_status", { project: projectName });
    assert.notEqual(indexStatus.isError, true);
    const indexStatusText = indexStatus.content
      .filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n");
    assert.match(indexStatusText, /"status"\s*:\s*"ready"/);

    const architecture = await client.callTool("get_architecture", { project: projectName, aspects: ["overview"] });
    assert.notEqual(architecture.isError, true);
    const architectureText = architecture.content
      .filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n");
    assert.match(architectureText, new RegExp(projectName));

    const deleted = await client.callTool("delete_project", { project: projectName });
    assert.notEqual(deleted.isError, true);
    indexCreated = false;
  } finally {
    const client = getCodebaseMemoryClient(workspace);
    if (indexCreated && client) {
      await client.callTool("delete_project", { project: projectName }).catch(() => undefined);
    }
    shutdownCodebaseMemoryMcp(workspace);
    assert.equal(getCodebaseMemoryClient(workspace), null);
    assert.equal(getCodebaseMemoryHealth(workspace).ready, false);
    await removeWorkspaceAfterProcessExit(workspace);
    await removeWorkspaceAfterProcessExit(unavailableWorkspace);
  }
});
