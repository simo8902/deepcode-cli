import { test } from "bun:test";
import assert from "node:assert/strict";
import { buildNotifyEnv, formatDurationSeconds, launchNotifyScript, type NotifySpawn } from "../notify";
import { resolveSettings } from "../settings";

test("resolveSettings reads top-level thinkingEnabled, notify, and webSearchTool", () => {
  const resolved = resolveSettings(
    {
      env: {
        MODEL: "deepseek-v3.2",
        BASE_URL: "https://example.com/v1",
        API_KEY: "sk-test"
      },
      thinkingEnabled: true,
      reasoningEffort: "high",
      debugLogEnabled: true,
      notify: "  /tmp/notify.sh  ",
      webSearchTool: "  /tmp/web-search.sh  "
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com"
    }
  );

  assert.equal(resolved.model, "deepseek-v3.2");
  assert.equal(resolved.baseURL, "https://example.com/v1");
  assert.equal(resolved.apiKey, "sk-test");
  assert.equal(resolved.thinkingEnabled, true);
  assert.equal(resolved.reasoningEffort, "high");
  assert.equal(resolved.debugLogEnabled, true);
  assert.equal(resolved.notify, "/tmp/notify.sh");
  assert.equal(resolved.webSearchTool, "/tmp/web-search.sh");
  assert.equal(resolved.providerPrivacyMode, "off");
});

test("resolveSettings enables strict provider privacy only when explicitly configured", () => {
  assert.equal(
    resolveSettings(
      { providerPrivacyMode: "strict" },
      { model: "default-model", baseURL: "https://default.example.com" }
    ).providerPrivacyMode,
    "strict"
  );
  assert.equal(
    resolveSettings(
      { env: { PROVIDER_PRIVACY: "strict" }, providerPrivacyMode: "off" },
      { model: "default-model", baseURL: "https://default.example.com" }
    ).providerPrivacyMode,
    "strict"
  );
  assert.equal(
    resolveSettings(
      { env: { providerPrivacyMode: "strict" } },
      { model: "default-model", baseURL: "https://default.example.com" }
    ).providerPrivacyMode,
    "strict"
  );
  assert.equal(
    resolveSettings(
      { env: { PROVIDER_PRIVACY: "anything-else" } },
      { model: "default-model", baseURL: "https://default.example.com" }
    ).providerPrivacyMode,
    "off"
  );
});

test("resolveSettings still accepts legacy env.THINKING and defaults reasoning effort when absent", () => {
  const resolved = resolveSettings(
    {
      env: {
        THINKING: "enabled"
      }
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com"
    }
  );

  assert.equal(resolved.thinkingEnabled, true);
  assert.equal(resolved.reasoningEffort, "xhigh");
  assert.equal(resolved.model, "default-model");
  assert.equal(resolved.baseURL, "https://default.example.com");
});

test("resolveSettings defaults DeepSeek v4 models to thinking mode", () => {
  const resolved = resolveSettings(
    {
      env: {
        MODEL: "deepseek-v4-flash"
      }
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com"
    }
  );

  assert.equal(resolved.thinkingEnabled, true);
});

test("resolveSettings applies thinking defaults to the fallback model", () => {
  const resolved = resolveSettings(
    {},
    {
      model: "deepseek-v4-pro",
      baseURL: "https://default.example.com"
    }
  );

  assert.equal(resolved.model, "deepseek-v4-pro");
  assert.equal(resolved.thinkingEnabled, true);
});

test("resolveSettings keeps thinking mode off by default for other models", () => {
  const resolved = resolveSettings(
    {
      env: {
        MODEL: "deepseek-v3.2"
      }
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com"
    }
  );

  assert.equal(resolved.thinkingEnabled, false);
});

test("resolveSettings allows explicit thinkingEnabled to override model defaults", () => {
  const resolved = resolveSettings(
    {
      env: {
        MODEL: "deepseek-v4-pro"
      },
      thinkingEnabled: false
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com"
    }
  );

  assert.equal(resolved.thinkingEnabled, false);
});

test("resolveSettings enables prompt improvement by default and allows disabling it", () => {
  const defaults = { model: "default-model", baseURL: "https://default.example.com" };

  assert.equal(resolveSettings({}, defaults).promptImprovementEnabled, true);
  assert.equal(resolveSettings({ promptImprovementEnabled: false }, defaults).promptImprovementEnabled, false);
});

