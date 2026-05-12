import { test } from "node:test";
import assert from "node:assert/strict";
import { getSystemPrompt, getTools } from "../prompt";

test("getTools always includes WebSearch", () => {
  const names = getTools().map((tool) => tool.function.name);
  assert.equal(names.includes("WebSearch"), true);
});

test("getSystemPrompt includes compact tool guidance without full tool docs", () => {
  const prompt = getSystemPrompt("/tmp/project");
  assert.equal(prompt.includes("# Tool Usage"), true);
  assert.equal(prompt.includes("Available tool schemas are provided separately"), true);
  assert.equal(prompt.includes("## WebSearch"), false);
});
