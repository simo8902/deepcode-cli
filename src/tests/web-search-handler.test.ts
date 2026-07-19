import { afterEach, test } from "bun:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ToolExecutionContext } from "../tools/executor";
import { handleWebSearchTool } from "../tools/web-search-handler";

const tempDirs: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("WebSearch executes the configured JavaScript script with the query as one argument", async () => {
  const workspace = createTempWorkspace();
  const scriptPath = path.join(workspace, "web-search.mjs");
  fs.writeFileSync(
    scriptPath,
    [
      "console.log(`query=${process.argv[2]}`);",
      "console.log(`cwd=${process.cwd()}`);"
    ].join("\n"),
    "utf8"
  );

  const starts: Array<{ id: string | number; command: string }> = [];
  const exits: Array<string | number> = [];
  const result = await handleWebSearchTool(
    { query: "latest node release" },
    createContext(workspace, {
      webSearchTool: scriptPath,
      onProcessStart: (id, command) => starts.push({ id, command }),
      onProcessExit: (id) => exits.push(id)
    })
  );
  const realWorkspace = fs.realpathSync(workspace);

  assert.equal(result.ok, true);
  assert.equal(
    result.output,
    `query=latest node release\ncwd=${realWorkspace}\n`
  );
  assert.equal(starts.length, 1);
  assert.match(starts[0].command, /^WebSearch: latest node release$/);
  assert.deepEqual(exits, [starts[0].id]);
});

test("WebSearch uses built-in search when no script is configured", async () => {
  const workspace = createTempWorkspace();
  const fetchCalls: Array<{ input: string | URL; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    fetchCalls.push({ input, init });
    return {
      ok: true,
      text: async () => [
        '<div class="result">',
        '<a class="result__a" href="https://nodejs.org/">Node.js</a>',
        '<a class="result__snippet">JavaScript runtime</a>',
        "</div>"
      ].join("")
    } as Response;
  }) as typeof fetch;

  const result = await handleWebSearchTool(
    { query: "latest node release" },
    createContext(workspace)
  );

  assert.equal(result.ok, true);
  assert.match(result.output ?? "", /Node\.js/);
  assert.match(result.output ?? "", /https:\/\/nodejs\.org\//);
  assert.equal(fetchCalls.length, 1);
});

function createContext(
  projectRoot: string,
  options: {
    webSearchTool?: string;
    onProcessStart?: (processId: string | number, command: string) => void;
    onProcessExit?: (processId: string | number) => void;
  } = {}
): ToolExecutionContext {
  return {
    sessionId: "web-search-test",
    projectRoot,
    toolCall: {
      id: "tool-call-id",
      type: "function",
      function: {
        name: "WebSearch",
        arguments: "{}"
      }
    },
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      thinkingEnabled: false,
      webSearchTool: options.webSearchTool,
    }),
    onProcessStart: options.onProcessStart,
    onProcessExit: options.onProcessExit
  };
}

function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-web-search-"));
  tempDirs.push(dir);
  return dir;
}
