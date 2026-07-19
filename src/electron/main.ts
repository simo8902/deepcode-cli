import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import { SessionManager, type SessionMessage, type SessionEntry, type LlmStreamProgress } from "../session";
import { getBuiltinSlashCommandNames } from "../slash-command-manifest";
import { createOpenAIClient, resolveCurrentSettings, readSettings } from "../client-factory";
import { IPC } from "./ipc-channels";

const isDev = process.env.SBDT_DEV === "1";

let mainWindow: BrowserWindow | null = null;
let sessionManager: SessionManager | null = null;
let modelOverride: string | null = null;

function handleModelCommand(fullText: string): string {
  const parts = fullText.split(/\s+/);
  const modelName = parts.slice(1).join(" ").trim();
  const settings = readSettings() ?? {};
  const models = settings.models ?? {};

  if (!modelName) {
    const entries = Object.entries(models);
    if (entries.length === 0) {
      return "No saved models. Add them in ~/.sbdt/settings.json under 'models'.";
    }
    const active = modelOverride ?? settings.activeModel ?? "(none)";
    return entries
      .map(([name, env]) =>
        `${name === active ? "*" : " "} ${name}  →  ${env.MODEL || "?"} @ ${env.BASE_URL || "default"}`)
      .join("\n");
  }

  if (!models[modelName]) {
    return `Model "${modelName}" not found. Available: ${Object.keys(models).join(", ") || "none"}`;
  }

  modelOverride = modelName;
  return `Switched to model "${modelName}" (${models[modelName].MODEL || "?"}).`;
}

function sendSystemMessage(content: string): void {
  mainWindow?.webContents.send(IPC.ASSISTANT_MESSAGE, {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role: "system",
    content,
  });
}

