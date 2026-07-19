/**
 * Shared IPC channel name constants.
 * Used by both main process and preload script.
 */
export const IPC = {
  // Renderer → Main (invoke)
  SEND_PROMPT: "sbdt:send-prompt",
  INTERRUPT: "sbdt:interrupt",
  NEW_SESSION: "sbdt:new-session",
  LIST_SESSIONS: "sbdt:list-sessions",
  RESUME_SESSION: "sbdt:resume-session",
  GET_MESSAGES: "sbdt:get-messages",
  GET_SKILLS: "sbdt:get-skills",

  // Main → Renderer (push events)
  ASSISTANT_MESSAGE: "sbdt:assistant-message",
  SESSION_UPDATED: "sbdt:session-updated",
  STREAM_PROGRESS: "sbdt:stream-progress",
  TOOL_CALL: "sbdt:tool-call",
  MCP_HEALTH: "sbdt:mcp-health",
  CLEAR_CHAT: "sbdt:clear-chat",
} as const;
