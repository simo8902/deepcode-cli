import { test } from "bun:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionManager, type SkillInfo } from "../../session";

const sessionE2ETest = process.env.SBDT_RUN_E2E === "1" ? test : test.skip;

type ProviderRequest = Record<string, unknown>;

class FakeOpenAIProvider {
  readonly requests: ProviderRequest[] = [];

  constructor(private readonly responses: unknown[]) {}

  create = async (request: ProviderRequest): Promise<unknown> => {
    this.requests.push(request);
    const response = this.responses.shift();
    assert.notEqual(response, undefined, "the local fake provider ran out of responses");
    return response;
  };

  readonly client = {
    chat: {
      completions: {
        create: this.create,
      }
    }
  };
}

function createProvider(responses: unknown[]): FakeOpenAIProvider {
  return new FakeOpenAIProvider(responses);
}

function chatResponse(content: string): unknown {
  return { choices: [{ message: { content } }], usage: { total_tokens: 1 } };
}

function toolCallResponse(id: string, name: string, args: Record<string, unknown>): unknown {
  return {
    choices: [{
      message: {
        content: "",
        tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }]
      }
    }],
    usage: { total_tokens: 1 }
  };
}

function messageText(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
      ? (part as { text: string }).text
      : "")
    .join("\n");
}

function createManager(projectRoot: string, provider: FakeOpenAIProvider): SessionManager {
  return new SessionManager({
    warmMcpOnInit: false,
    enableHermesMemory: false,
    projectRoot,
    createOpenAIClient: () => ({
      client: provider.client as any,
      model: "e2e-local-fake",
      baseURL: "http://127.0.0.1:1/fake-provider",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ promptImprovementEnabled: true }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
}

sessionE2ETest("full session keeps ordered instructions, replays tool results, and grounds clarification through the local fake provider", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sbdt-session-e2e-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sbdt-session-e2e-home-"));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalFetch = globalThis.fetch;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  globalThis.fetch = (() => { throw new Error("E2E provider network access is disabled"); }) as typeof fetch;

  try {
    fs.writeFileSync(path.join(workspace, "AGENTS.md"), "# Project instruction\nPROJECT-E2E-INSTRUCTION\n", "utf8");
    const skillDir = path.join(workspace, ".agents", "skills", "fixture-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: fixture-skill\ndescription: E2E fixture skill\n---\nSKILL-E2E-INSTRUCTION\n", "utf8");
    fs.writeFileSync(path.join(workspace, "app.py"), "def greet():\n    return 'hello'\n", "utf8");

    const explicitSkill: SkillInfo = {
      name: "fixture-skill",
      path: "./.agents/skills/fixture-skill/SKILL.md",
      description: "E2E fixture skill",
      source: "project",
    };
    const concreteProvider = createProvider([
      toolCallResponse("e2e-tool-call", "e2e_echo", { value: "fixture" }),
      chatResponse("The fixture tool result was replayed."),
    ]);
    const concreteManager = createManager(workspace, concreteProvider);
    (concreteManager as any).toolExecutor.toolHandlers.set("e2e_echo", async () => ({
      ok: true,
      name: "e2e_echo",
      output: "fixture tool output",
    }));

    const sessionId = await concreteManager.createSession({
      text: "Read app.py and report the exported function.",
      skills: [explicitSkill],
    });
    assert.equal(concreteManager.getSession(sessionId)?.status, "completed");
    assert.equal(concreteProvider.requests.length, 2, "a concrete prompt must not call the prompt improver");

    const firstRequestMessages = concreteProvider.requests[0]?.messages as Array<Record<string, unknown>>;
    assert.equal(firstRequestMessages[0]?.role, "system");
    const mergedSystemInstructions = messageText(firstRequestMessages[0] ?? {});
    const hostIndex = mergedSystemInstructions.indexOf("# Rage Personality");
    const defaultSkillIndex = mergedSystemInstructions.indexOf("agent-drift-guard-skill");
    const projectInstructionIndex = mergedSystemInstructions.indexOf("PROJECT-E2E-INSTRUCTION");
    const explicitSkillIndex = mergedSystemInstructions.indexOf("SKILL-E2E-INSTRUCTION");
    const userIndex = firstRequestMessages.findIndex((message) => message.role === "user" && messageText(message).includes("Read app.py"));
    assert.ok(hostIndex >= 0 && hostIndex < defaultSkillIndex);
    assert.ok(defaultSkillIndex < projectInstructionIndex);
    assert.ok(projectInstructionIndex < explicitSkillIndex);
    assert.equal(userIndex, 1, "the user request must follow the merged system instruction block");
    assert.equal(firstRequestMessages.some((message) => messageText(message).includes("You are sbdt's prompt improver")), false);

    const secondRequestMessages = concreteProvider.requests[1]?.messages as Array<Record<string, unknown>>;
    const replayedToolMessage = secondRequestMessages.find((message) => message.role === "tool");
    assert.ok(replayedToolMessage, "the model's second request must receive the tool result");
    assert.match(messageText(replayedToolMessage), /fixture tool output/);
    assert.equal(replayedToolMessage.tool_call_id, "e2e-tool-call");

    await concreteManager.flushPersistence();
    const { projectDir } = (concreteManager as any).getProjectStorage();
    const trace = fs.readFileSync(path.join(projectDir, `${sessionId}.prompt-trace.md`), "utf8");
    assert.match(trace, /Instruction sources/);
    assert.match(trace, /fixture-skill \[project; explicit\]/);
    assert.match(trace, /Tool execution provenance/);
    assert.match(trace, /e2e_echo \(e2e-tool-call\): ok/);

    const clarificationProvider = createProvider([
      toolCallResponse("clarification-call", "AskUserQuestion", {
        questions: [{
          question: "Which concrete file should I fix?",
          options: [{ label: "app.py", description: "Use the known fixture." }],
        }],
      }),
    ]);
    const clarificationManager = createManager(workspace, clarificationProvider);
    const clarificationSessionId = await clarificationManager.createSession({ text: "Fix it", skills: [explicitSkill] });
    assert.equal(clarificationManager.getSession(clarificationSessionId)?.status, "waiting_for_user");
    assert.equal(clarificationProvider.requests.length, 1);
    const clarificationRequestMessages = clarificationProvider.requests[0]?.messages as Array<Record<string, unknown>>;
    assert.match(messageText(clarificationRequestMessages[0] ?? {}), /Clarification reason: The request does not identify a concrete target or artifact yet/);
    const clarificationMessages = clarificationManager.listSessionMessages(clarificationSessionId);
    assert.ok(clarificationMessages.some((message) => message.content?.includes("Clarification needed before I can act: The request does not identify a concrete target or artifact yet.")));
    assert.ok(clarificationMessages.some((message) => message.role === "tool" && message.content?.includes("Which concrete file should I fix?")));
    await clarificationManager.flushPersistence();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
