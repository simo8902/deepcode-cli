import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "./ipc-channels";

/**
 * The bridge exposed to the renderer process via window.api.
 * All communication with the main process goes through here.
 */
contextBridge.exposeInMainWorld("api", {
  // Renderer → Main
  sendPrompt: (prompt: { text?: string; imageUrls?: string[] }) =>
    ipcRenderer.invoke(IPC.SEND_PROMPT, prompt),
  interrupt: () => ipcRenderer.invoke(IPC.INTERRUPT),
  newSession: () => ipcRenderer.invoke(IPC.NEW_SESSION),
  listSessions: () => ipcRenderer.invoke(IPC.LIST_SESSIONS),
  resumeSession: (sessionId: string) => ipcRenderer.invoke(IPC.RESUME_SESSION, sessionId),
  getMessages: (sessionId: string) => ipcRenderer.invoke(IPC.GET_MESSAGES, sessionId),
  getSkills: (sessionId?: string) => ipcRenderer.invoke(IPC.GET_SKILLS, sessionId),

  // Main → Renderer event listeners
  onAssistantMessage: (cb: (message: unknown) => void) =>
    ipcRenderer.on(IPC.ASSISTANT_MESSAGE, (_, msg) => cb(msg)),
  onSessionUpdated: (cb: (entry: unknown) => void) =>
    ipcRenderer.on(IPC.SESSION_UPDATED, (_, entry) => cb(entry)),
  onStreamProgress: (cb: (progress: unknown) => void) =>
    ipcRenderer.on(IPC.STREAM_PROGRESS, (_, progress) => cb(progress)),
  onToolCall: (cb: (info: { toolName: string; params: string }) => void) =>
    ipcRenderer.on(IPC.TOOL_CALL, (_, info) => cb(info)),
  onMcpHealth: (cb: (health: unknown) => void) =>
    ipcRenderer.on(IPC.MCP_HEALTH, (_, health) => cb(health)),
  onClearChat: (cb: () => void) =>
    ipcRenderer.on(IPC.CLEAR_CHAT, () => cb()),
});
