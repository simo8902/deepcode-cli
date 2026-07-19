import { afterEach, test } from "bun:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveHermesRepoDir } from "../tools/hermes-handler";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createHermesRepo(): string {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbdt-hermes-repo-"));
  tempDirs.push(repoDir);
  fs.writeFileSync(path.join(repoDir, "hermes_tools_mcp.py"), "# Hermes MCP\n", "utf8");
  return repoDir;
}

test("resolveHermesRepoDir prefers the explicit environment path", () => {
  const repoDir = createHermesRepo();
  const settingsPath = path.join(os.tmpdir(), "missing-sbdt-settings.json");

  assert.equal(resolveHermesRepoDir({ envDir: repoDir, settingsPath }), repoDir);
});

test("resolveHermesRepoDir uses the configured settings path without guessing home folders", () => {
  const repoDir = createHermesRepo();
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbdt-hermes-settings-"));
  tempDirs.push(configDir);
  const settingsPath = path.join(configDir, "settings.json");
  fs.writeFileSync(settingsPath, JSON.stringify({ hermesRepoDir: repoDir }), "utf8");

  assert.equal(resolveHermesRepoDir({ envDir: "", settingsPath }), repoDir);
  assert.equal(resolveHermesRepoDir({ envDir: "", settingsPath: path.join(configDir, "missing.json") }), null);
});
