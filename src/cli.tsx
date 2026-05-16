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
      "deepcode - Deep Shit CLI",
      "",
      "Usage:",
      "  deepcode               Launch the interactive TUI in the current directory",
      "  deepcode --version     Print the version",
      "  deepcode --help        Show this help",
      "",
      "Configuration:",
      "  ~/.deepcode/settings.json   API key, model, base URL",
      "  ~/.agents/skills/*/SKILL.md  User-level skills",
      "  ./.agents/skills/*/SKILL.md  Project-level skills",
      "  ./.deepcode/skills/*/SKILL.md Legacy project-level skills",
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
      "  /exit            Quit",
      "  ctrl+d twice     Quit"
    ].join("\n") + "\n"
  );
  process.exit(0);
}

const projectRoot = process.cwd();

if (!process.stdin.isTTY) {
  process.stderr.write(
    "deepcode requires an interactive terminal (TTY). " +
      "Re-run from a real terminal session.\n"
  );
  process.exit(1);
}

const restartRef: { current: (() => void) | null } = { current: null };

function startApp(): void {
  const inkInstance = render(
    <App
      projectRoot={projectRoot}
      version={packageInfo.version}
      onRestart={() => restartRef.current?.()}
    />,
    { exitOnCtrlC: false }
  );

  restartRef.current = () => {
    process.stdout.write("[2J[3J[H");
    inkInstance.unmount();
    startApp();
  };

  inkInstance.waitUntilExit().then(() => {
    if (!restartRef.current) {
      process.exit(0);
    }
  });
}

startApp();

function readPackageInfo(): { name: string; version: string } {
  try {
    const pkg = require("../package.json") as { name?: unknown; version?: unknown };
    return {
      name: typeof pkg.name === "string" ? pkg.name : "simo/deepshit-cli",
      version: typeof pkg.version === "string" ? pkg.version : ""
    };
  } catch {
    return { name: "simo/deepshit-cli", version: "" };
  }
}
