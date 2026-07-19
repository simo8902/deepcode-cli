import { afterEach, test } from "bun:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { findSerenaDir } from "../tools/serena-client";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createSerenaRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sbdt-serena-resolution-"));
  tempDirs.push(root);
  return root;
}

function addSerenaSource(root: string): string {
  const sourceDir = path.join(root, "tools", "serena-1.6.0");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "pyproject.toml"), "[project]\nname = 'serena'\n", "utf8");
  return sourceDir;
}

test("findSerenaDir resolves the versioned Serena source", () => {
  const root = createSerenaRoot();
  const versioned = addSerenaSource(root);

  assert.equal(findSerenaDir(path.join(root, "dist", "cli.js")), versioned);
});
