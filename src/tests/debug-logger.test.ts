import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getDebugLogPath, logOpenAIChatCompletionDebug } from "../debug-logger";

test("debug logger appends sanitized entries without rotation", () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-debug-log-home-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    for (let index = 0; index < 25; index += 1) {
      logOpenAIChatCompletionDebug({
        timestamp: "2026-01-01T00:00:00.000Z",
        location: "test.location",
        requestId: `request-${index}`,
        model: "test-model",
        request: {
          model: "test-model",
          messages: [{ role: "user", content: `full request content ${index}` }],
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "read",
                arguments: "{\"file_path\":\"C:\\\\repo\\\\secret.env\"}"
              }
            }
          ],
          apiKey: "sk-test-secret"
        },
        response: {
          choices: [
            {
              message: {
                content: `full response content ${index}`,
                reasoning_content: `hidden reasoning content ${index}`,
                reasoning_details: [{ text: `provider reasoning detail ${index}` }]
              }
            }
          ]
        }
      });
    }

    const raw = fs.readFileSync(getDebugLogPath(), "utf8");
    const lines = raw.trim().split("\n");
    assert.equal(lines.length, 25);

    const first = JSON.parse(lines[0]) as Record<string, any>;
    const last = JSON.parse(lines[24]) as Record<string, any>;
    assert.equal(first.requestId, "request-0");
    assert.equal(first.request.messages[0].content, "[REDACTED content, 22 chars]");
    assert.equal(
      first.request.tool_calls[0].function.arguments,
      "[REDACTED tool arguments, 36 chars]"
    );
    assert.equal(first.request.apiKey, "***MASKED***");
    assert.equal(last.requestId, "request-24");
    assert.equal(last.response.choices[0].message.content, "[REDACTED content, 24 chars]");
    assert.equal(
      last.response.choices[0].message.reasoning_content,
      "[REDACTED content, 27 chars]"
    );
    assert.equal(last.response.choices[0].message.reasoning_details, "[REDACTED content field]");
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
  }
});
