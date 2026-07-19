import { test } from "bun:test";
import assert from "node:assert/strict";
import { evaluateNudges, isVaguePrompt } from "../prompt-improver";

test("concrete requests receive no generic prompt-improvement context", () => {
  assert.equal(evaluateNudges("fix src/session.ts"), null);
  assert.equal(evaluateNudges("update the README with the test command"), null);
});

test("only explicit cross-cutting scope receives orchestration guidance", () => {
  const guidance = evaluateNudges("migrate multiple modules to the new session format");

  assert.match(guidance ?? "", /cross-cutting change/);
  assert.match(guidance ?? "", /architecture or multi-module scope/);
});

test("slash commands and explicit bypasses receive no nudge", () => {
  assert.equal(evaluateNudges("/init"), null);
  assert.equal(evaluateNudges("*fix src/session.ts"), null);
});

test("clarification eligibility requires an underspecified task", () => {
  assert.equal(isVaguePrompt("fix it"), true);
  assert.equal(isVaguePrompt("fix src/session.ts"), false);
  assert.equal(isVaguePrompt("/init"), false);
});
