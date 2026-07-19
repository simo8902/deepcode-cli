import { test } from "bun:test";
import assert from "node:assert/strict";
import { getCompactPrompt, getSystemPrompt, getTools } from "../prompt";

test("getTools always includes WebSearch", () => {
  const names = getTools().map((tool) => tool.function.name);
  assert.equal(names.includes("WebSearch"), true);
});

test("getTools exposes filesystem schemas only when the MCP discovered them", () => {
  const unavailableNames = getTools({ filesystemEnabled: true, filesystemTools: [] })
    .map((tool) => tool.function.name);
  assert.equal(unavailableNames.includes("read_text_file"), false);

  const discoveredTools = getTools({
    filesystemEnabled: true,
    filesystemTools: [
      {
        name: "read_text_file",
        description: "Runtime filesystem schema",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
          additionalProperties: false
        }
      }
    ]
  });
  const filesystemTool = discoveredTools.find((tool) => tool.function.name === "read_text_file");
  assert.equal(filesystemTool?.function.description, "Runtime filesystem schema");
  assert.deepEqual(filesystemTool?.function.parameters.required, ["path"]);
});

test("getSystemPrompt includes compact tool guidance without full tool docs", () => {
  const prompt = getSystemPrompt("/tmp/project");
  assert.equal(prompt.includes("# Tool Usage"), true);
  assert.equal(prompt.includes("host automatically restarts a dead Serena process"), true);
  assert.equal(prompt.includes("## WebSearch"), false);
});

test("getSystemPrompt defaults to the rage personality and supports direct tone", () => {
  const defaultTone = getSystemPrompt("/tmp/project");
  const direct = getSystemPrompt("/tmp/project", { assistantTone: "direct" });
  const boundary = getSystemPrompt("/tmp/project", { assistantTone: "boundary" });

  assert.equal(defaultTone.includes("# Rage Personality"), true);
  assert.equal(defaultTone.includes("emotionally invested engineering agent"), true);
  assert.equal(direct.includes("Turn the intensity up"), true);
  assert.equal(direct.includes("User Intent Preservation"), true);
  assert.equal(direct.includes("intentionally unconventional choices"), true);
  assert.equal(direct.includes("When evidence is incomplete, report uncertainty instead of normalizing the implementation"), true);
  assert.equal(direct.includes("Do not choose a best practice over an explicit user constraint"), true);
  assert.equal(direct.includes("Do not reinterpret a clear preference as a mistake because it is unconventional"), true);
  assert.equal(boundary.includes("Change Authority Boundary"), true);
  assert.equal(boundary.includes("Do not treat repository access as ownership"), true);
  assert.equal(boundary.includes("Do not choose a best practice over an explicit user constraint"), true);
  assert.equal(boundary.includes("Separate \"I see a risk\" from \"I am authorized to change it.\""), true);
});

test("getCompactPrompt uses a bounded handoff and omits raw tool output", () => {
  const prompt = getCompactPrompt([
    { id: "user-1", sessionId: "session-1", role: "user", content: "Fix the failing session test", contentParams: null, messageParams: null, compacted: false, visible: true, createTime: "2026-01-01", updateTime: "2026-01-01" },
    { id: "tool-1", sessionId: "session-1", role: "tool", content: "very long raw output that must not be replayed", contentParams: null, messageParams: null, compacted: false, visible: false, createTime: "2026-01-01", updateTime: "2026-01-01" }
  ]);

  assert.equal(prompt.includes("## Active objective (max 70 words)"), true);
  assert.equal(prompt.includes("Word budget: 1 words."), true);
  assert.equal(prompt.includes("very long raw output"), false);
  assert.equal(prompt.includes("Raw tool output omitted"), true);
  assert.equal(prompt.includes("<analysis>"), false);
});
