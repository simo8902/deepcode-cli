import { test } from "bun:test";
import assert from "node:assert/strict";
import { buildLoadingText } from "../ui";

test("buildLoadingText returns the idle SBDT loading copy", () => {
  assert.deepEqual(
    buildLoadingText({ progress: null, now: Date.now() }),
    { prefix: "lemme work on ur ask twin...", tool: null }
  );
});

test("buildLoadingText separates the active tool from its prefix", () => {
  assert.deepEqual(
    buildLoadingText({ progress: null, activeTool: "read", now: Date.now() }),
    { prefix: "lemme work on ur ask twin via ", tool: "read" }
  );
});