async function handleSlashCommand(text: string): Promise<boolean> {
  const trimmed = text.trim();
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].slice(1).toLowerCase(); // strip leading /

  switch (cmd) {
    case "model": {
      sendSystemMessage(handleModelCommand(trimmed));
      return true;
    }

    case "new": {
      sessionManager?.setActiveSessionId(null);
      mainWindow?.webContents.send(IPC.CLEAR_CHAT);
      return true;
    }

    case "exit": {
      app.quit();
      return true;
    }

    case "ida": {
      const result = await sessionManager?.reconnectIda() ?? "IDA not available.";
      sendSystemMessage(result);
      return true;
    }

    case "ce": {
      const result = await sessionManager?.reconnectCe() ?? "CE not available.";
      sendSystemMessage(result);
      return true;
    }

    case "cbm": {
      const result = await sessionManager?.reconnectCodebaseMemory() ?? "Codebase Memory not available.";
      sendSystemMessage(result);
      return true;
    }

    case "log": {
      const sessionId = sessionManager?.getActiveSessionId();
      if (!sessionId) {
        sendSystemMessage("No active session to log.");
        return true;
      }
      const logContent = sessionManager?.getSessionToolLog(sessionId) ?? "";
      const logPath = path.join(process.cwd(), "tool-log.md");
      fs.writeFileSync(logPath, logContent, "utf8");
      sendSystemMessage(`Tool log written to: ${logPath}`);
      return true;
    }

    case "skills": {
      const sessionId = sessionManager?.getActiveSessionId() ?? undefined;
      const skills = await sessionManager?.listSkills(sessionId) ?? [];
      if (skills.length === 0) {
        sendSystemMessage("No skills available.");
      } else {
        const lines = skills.map(s =>
          `  ${s.isLoaded ? "✓" : " "} /${s.commandName ?? s.name} — ${s.description || "(no description)"}`);
        sendSystemMessage(`Available skills:\n${lines.join("\n")}`);
      }
      return true;
    }

    case "resume": {
      const sessions = sessionManager?.listSessions() ?? [];
      if (sessions.length === 0) {
        sendSystemMessage("No previous sessions.");
        return true;
      }
      // /resume <number> resumes that session
      const arg = parts[1];
      if (arg && /^\d+$/.test(arg)) {
        const idx = parseInt(arg, 10) - 1;
        const entry = sessions[idx];
        if (!entry) {
          sendSystemMessage(`Invalid session number. Range: 1–${sessions.length}.`);
          return true;
        }
        sessionManager?.setActiveSessionId(entry.id);
        const msgs = sessionManager?.listSessionMessages(entry.id) ?? [];
        mainWindow?.webContents.send(IPC.CLEAR_CHAT);
        for (const msg of msgs.filter(m => m.visible)) {
          mainWindow?.webContents.send(IPC.ASSISTANT_MESSAGE, msg);
        }
        sendSystemMessage(`Resumed session: ${entry.summary ?? entry.id.slice(0, 8)}`);
        return true;
      }
      // Just list
      const lines = sessions.map((s, i) =>
        `  ${i + 1}. ${s.summary ?? "(no summary)"} [${s.status}]`);
      sendSystemMessage(`Sessions:\n${lines.join("\n")}\n\nType /resume <number> to resume.`);
      return true;
    }

    case "init": {
      // Falls through to LLM — let the model handle it
      return false;
    }

    default: {
      // Check if it matches a skill name
      const sessionId = sessionManager?.getActiveSessionId() ?? undefined;
      const skills = await sessionManager?.listSkills(sessionId) ?? [];
      const matched = skills.find(s => s.name.toLowerCase() === cmd);
      if (matched) {
        return false; // let the LLM handle skill invocation
      }
      // Unknown command
      sendSystemMessage(`Unknown command: /${cmd}\nAvailable: ${getBuiltinSlashCommandNames("electron")}`);
      return true;
    }
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "SimoByteDaemon",
    icon: path.join(__dirname, "..", "..", "assets", "icon.png"),
    backgroundColor: "#03080a",
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // ─── Debug: forward renderer errors to terminal ───
  mainWindow.webContents.on("console-message", (_e, _level, message, line, sourceId) => {
    console.log(`[renderer] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL) => {
    console.error(`[load-fail] ${errorCode}: ${errorDescription} — ${validatedURL}`);
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error(`[render-gone] ${details.reason}`);
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function initSessionManager(): void {
  const projectRoot = process.cwd();

  sessionManager = new SessionManager({
    projectRoot,
    createOpenAIClient: () => createOpenAIClient(modelOverride ?? undefined),
    getResolvedSettings: () => resolveCurrentSettings(modelOverride ?? undefined),
    renderMarkdown: (text) => text,
    onAssistantMessage: (message: SessionMessage) => {
      mainWindow?.webContents.send(IPC.ASSISTANT_MESSAGE, message);
    },
    onSessionEntryUpdated: (entry: SessionEntry) => {
      mainWindow?.webContents.send(IPC.SESSION_UPDATED, entry);
    },
    onLlmStreamProgress: (progress: LlmStreamProgress) => {
      if (progress.phase === "end") {
        mainWindow?.webContents.send(IPC.STREAM_PROGRESS, null);
        return;
      }
      mainWindow?.webContents.send(IPC.STREAM_PROGRESS, progress);
    },
    onToolCall: (toolName: string, params: string) => {
      mainWindow?.webContents.send(IPC.TOOL_CALL, { toolName, params });
    },
    onMcpHealth: (health) => {
      mainWindow?.webContents.send(IPC.MCP_HEALTH, health);
    },
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC.SEND_PROMPT, async (_, prompt: { text?: string; imageUrls?: string[] }) => {
    const text = prompt.text?.trim() ?? "";
    if (text.startsWith("/") && text.length > 1) {
      const handled = await handleSlashCommand(text);
      if (handled) return;
    }
    await sessionManager?.handleUserPrompt(prompt);
  });

  ipcMain.handle(IPC.INTERRUPT, () => {
    sessionManager?.interruptActiveSession();
  });

  ipcMain.handle(IPC.NEW_SESSION, () => {
    sessionManager?.setActiveSessionId(null);
  });

  ipcMain.handle(IPC.LIST_SESSIONS, () => {
    return sessionManager?.listSessions() ?? [];
  });

  ipcMain.handle(IPC.RESUME_SESSION, (_, sessionId: string) => {
    sessionManager?.setActiveSessionId(sessionId);
    return sessionManager?.listSessionMessages(sessionId) ?? [];
  });

  ipcMain.handle(IPC.GET_MESSAGES, (_, sessionId: string) => {
    return sessionManager?.listSessionMessages(sessionId) ?? [];
  });

  ipcMain.handle(IPC.GET_SKILLS, async (_, sessionId?: string) => {
    return sessionManager?.listSkills(sessionId) ?? [];
  });
}

app.whenReady().then(() => {
  initSessionManager();
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
