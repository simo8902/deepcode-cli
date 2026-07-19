import { test } from "bun:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const ORIGINAL_PATH = process.env.PATH;
const ORIGINAL_PLATFORM = process.platform;

function withCleanPath<T>(fn: () => T): T {
  process.env.PATH = "/nonexistent-bin-dir";
  try {
    return fn();
  } finally {
    process.env.PATH = ORIGINAL_PATH;
  }
}

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  Object.defineProperty(process, "platform", { value: platform });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", { value: ORIGINAL_PLATFORM });
  }
}

test("readClipboardImage returns null when no clipboard helpers are installed", async () => {
  // Reload module so it picks up the patched PATH at spawn time.
  const moduleUrl = new URL(`../ui/clipboard.ts?t=${Date.now()}`, import.meta.url).href;
  const { readClipboardImage } = await import(moduleUrl) as typeof import("../ui/clipboard");
  const result = withCleanPath(() => readClipboardImage());
  assert.equal(result, null);
});

const macFallbackTest = ORIGINAL_PLATFORM === "win32" ? test.skip : test;

macFallbackTest("readClipboardImage uses osascript fallback on macOS when pngpaste is missing", async () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-clipboard-test-bin-"));
  try {
    const executableExtension = ORIGINAL_PLATFORM === "win32" ? ".cmd" : "";
    fs.writeFileSync(
      path.join(binDir, `pngpaste${executableExtension}`),
      ORIGINAL_PLATFORM === "win32" ? "@exit /b 1\r\n" : "#!/bin/sh\nexit 1\n",
      { mode: 0o755 }
    );
    const osascriptPath = path.join(binDir, `osascript${executableExtension}`);
    if (ORIGINAL_PLATFORM === "win32") {
      fs.writeFileSync(
        path.join(binDir, "osascript.js"),
        [
          "const fs = require('fs');",
          "const arg = process.argv.find((value) => value.includes('POSIX file'));",
          "const match = arg && /POSIX file \\\"([^\\\"]+)\\\"/.exec(arg);",
          "if (!match) process.exit(1);",
          "fs.writeFileSync(match[1], 'fakepng');"
        ].join("\n"),
        "utf8"
      );
      fs.writeFileSync(
        osascriptPath,
        `@echo off\r\n\"${process.execPath}\" \"%~dp0osascript.js\" %*\r\n`,
        "utf8"
      );
    } else {
    fs.writeFileSync(
      osascriptPath,
      [
        "#!/bin/sh",
        "for arg in \"$@\"; do",
        "  case \"$arg\" in",
        "    *'open for access POSIX file '*)",
        "      path_part=${arg#*POSIX file }",
        "      out_path=${path_part#\\\"}",
        "      out_path=${out_path%%\\\"*}",
        "      printf fakepng > \"$out_path\"",
        "      exit 0",
        "      ;;",
        "  esac",
        "done",
        "exit 1",
        ""
      ].join("\n"),
      { mode: 0o755 }
    );
    }

    const moduleUrl = new URL(`../ui/clipboard.ts?t=${Date.now()}`, import.meta.url).href;
    const { readClipboardImage } = await import(moduleUrl) as typeof import("../ui/clipboard");

    process.env.PATH = binDir;
    const result = withPlatform("darwin", () => readClipboardImage());
    assert.equal(result?.mimeType, "image/png");
    assert.equal(result?.dataUrl, `data:image/png;base64,${Buffer.from("fakepng").toString("base64")}`);
  } finally {
    process.env.PATH = ORIGINAL_PATH;
    Object.defineProperty(process, "platform", { value: ORIGINAL_PLATFORM });
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});
