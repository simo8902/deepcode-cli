import React from "react";
import { render } from "ink";
import { App } from "./ui";
import { formatBuiltinSlashCommandHelp } from "./slash-command-manifest";

const args = process.argv.slice(2);
const packageInfo = readPackageInfo();

// Parse --resume <session_id> argument
let resumeSessionId: string | null = null;
if (args.includes("--resume")) {
  const resumeIndex = args.indexOf("--resume");
  if (resumeIndex >= 0 && resumeIndex + 1 < args.length) {
    resumeSessionId = args[resumeIndex + 1];
  } else {
    process.stderr.write("Error: --resume requires a session ID argument.\n");
    process.exit(1);
  }
}

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
      "  sbdt --resume <id> Resume a previous conversation by session ID",
      "  sbdt --version     Print the version",
      "  sbdt --help        Show this help",
      "",
      "Session Persistence:",
      "  Sessions are auto-saved on Ctrl+C or exit.",
      "  Use 'sbdt --resume <session_id>' to continue from where you left off.",
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
      ...formatBuiltinSlashCommandHelp("cli"),
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

// Track the session manager reference for SIGINT handling
let sessionManagerRef: { getActiveSessionId(): string | null; interruptActiveSession(): void } | null = null;
let inkInstanceRef: ReturnType<typeof render> | null = null;
let sessionSaved = false;

function printSessionInfo(): void {
  if (sessionSaved) return;
  sessionSaved = true;
  const sessionId = sessionManagerRef?.getActiveSessionId();
  if (sessionId) {
    process.stdout.write(`\nSession with id: ${sessionId}\n`);
  }
}

function registerExitHandler(): void {
  // Handle SIGINT (Ctrl+C) - interrupt the current turn and exit cleanly
  process.on("SIGINT", async () => {
    // Interrupt any active session turn (this updates the session entry in storage)
    sessionManagerRef?.interruptActiveSession();
    // Wait for filesystem flush, then print the session ID and exit
    setTimeout(() => {
      printSessionInfo();
      process.exit(130);
    }, 500);
  });

  // Handle normal exit (Ctrl+D, /exit command)
  process.on("exit", () => {
    printSessionInfo();
  });
}

registerExitHandler();

let isRestarting = false;

function startApp(): void {
  const inkInstance = render(
    <App
      projectRoot={projectRoot}
      version={packageInfo.version}
      resumeSessionId={resumeSessionId}
      onRestart={() => {
        isRestarting = true;
        process.stdout.write("\u001b[2J\u001b[3J\u001b[H");
        inkInstance.unmount();
        startApp();
      }}
      onSessionManagerReady={(manager) => {
        sessionManagerRef = manager;
      }}
    />,
    { exitOnCtrlC: false }
  );
  inkInstanceRef = inkInstance;

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
