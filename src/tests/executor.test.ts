import { test } from "bun:test";
import assert from "node:assert/strict";
import { ToolExecutor, type ToolHandler } from "../tools/executor";

test("ToolExecutor keeps the first handler when a later backend collides", () => {
  const executor = new ToolExecutor(process.cwd());
  const firstHandler: ToolHandler = async () => ({ ok: true, name: "collision-tool" });
  const laterHandler: ToolHandler = async () => ({ ok: true, name: "collision-tool" });

  (executor as any).registerToolHandler("collision-tool", firstHandler, "first backend");
  (executor as any).registerToolHandler("collision-tool", laterHandler, "later backend");

  assert.equal(executor.getToolHandlerSource("collision-tool"), "first backend");
  assert.equal((executor as any).toolHandlers.get("collision-tool"), firstHandler);
});

test("ToolExecutor restores only a fully completed architecture gate", () => {
  const executor = new ToolExecutor(process.cwd());

  executor.restoreCompletedArchitectureGate("completed-session", true);
  assert.equal(executor.isArchitectureGateComplete("completed-session"), true);

  (executor as any).architectureGates.set("limited-fallback-session", {
    projectsListed: true,
    indexStatusChecked: true,
    indexReady: true,
    architectureMapped: true,
    serenaInitialized: true,
    fallbackApproved: true
  });
  assert.equal(executor.isArchitectureGateComplete("limited-fallback-session"), false);

  executor.restoreCompletedArchitectureGate("incomplete-session", false);
  assert.equal(executor.isArchitectureGateComplete("incomplete-session"), false);
});

test("ToolExecutor enforces C++ architecture discovery before Serena symbol work", async () => {
  const executor = new ToolExecutor(process.cwd());
  const handlers = (executor as any).toolHandlers as Map<string, ToolHandler>;
  for (const name of ["initial_instructions", "list_projects", "index_status", "index_repository", "get_architecture", "find_symbol"]) {
    handlers.set(name, async () => ({
      ok: true,
      name,
      output: name === "index_status" ? '{"status":"ready"}' : "ok"
    }));
  }

  const grounding = {
    architectureMappingRequired: true,
    sideEffectConfirmationRequired: false,
  } as any;
  const call = (id: string, name: string) => ({
    id,
    type: "function",
    function: { name, arguments: "{}" }
  });

  const blocked = await executor.executeToolCalls("cpp-architecture-session", [call("blocked", "find_symbol")], { grounding });
  assert.equal(blocked[0]?.result.ok, false);
  assert.match(blocked[0]?.result.error ?? "", /initial_instructions/);

  for (const [id, name] of [
    ["serena", "initial_instructions"],
    ["projects", "list_projects"],
    ["status", "index_status"],
    ["index", "index_repository"],
    ["architecture", "get_architecture"],
  ]) {
    const result = await executor.executeToolCalls("cpp-architecture-session", [call(id, name)], { grounding });
    assert.equal(result[0]?.result.ok, true, `${name} should be allowed at its required stage`);
  }

  const allowed = await executor.executeToolCalls("cpp-architecture-session", [call("symbol", "find_symbol")], { grounding });
  assert.equal(allowed[0]?.result.ok, true);
  assert.equal(executor.isArchitectureGateComplete("cpp-architecture-session"), true);
});
