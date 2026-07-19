import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const runE2E = process.env.SBDT_RUN_E2E === "1";
const serenaDir = path.resolve(process.cwd(), "tools", "serena-1.6.0");
const serenaInstallPresent = fs.existsSync(path.join(serenaDir, "pyproject.toml"));
const uvPresent = runE2E && serenaInstallPresent && spawnSync("uv", ["--version"], { stdio: "ignore" }).status === 0;
const skipReason = !runE2E
  ? "set SBDT_RUN_E2E=1"
  : !serenaInstallPresent
    ? "tools/serena-1.6.0 is unavailable"
    : !uvPresent
      ? "uv is unavailable"
      : null;
const serenaMcpE2ETest = skipReason ? test.skip : test;

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

serenaMcpE2ETest(`Serena MCP activates a project, discovers symbols, and retries once${skipReason ? ` [skipped: ${skipReason}]` : ""}`, async () => {
  const { getSerenaClient, getSerenaHealth, shutdownSerenaClient } = await import("../../tools/serena-client");
  const { callSerenaToolWithSingleRestart } = await import("../../tools/serena-handlers");
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sbdt-serena-mcp-e2e-"));
  const sourcePath = path.join(workspace, "fixture.py");
  fs.writeFileSync(sourcePath, [
    "def greet(name: str) -> str:",
    "    return f'hello {name}'",
    "",
    "class Greeter:",
    "    def make_message(self, name: str) -> str:",
    "        return greet(name)",
    ""
  ].join("\n"));

  try {
    assert.equal(getSerenaHealth(workspace).ready, false);
    const client = getSerenaClient(workspace);
    await client.ensureReady();
    assert.equal(getSerenaHealth(workspace).ready, true);

    const activation = await client.callTool("initial_instructions", {});
    assert.notEqual(activation.isError, true);

    const symbols = await client.callTool("get_symbols_overview", { relative_path: "fixture.py", depth: 1 });
    assert.notEqual(symbols.isError, true);
    const symbolText = symbols.content
      .filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n");
    assert.match(symbolText, /greet|Greeter/i);

    client.shutdown();
    let restartResolverCalls = 0;
    const recovered = await callSerenaToolWithSingleRestart(
      "initial_instructions",
      {},
      workspace,
      () => {
        restartResolverCalls += 1;
        return restartResolverCalls === 1 ? client : getSerenaClient(workspace);
      },
    );
    assert.equal(restartResolverCalls, 2, "a dead Serena client must receive exactly one retry");
    assert.equal(recovered.ok, true);
    assert.equal(recovered.metadata?.retry, "auto-restart-succeeded");

    const failedFirstClient = getSerenaClient(workspace);
    await failedFirstClient.ensureReady();
    failedFirstClient.shutdown();
    const failedSecondClient = getSerenaClient(workspace);
    await failedSecondClient.ensureReady();
    failedSecondClient.shutdown();
    let failureResolverCalls = 0;
    const failed = await callSerenaToolWithSingleRestart(
      "initial_instructions",
      {},
      workspace,
      () => {
        failureResolverCalls += 1;
        return failureResolverCalls === 1 ? failedFirstClient : failedSecondClient;
      },
    );
    assert.equal(failureResolverCalls, 2, "a retry failure must stop after the second attempt");
    assert.equal(failed.ok, false);
    assert.equal(failed.metadata?.retry, "auto-restart-failed");
    assert.match(failed.error ?? "", /after auto-restart/);
  } finally {
    shutdownSerenaClient(workspace);
    assert.equal(getSerenaHealth(workspace).ready, false);
    await removeWorkspaceAfterProcessExit(workspace);
  }
});
