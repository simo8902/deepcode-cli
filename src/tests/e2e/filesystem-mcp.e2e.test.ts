import { test } from "bun:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getDiscoveredFilesystemTools,
  getFilesystemClient,
  getFilesystemHealth,
  handleFilesystemTool,
  shutdownFilesystemMcp,
  startFilesystemMcp
} from "../../tools/filesystem-handler";
import type { McpToolResult } from "../../tools/mcp-client";

const runE2E = process.env.SBDT_RUN_E2E === "1";
const filesystemMcpE2ETest = runE2E ? test : test.skip;

function resultText(result: McpToolResult): string {
  return result.content
    .filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

filesystemMcpE2ETest("filesystem MCP executes real isolated file operations and cleans up", async () => {
  const mcpEntry = process.env.SBDT_FILESYSTEM_MCP_PATH?.trim();
  assert.ok(mcpEntry, "Set SBDT_FILESYSTEM_MCP_PATH to server-filesystem/dist/index.js before running E2E tests.");
  assert.equal(fs.existsSync(mcpEntry), true, `Configured filesystem MCP entry does not exist: ${mcpEntry}`);

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sbdt-filesystem-mcp-e2e-"));
  const targetFile = path.join(workspace, "fixture.txt");

  try {
    assert.equal(getFilesystemHealth(workspace).ready, false);
    await startFilesystemMcp(workspace, mcpEntry);
    assert.equal(getFilesystemHealth(workspace).ready, true);

    const discoveredNames = getDiscoveredFilesystemTools(workspace).map((tool) => tool.name);
    for (const toolName of ["read_text_file", "write_file", "edit_file", "search_files"]) {
      assert.ok(discoveredNames.includes(toolName), `Expected discovered filesystem tool: ${toolName}`);
    }

    const client = getFilesystemClient(workspace);
    assert.ok(client, "Filesystem MCP client was not retained after readiness.");

    const writeResult = await client.callTool("write_file", { path: targetFile, content: "alpha\nbeta\n" });
    assert.notEqual(writeResult.isError, true);

    const readResult = await client.callTool("read_text_file", { path: targetFile });
    assert.notEqual(readResult.isError, true);
    assert.match(resultText(readResult), /alpha\s+beta/);

    const editResult = await client.callTool("edit_file", {
      path: targetFile,
      edits: [{ oldText: "beta", newText: "gamma" }],
      dryRun: false
    });
    assert.notEqual(editResult.isError, true);
    assert.equal(fs.readFileSync(targetFile, "utf8"), "alpha\ngamma\n");

    const searchResult = await client.callTool("search_files", { path: workspace, pattern: "fixture.txt" });
    assert.notEqual(searchResult.isError, true);
    assert.match(resultText(searchResult), /fixture\.txt/);

    const malformedResult = await client.callTool("write_file", { path: targetFile });
    assert.equal(malformedResult.isError, true);
  } finally {
    try {
      shutdownFilesystemMcp(workspace);
      assert.equal(getFilesystemClient(workspace), null);
      assert.equal(getFilesystemHealth(workspace).ready, false);
      const unavailableResult = await handleFilesystemTool({}, {
        projectRoot: workspace,
        toolCall: { function: { name: "read_text_file", arguments: "{}" } }
      } as any);
      assert.equal(unavailableResult.ok, false);
      assert.match(unavailableResult.error ?? "", /filesystem MCP is not available/);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }
});
