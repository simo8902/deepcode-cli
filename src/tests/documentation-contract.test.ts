import { test } from "bun:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";

const repositoryRoot = process.cwd();

test("documentation keeps live runtime discovery as the sole tool-schema authority", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
    files?: unknown;
  };
  const packagedFiles = Array.isArray(packageJson.files) ? packageJson.files : [];
  const staticToolDocs = fs.readdirSync(path.join(repositoryRoot, "docs", "tools"));
  const contract = fs.readFileSync(path.join(repositoryRoot, "docs", "orchestration-contract.md"), "utf8");
  const maintainerGuide = fs.readFileSync(path.join(repositoryRoot, "docs", "maintainer-guide.md"), "utf8");

  assert.deepEqual(staticToolDocs, []);
  assert.equal(packagedFiles.includes("docs/tools/**"), false);
  assert.match(contract, /runtime registry is the sole schema authority/i);
  assert.match(maintainerGuide, /Do not add static per-tool Markdown schemas/i);
});