test("resolveSettings defaults assistant tone to neutral and accepts direct and boundary", () => {
  const defaults = { model: "default-model", baseURL: "https://default.example.com" };

  assert.equal(resolveSettings({}, defaults).assistantTone, "neutral");
  assert.equal(resolveSettings({ assistantTone: "direct" }, defaults).assistantTone, "direct");
  assert.equal(resolveSettings({ assistantTone: "boundary" }, defaults).assistantTone, "boundary");
});

test("resolveSettings bounds max agent iterations and defaults to 64", () => {
  const defaults = { model: "default-model", baseURL: "https://default.example.com" };

  assert.equal(resolveSettings({}, defaults).maxAgentIterations, 64);
  assert.equal(resolveSettings({ maxAgentIterations: 3 }, defaults).maxAgentIterations, 3);
  assert.equal(resolveSettings({ maxAgentIterations: 0 }, defaults).maxAgentIterations, 1);
  assert.equal(resolveSettings({ maxAgentIterations: 5000 }, defaults).maxAgentIterations, 1000);
  assert.equal(resolveSettings({ maxAgentIterations: 3.5 }, defaults).maxAgentIterations, 64);
});

test("resolveSettings exposes a configured Hermes repository path", () => {
  const defaults = { model: "default-model", baseURL: "https://default.example.com" };

  assert.equal(resolveSettings({ hermesRepoDir: "  C:\\tools\\hermes  " }, defaults).hermesRepoDir, "C:\\tools\\hermes");
});

test("resolveSettings exposes a configured filesystem MCP entry point", () => {
  const defaults = { model: "default-model", baseURL: "https://default.example.com" };

  assert.equal(resolveSettings({ filesystemMcpPath: "  C:\\tools\\filesystem\\index.js  " }, defaults).filesystemMcpPath, "C:\\tools\\filesystem\\index.js");
});

test("resolveSettings defaults invalid reasoning effort to xhigh", () => {
  const resolved = resolveSettings(
    {
      reasoningEffort: "invalid" as never
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com"
    }
  );

  assert.equal(resolved.reasoningEffort, "xhigh");
});

test("resolveSettings maps max reasoning effort to xhigh", () => {
  const resolved = resolveSettings(
    {
      reasoningEffort: "max" as never
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com"
    }
  );

  assert.equal(resolved.reasoningEffort, "xhigh");
});

test("formatDurationSeconds preserves sub-second precision and trims trailing zeros", () => {
  assert.equal(formatDurationSeconds(0), "0");
  assert.equal(formatDurationSeconds(1250), "1");
  assert.equal(formatDurationSeconds(4000), "4");
});

test("buildNotifyEnv injects DURATION", () => {
  const env = buildNotifyEnv(2750, { HOME: "/tmp/home" });
  assert.equal(env.HOME, "/tmp/home");
  assert.equal(env.DURATION, "2");
});

test("launchNotifyScript passes DURATION and falls back to /bin/sh for non-executable scripts", () => {
  const originalPlatform = process.platform;
  const calls: Array<{
    command: string;
    args: string[];
    options: { cwd?: string | URL; env?: NodeJS.ProcessEnv };
  }> = [];

  const spawnProcess: NotifySpawn = (command, args, options) => {
    calls.push({ command, args, options: { cwd: options.cwd, env: options.env } });

    return {
      once(event, listener) {
        if (event === "error" && calls.length === 1) {
          listener({ code: "EACCES" } as NodeJS.ErrnoException);
        }
        return this;
      },
      unref() {
        return undefined;
      }
    };
  };

  Object.defineProperty(process, "platform", { value: "linux" });
  try {
    launchNotifyScript("/tmp/notify.sh", 2750, "/tmp/project", spawnProcess);
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  }

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.command, "/tmp/notify.sh");
  assert.deepEqual(calls[0]?.args, []);
  assert.equal(calls[0]?.options.cwd, "/tmp/project");
  assert.equal(calls[0]?.options.env?.DURATION, "2");
  assert.equal(calls[1]?.command, "/bin/sh");
  assert.deepEqual(calls[1]?.args, ["/tmp/notify.sh"]);
  assert.equal(calls[1]?.options.cwd, "/tmp/project");
  assert.equal(calls[1]?.options.env?.DURATION, "2");
});
