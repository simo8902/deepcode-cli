import { test } from "bun:test";
import assert from "node:assert/strict";
import { buildGroundingContract, mergeGroundingContract, requiresArchitectureMapping } from "../grounding";

test("persistent memory authorization applies only to the current turn", () => {
  const first = buildGroundingContract("session-1", "remember this preference");
  const next = buildGroundingContract(
    "session-1",
    "inspect src/session.ts",
    ["remember this preference"],
    first
  );
  const merged = mergeGroundingContract(first, next);

  assert.equal(first.persistentMemoryWriteAuthorized, true);
  assert.equal(merged.persistentMemoryWriteAuthorized, false);
});

test("architecture mapping requires both C++ scope and an architecture intent", () => {
  assert.equal(requiresArchitectureMapping("review the architecture"), false);
  assert.equal(requiresArchitectureMapping("use Serena to inspect this TypeScript function"), false);
  assert.equal(requiresArchitectureMapping("map callers in the C++ rendering architecture"), true);
  assert.equal(requiresArchitectureMapping("inspect src/renderer.cpp"), false);
});

test("an explicit answer keeps C++ architecture mapping for the same task only", () => {
  const initial = buildGroundingContract("session-1", "map callers in the C++ renderer");
  const approval = buildGroundingContract("session-1", "yes", [], initial);
  const unrelated = buildGroundingContract("session-1", "review the TypeScript architecture", [], approval);

  assert.equal(initial.architectureMappingRequired, true);
  assert.equal(approval.architectureMappingRequired, true);
  assert.equal(unrelated.architectureMappingRequired, false);
});
