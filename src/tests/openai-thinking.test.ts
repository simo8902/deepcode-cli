import { test } from "bun:test";
import assert from "node:assert/strict";
import { buildThinkingRequestOptions } from "../openai-thinking";

test("buildThinkingRequestOptions explicitly disables thinking", () => {
  assert.deepEqual(buildThinkingRequestOptions(false, "https://api.deepseek.com"), {
    thinking: { type: "disabled" }
  });
});

test("buildThinkingRequestOptions uses the same disabled payload for volces endpoints", () => {
  assert.deepEqual(
    buildThinkingRequestOptions(false, "https://ark.cn-beijing.volces.com/api/v3"),
    {
      thinking: { type: "disabled" }
    }
  );
});

test("buildThinkingRequestOptions enables thinking with default reasoning effort", () => {
  assert.deepEqual(
    buildThinkingRequestOptions(true, "https://api.deepseek.com"),
    {
      thinking: { type: "enabled" },
      reasoning_effort: "xhigh"
    }
  );
});

test("buildThinkingRequestOptions uses the same enabled payload for volces endpoints", () => {
  assert.deepEqual(
    buildThinkingRequestOptions(true, "https://ark.cn-beijing.volces.com/api/v3"),
    {
      thinking: { type: "enabled" },
      reasoning_effort: "xhigh"
    }
  );
});

test("buildThinkingRequestOptions accepts high reasoning effort", () => {
  assert.deepEqual(
    buildThinkingRequestOptions(true, "https://api.deepseek.com", "high"),
    {
      thinking: { type: "enabled" },
      reasoning_effort: "high"
    }
  );
});

test("buildThinkingRequestOptions omits provider routing when only ZDR is configured for isolation", () => {
  assert.deepEqual(
    buildThinkingRequestOptions(true, "https://openrouter.ai/api/v1", "low", undefined, true),
    {
      reasoning: { effort: "low" },
      provider: { allow_fallbacks: true, zdr: true }
    }
  );
});

test("buildThinkingRequestOptions pins providers and disables fallback routing without privacy filters", () => {
  assert.deepEqual(
    buildThinkingRequestOptions(true, "https://openrouter.ai/api/v1", "low", "deepinfra", true),
    {
      reasoning: { effort: "low" },
      provider: {
        allow_fallbacks: false,
        only: ["deepinfra"],
        zdr: true
      }
    }
  );
});

test("buildThinkingRequestOptions omits DeepSeek thinking fields for OpenRouter when disabled", () => {
  assert.deepEqual(
    buildThinkingRequestOptions(false, "https://openrouter.ai/api/v1", "low", "siliconflow", true),
    {
      provider: {
        allow_fallbacks: false,
        only: ["siliconflow"],
        zdr: true
      }
    }
  );
});
