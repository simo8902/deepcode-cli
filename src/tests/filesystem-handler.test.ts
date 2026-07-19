import { afterEach, test } from "bun:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveFilesystemAllowedRoot, resolveFilesystemMcpEntry } from "../tools/filesystem-handler";

const tempFiles: string[] = [];

afterEach(() => {
  while (tempFiles.length > 0) {
    const file = tempFiles.pop();
    if (file) fs.rmSync(file, { force: true });
  }
});

test("resolveFilesystemMcpEntry uses an explicit configured entry point", () => {
  const entry = path.join(os.tmpdir(), `sbdt-filesystem-mcp-${crypto.randomUUID()}.js`);
  tempFiles.push(entry);
  fs.writeFileSync(entry, "// filesystem MCP entry\n", "utf8");

  assert.equal(resolveFilesystemMcpEntry(entry), entry);
});

test("resolveFilesystemMcpEntry does not fall back when the configured entry point is missing", () => {
  const missingEntry = path.join(os.tmpdir(), `sbdt-filesystem-mcp-missing-${crypto.randomUUID()}.js`);

  assert.equal(resolveFilesystemMcpEntry(missingEntry), null);
});

test("resolveFilesystemAllowedRoot normalizes both Windows drive separators", () => {
  assert.equal(resolveFilesystemAllowedRoot("C:\\projects\\sbdt"), "C:\\");
  assert.equal(resolveFilesystemAllowedRoot("D:/projects/sbdt"), "D:\\");
});

test("resolveFilesystemAllowedRoot preserves a Unix root", () => {
  assert.equal(resolveFilesystemAllowedRoot("/tmp/sbdt"), "/");
});
