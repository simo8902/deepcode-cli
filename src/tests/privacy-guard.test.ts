import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertNoHighRiskSecretsForModel,
  sanitizeForProviderStrict,
  sanitizeForModelPipeline,
  sanitizeToolCallsForReplay
} from "../privacy-guard";

test("sanitizeForModelPipeline redacts tool output and marks high-risk secrets", () => {
  const result = sanitizeForModelPipeline({
    output:
      "token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature " +
      "jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature " +
      "path=C:\\Users\\Simeon\\Documents\\secret.txt",
    metadata: {
      key: "api_key=sk-or-abcdef1234567890"
    }
  });

  assert.equal(result.redactedSensitiveContent, true);
  const value = result.value as { output: string; metadata: { key: string } };
  assert.match(value.output, /\[REDACTED_JWT\]/);
  assert.match(value.output, /token=\[REDACTED_SECRET\]/);
  assert.match(value.output, /\[REDACTED_PATH\]/);
  assert.match(value.metadata.key, /\[REDACTED_SECRET\]/);
  assert.doesNotMatch(JSON.stringify(result.value), /eyJhbGci/);
  assert.doesNotMatch(JSON.stringify(result.value), /sk-or-/);
});

test("sanitizeForModelPipeline redacts private keys before model replay", () => {
  const result = sanitizeForModelPipeline({
    output: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"
  });

  assert.equal(result.redactedSensitiveContent, true);
  assert.deepEqual(result.value, { output: "[REDACTED_PRIVATE_KEY]" });
});

test("sanitizeToolCallsForReplay redacts function arguments", () => {
  const sanitized = sanitizeToolCallsForReplay([
    {
      id: "call_1",
      type: "function",
      function: {
        name: "read",
        arguments: "{\"file_path\":\"C:\\\\repo\\\\secret.env\"}"
      }
    }
  ]);

  assert.deepEqual(sanitized, [
    {
      id: "call_1",
      type: "function",
      function: {
        name: "read",
        arguments: "{\"redacted\":true}"
      }
    }
  ]);
});

test("assertNoHighRiskSecretsForModel does not block outbound model requests", () => {
  assert.doesNotThrow(
    () =>
      assertNoHighRiskSecretsForModel({
        messages: [
          {
            role: "tool",
            content: "secret=sk-or-abcdef1234567890"
          }
        ]
      }),
  );
});

test("assertNoHighRiskSecretsForModel allows generic test passwords", () => {
  assert.doesNotThrow(() =>
    assertNoHighRiskSecretsForModel({
      messages: [
        {
          role: "user",
          content: "ok password: 454525234"
        }
      ]
    })
  );
});

test("sanitizeForModelPipeline redacts generic password assignments without stopping", () => {
  const result = sanitizeForModelPipeline({
    output: "password: 454525234",
    userContent: "im giving test password 1234523 note it"
  });

  assert.equal(result.redactedSensitiveContent, false);
  assert.deepEqual(result.value, {
    output: "password:[REDACTED_SECRET]",
    userContent: "im giving test password [REDACTED_SECRET] note it"
  });
});

test("sanitizeForModelPipeline redacts unknown high-entropy tokens without blocking", () => {
  const token = "A7fK9pQ2rT6vX1mN8bC4dE5gH3jL0sZyWqR";
  const result = sanitizeForModelPipeline({
    output: `session token ${token}`
  });

  assert.equal(result.redactedSensitiveContent, true);
  assert.deepEqual(result.value, {
    output: "session token [REDACTED_HIGH_ENTROPY_SECRET]"
  });
});

test("sanitizeForModelPipeline redacts test tokens without stopping", () => {
  const token = "A7fK9pQ2rT6vX1mN8bC4dE5gH3jL0sZyWqR";
  const result = sanitizeForModelPipeline({
    output: `fixture test token ${token}`,
    metadata: {
      key: "example api_key=sk-or-abcdef1234567890"
    }
  });

  assert.equal(result.redactedSensitiveContent, false);
  assert.deepEqual(result.value, {
    output: "fixture test token [REDACTED_HIGH_ENTROPY_SECRET]",
    metadata: {
      key: "example api_key=[REDACTED_SECRET]"
    }
  });
});

test("sanitizeForModelPipeline does not flag low-entropy placeholder strings", () => {
  const placeholder = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const result = sanitizeForModelPipeline({
    output: `placeholder ${placeholder}`
  });

  assert.equal(result.redactedSensitiveContent, false);
  assert.deepEqual(result.value, {
    output: `placeholder ${placeholder}`
  });
});

test("sanitizeForProviderStrict redacts credentials but preserves paths and ordinary code context", () => {
  const result = sanitizeForProviderStrict({
    messages: [
      {
        role: "tool",
        content:
          "file C:\\Users\\Simeon\\Documents\\repo\\main.cpp has token_count=42 " +
          "and api_key=sk-or-abcdef1234567890"
      },
      {
        role: "tool",
        content:
          "read /home/simeon/repo/src/main.cpp and password: local-test-value " +
          "grep PRODUCTION_PASSWORD\\|Prod34126412"
      },
      {
        role: "assistant",
        content:
          "#define PRODUCTION_PASSWORD !Prod34126412\n" +
          "Babe... it's literally `!Prod34126412` wrapped in `PRODUCTION_PASSWORD`."
      }
    ]
  });

  assert.equal(result.redactedSensitiveContent, true);
  const serialized = JSON.stringify(result.value);
  assert.match(serialized, /C:\\\\Users\\\\Simeon\\\\Documents\\\\repo\\\\main\.cpp/);
  assert.match(serialized, /\/home\/simeon\/repo\/src\/main\.cpp/);
  assert.match(serialized, /token_count=42/);
  assert.match(serialized, /PRODUCTION_PASSWORD/);
  assert.doesNotMatch(serialized, /local-test-value/);
  assert.doesNotMatch(serialized, /Prod34126412/);
  assert.doesNotMatch(serialized, /!Prod/);
  assert.doesNotMatch(serialized, /sk-or-/);
  assert.match(serialized, /\[REDACTED_API_KEY\]/);
  assert.match(serialized, /\[REDACTED_SECRET\]/);
});
