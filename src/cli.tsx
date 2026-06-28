import React from "react";
import { render } from "ink";
import { App } from "./ui";

const args = process.argv.slice(2);
const packageInfo = readPackageInfo();

if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(`${packageInfo.version || "unknown"}\n`);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    [
      "sbdt - SimoByteDaemon Tool",
      "",
      "Usage:",
      "  sbdt               Launch the interactive TUI in the current directory",
      "  sbdt --version     Print the version",
      "  sbdt --help        Show this help",
      "",
      "Configuration:",
      "  ~/.sbdt/settings.json        API key, model, base URL",
      "  ~/.agents/skills/*/SKILL.md  User-level skills",
      "  ./.agents/skills/*/SKILL.md  Project-level skills",
      "  ./.sbdt/skills/*/SKILL.md    Legacy project-level skills",
      "",
      "Inside the TUI:",
      "  enter            Send the prompt",
      "  shift+enter      Insert a newline",
      "  home/end         Move within the current line",
      "  alt+left/right   Move by word",
      "  ctrl+w           Delete the previous word",
      "  ctrl+v           Paste an image from the clipboard",
      "  ctrl+x           Clear pasted images",
      "  esc              Interrupt the current model turn",
      "  /                Open the skills/commands menu",
      "  /new             Start a fresh conversation",
      "  /init            Initialize an AGENTS.md file with instructions for LLM",
      "  /resume          Pick a previous conversation to continue",
      "  /CE              Reconnect to Cheat Engine MCP server",
      "  /exit            Quit",
      "  ctrl+d twice     Quit"
    ].join("\n") + "\n"
  );
  process.exit(0);
}

const projectRoot = process.cwd();

if (!process.stdin.isTTY) {
  process.stderr.write(
    "sbdt requires an interactive terminal (TTY). " +
      "Re-run from a real terminal session.\n"
  );
  process.exit(1);
}

let isRestarting = false;

function startApp(): void {
  const inkInstance = render(
    <App
      projectRoot={projectRoot}
      version={packageInfo.version}
      onRestart={() => {
        isRestarting = true;
        process.stdout.write("\u001b[2J\u001b[3J\u001b[H");
        inkInstance.unmount();
        startApp();
      }}
    />,
    { exitOnCtrlC: false }
  );

  inkInstance.waitUntilExit().then(() => {
    if (!isRestarting) {
      process.exit(0);
    }
    isRestarting = false;
  });
}

startApp();

function readPackageInfo(): { name: string; version: string } {
  try {
    const pkg = require("../package.json") as { name?: unknown; version?: unknown };
    return {
      name: typeof pkg.name === "string" ? pkg.name : "simobytedaemontool",
      version: typeof pkg.version === "string" ? pkg.version : ""
    };
  } catch {
    return { name: "simobytedaemontool", version: "" };
  }
}
