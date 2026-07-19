import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Static, Text, useApp, useStdout, useWindowSize } from "ink";
import chalk from "chalk";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import OpenAI from "openai";
import {
  SessionManager,
  getCompactPromptTokenThreshold,
  type LlmStreamProgress,
  type SessionEntry,
  type SessionMessage,
  type SessionStatus,
  type SkillInfo,
  type UserPromptContent
} from "../session";
import {
  resolveSettings,
  type DataCollection,
  type DeepcodingSettings,
  type ProviderPrivacyMode,
  type ReasoningEffort
} from "../settings";
import {
  createOpenAIClient,
  resolveCurrentSettings,
  readSettings,
  DEFAULT_MODEL,
  DEFAULT_BASE_URL
} from "../client-factory";
import { PromptInput, type PromptSubmission } from "./PromptInput";
import { MessageView, TOOL_SOURCE_BADGES } from "./MessageView";
import { SessionList } from "./SessionList";
import { buildLoadingText } from "./loadingText";
import { findExpandedThinkingId } from "./thinkingState";
import { WelcomeScreen } from "./WelcomeScreen";
import { AskUserQuestionPrompt } from "./AskUserQuestionPrompt";
import {
  findPendingAskUserQuestion,
  formatAskUserQuestionAnswers,
  type AskUserQuestionAnswers
} from "./askUserQuestion";
import { buildExitSummaryText } from "./exitSummary";



type View = "chat" | "session-list";

type AppProps = {
  projectRoot: string;
  version?: string;
  resumeSessionId?: string | null;
  onRestart?: () => void;
  onSessionManagerReady?: (manager: import("../session").SessionManager) => void;
};

function formatToolLine(toolName: string, rawParams: string, projectRoot: string): string {
  const badge = TOOL_SOURCE_BADGES[toolName] ?? { label: "", color: "#f97316" };
  const prefix = badge.label ? `${badge.label} › ` : "";
  let params = "";
  if (rawParams) {
    try {
      const parsed = JSON.parse(rawParams);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        params = Object.entries(parsed as Record<string, unknown>)
          .filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false)
          .map(([k, v]) => `${k}=${typeof v === "string" ? resolveDisplayPath(v, projectRoot) : JSON.stringify(v)}`)
          .join("  ");
      }
    } catch {
      params = rawParams;
    }
  }
  return `${prefix}${toolName}${params ? `  ${params}` : ""}`;
}

function resolveDisplayPath(value: string, projectRoot: string): string {
  if (!value.includes("/") && !value.includes("\\")) return value;
  if (path.isAbsolute(value)) return value;
  const absolute = path.resolve(projectRoot, value);
  const base = path.resolve(projectRoot, "..");
  return `${path.sep}${path.relative(base, absolute)}`;
}

export function App({ projectRoot, version = "", resumeSessionId = null, onRestart, onSessionManagerReady }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout, write } = useStdout();
  const { columns } = useWindowSize();
  const [view, setView] = useState<View>("chat");
  const [busy, setBusy] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [statusLine, setStatusLine] = useState<string>("");
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const [streamProgress, setStreamProgress] = useState<LlmStreamProgress | null>(null);
  const [runningProcesses, setRunningProcesses] = useState<SessionEntry["processes"]>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<SessionStatus | null>(null);
  const [dismissedQuestionIds, setDismissedQuestionIds] = useState<Set<string>>(() => new Set());
  const [isExiting, setIsExiting] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [welcomeNonce, setWelcomeNonce] = useState(0);
  const [nowTick, setNowTick] = useState(0);
  const [balance, setBalance] = useState<string>("");
  const [mcpHealth, setMcpHealth] = useState<string>("");
  const [modelOverride, setModelOverride] = useState<string | null>(null);

  const messagesRef = useRef<SessionMessage[]>([]);
  messagesRef.current = messages;
  const modelOverrideRef = useRef(modelOverride);
  modelOverrideRef.current = modelOverride;

  const sessionManager = useMemo(() => {
    return new SessionManager({
      projectRoot,
      createOpenAIClient: () => createOpenAIClient(modelOverrideRef.current ?? undefined),
      getResolvedSettings: () => resolveCurrentSettings(modelOverrideRef.current ?? undefined),
      renderMarkdown: (text) => text,
      onAssistantMessage: (message: SessionMessage) => {
        setMessages((prev) => [...prev, message]);
      },
      onSessionEntryUpdated: (entry) => {
        setStatusLine(buildStatusLine(entry, resolveCurrentSettings(modelOverrideRef.current ?? undefined).model, resolveCurrentSettings(modelOverrideRef.current ?? undefined).contextWindow));
        setRunningProcesses(entry.processes);
        setActiveStatus(entry.status);
      },
      onMcpHealth: (health) => {
        setMcpHealth(buildMcpHealthLine(health));
      },
      onLlmStreamProgress: (progress) => {
        if (progress.phase === "end") {
          setStreamProgress(null);
          return;
        }
        setStreamProgress(progress);
      },
      onToolCall: (toolName: string, params: string) => {
        setActiveTool(formatToolLine(toolName, params, projectRoot));
      }
    });
  }, [projectRoot]);

  // Notify CLI of the session manager instance
  useEffect(() => {
    onSessionManagerReady?.(sessionManager);
  }, []);

  // If --resume was provided, load that session instead of creating a new one
  useEffect(() => {
    if (!resumeSessionId) return;
    const session = sessionManager.getSession(resumeSessionId);
    if (!session) {
      setErrorLine(`Session not found: ${resumeSessionId}. Create a new session instead.`);
      return;
    }
    sessionManager.setActiveSessionId(resumeSessionId);
    setShowWelcome(false);
    setMessages(sessionManager.listSessionMessages(resumeSessionId).filter(m => m.visible));
  }, [resumeSessionId]);

  useEffect(() => {
    if (!busy) {
      return;
    }
    const id = setInterval(() => setNowTick((tick) => tick + 1), 500);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    refreshSessionsList();
    void refreshSkills();
    void refreshBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadVisibleMessages(manager: SessionManager, sessionId: string): SessionMessage[] {
    return manager.listSessionMessages(sessionId).filter((m) => m.visible);
  }

  function refreshSessionsList(): void {
    setSessions(sessionManager.listSessions());
  }

  async function refreshSkills(sessionId?: string): Promise<void> {
    try {
      const list = await sessionManager.listSkills(sessionId ?? sessionManager.getActiveSessionId() ?? undefined);
      setSkills(list);
    } catch {
      // ignore
    }
  }

  async function refreshBalance(): Promise<void> {
    const settings = resolveCurrentSettings(modelOverrideRef.current ?? undefined);
    if (!settings.apiKey || !isDeepSeekBaseURL(settings.baseURL)) {
      return;
    }
    try {
      const url = new URL("/user/balance", settings.baseURL).toString();
      const res = await fetch(url, { headers: { Authorization: `Bearer ${settings.apiKey}` } });
      if (!res.ok) return;
      const data = await res.json() as { balance_infos?: Array<{ currency: string; total_balance: string }> };
      const infos = data.balance_infos ?? [];
      const info =
        infos.find((i) => i.currency === "USD") ??
        infos.find((i) => i.currency === "EUR") ??
        infos[0];
      if (info) {
        setBalance(`${info.total_balance} ${info.currency}`);
      }
    } catch {
      // ignore — balance is optional display
    }
  }

  const writeRef = useRef(write);
  writeRef.current = write;
  function handleModelCommand(fullText: string): void {
    const parts = fullText.split(/\s+/);
    const modelName = parts.slice(1).join(" ").trim();
    const settings = readSettings() ?? {};
    const models = settings.models ?? {};

    if (!modelName) {
      // List available models
      const entries = Object.entries(models);
      if (entries.length === 0) {
        setStatusLine("No saved models. Add them in ~/.sbdt/settings.json under 'models'.");
        return;
      }
      const active = modelOverride ?? settings.activeModel ?? "(none)";
      const lines = entries.map(([name, env]) =>
        `${name === active ? "*" : " "} ${name}  →  ${env.MODEL || "?"} @ ${env.BASE_URL || "default"}`
      );
      setStatusLine(`Models: ${lines.join(" | ")}`);
      return;
    }

    if (!models[modelName]) {
      setStatusLine(`Model "${modelName}" not found. Available: ${Object.keys(models).join(", ") || "none"}`);
      return;
    }

    // Switch to the selected model (per-terminal, not global)
    setModelOverride(modelName);
    setStatusLine(`Switched to model "${modelName}" (${models[modelName].MODEL || "?"}).`);
  }

  const handlePrompt = useCallback(
    async (submission: PromptSubmission) => {
      if (submission.command === "exit") {
        setIsExiting(true);
        setTimeout(() => {
          const activeSessionId = sessionManager.getActiveSessionId();
          const session = activeSessionId ? sessionManager.getSession(activeSessionId) : null;
          const allMessages = activeSessionId
            ? sessionManager.listSessionMessages(activeSessionId)
            : messagesRef.current;
          const resolved = resolveCurrentSettings(modelOverrideRef.current ?? undefined);
          const summary = buildExitSummaryText({ session, messages: allMessages, model: resolved.model });
          process.stdout.write("\n");
          process.stdout.write(chalk.green("> /exit "));
          process.stdout.write("\n\n");
          process.stdout.write(summary);
          process.stdout.write("\n\n");
          exit();
        }, 0);
        return;
      }
      if (submission.command === "new") {
        if (onRestart) {
          onRestart();
        } else {
          writeRef.current("\u001B[2J\u001B[3J\u001B[H");
          sessionManager.setActiveSessionId(null);
          setMessages([]);
          setStatusLine("");
          setErrorLine(null);
          setRunningProcesses(null);
          setActiveStatus(null);
          setDismissedQuestionIds(new Set());
          setShowWelcome(true);
          setWelcomeNonce((n) => n + 1);
          await refreshSkills();
          refreshSessionsList();
        }
        return;
      }
      if (submission.command === "ida") {
        sessionManager.reconnectIda().then((status) => {
          setStatusLine(status);
          refreshSessionsList();
        });
        return;
      }
      if (submission.command === "ce") {
        sessionManager.reconnectCe().then((status) => {
          setStatusLine(status);
          refreshSessionsList();
        });
        return;
      }
      if (submission.command === "cbm") {
        sessionManager.reconnectCodebaseMemory().then((status) => {
          setStatusLine(status);
          refreshSessionsList();
        });
        return;
      }

      if (submission.command === "log") {
        const activeSessionId = sessionManager.getActiveSessionId();
        if (!activeSessionId) {
          setErrorLine("No active session to log.");
          return;
        }
        const logContent = sessionManager.getSessionToolLog(activeSessionId);
        // Write to a file in the project directory
        const logPath = path.join(projectRoot, "tool-log.md");
        fs.writeFileSync(logPath, logContent, "utf8");
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "system" as const,
            sessionId: activeSessionId,
            content: `Tool log written to: ${logPath}`,
            contentParams: null,
            messageParams: null,
            compacted: false,
            visible: true,
            createTime: new Date().toISOString(),
            updateTime: new Date().toISOString()
          }
        ]);
        return;
      }

      if (submission.text?.trim().startsWith("/model")) {
        handleModelCommand(submission.text.trim());
        return;
      }

      if (submission.command === "resume") {
        setShowWelcome(false);
        refreshSessionsList();
        setView("session-list");
        return;
      }

      const prompt: UserPromptContent = {
        text: submission.text,
        imageUrls: submission.imageUrls,
        skills: submission.selectedSkills && submission.selectedSkills.length > 0
          ? submission.selectedSkills
          : undefined
      };

      const trimmedText = (submission.text ?? "").trim();
      const selectedSkillNames = submission.selectedSkills?.map((skill) => skill.name).filter(Boolean) ?? [];
      const userDisplayContent = trimmedText
        || (selectedSkillNames.length > 0 ? `Use skills: ${selectedSkillNames.join(", ")}` : "")
        || (submission.imageUrls.length > 0 ? "[Image]" : "");

      if (userDisplayContent) {
        setMessages((prev) => [
          ...prev,
          buildSyntheticUserMessage(userDisplayContent, submission.imageUrls.length)
        ]);
      }

      setBusy(true);
      setErrorLine(null);
      setRunningProcesses(null);
      try {
        await sessionManager.handleUserPrompt(prompt);
        await refreshSkills();
        refreshSessionsList();
        void refreshBalance();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setErrorLine(message);
      } finally {
        setBusy(false);
        setStreamProgress(null);
        setRunningProcesses(null);
        setActiveTool(null);
      }
    },
    [exit, onRestart, sessionManager]
  );

  const handleInterrupt = useCallback(() => {
    sessionManager.interruptActiveSession();
  }, [sessionManager]);

  const handleSubmit = useCallback(
    (submission: PromptSubmission) => { void handlePrompt(submission); },
    [handlePrompt]
  );

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      const currentSessionId = sessionManager.getActiveSessionId();
      if (currentSessionId !== sessionId) {
        process.stdout.write("\u001B[2J\u001B[3J\u001B[H");
      }
      sessionManager.setActiveSessionId(sessionId);
      // 先清空让 <Static> 的 index 重置为 0
      setMessages([]);
      setShowWelcome(false);
      setWelcomeNonce((n) => n + 1);
      setView("chat");
      // 再加载新消息，此时 index 已为 0，会渲染全部 items
      setTimeout(() => {
        setMessages(loadVisibleMessages(sessionManager, sessionId));
        setShowWelcome(true);
      }, 0);
      const session = sessionManager.getSession(sessionId);
      setStatusLine(session ? buildStatusLine(session, resolveCurrentSettings(modelOverrideRef.current ?? undefined).model, resolveCurrentSettings(modelOverrideRef.current ?? undefined).contextWindow) : "");
      setRunningProcesses(session?.processes ?? null);
      setActiveStatus(session?.status ?? null);
      await refreshSkills(sessionId);
    },
    [sessionManager]
  );

  const [stableColumns, setStableColumns] = useState(columns);
  useEffect(() => {
    const timer = setTimeout(() => setStableColumns(columns), 100);
    return () => clearTimeout(timer);
  }, [columns]);
  const screenWidth = useMemo(() => stableColumns ?? stdout?.columns ?? 80, [stableColumns, stdout]);
  const promptHistory = useMemo(() => {
    return messages
      .filter((message) => message.role === "user" && typeof message.content === "string")
      .map((message) => (message.content ?? "").trim())
      .filter((content) => content.length > 0);
  }, [messages]);
  const expandedThinkingId = findExpandedThinkingId(messages);
  const pendingQuestion = useMemo(
    () => findPendingAskUserQuestion(messages, activeStatus),
    [activeStatus, messages]
  );
  const shouldShowQuestionPrompt = Boolean(
    pendingQuestion && !dismissedQuestionIds.has(pendingQuestion.messageId)
  );
  const loadingText = useMemo(
    () => busy
      ? buildLoadingText({ progress: streamProgress, processes: runningProcesses, activeTool, now: Date.now() })
      : null,
    [busy, streamProgress, runningProcesses, activeTool, nowTick]
  );
  const welcomeSettings = useMemo(() => resolveCurrentSettings(modelOverrideRef.current ?? undefined), []);
  const welcomeItem: SessionMessage = useMemo(() => ({
    id: `__welcome__${welcomeNonce}`,
    sessionId: "",
    role: "system",
    content: "",
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: "",
    updateTime: ""
  }), [welcomeNonce]);
  const staticItems = useMemo(() => {
    if (showWelcome && view === "chat") {
      return [welcomeItem, ...messages];
    }
    return messages;
  }, [showWelcome, view, messages, welcomeItem]);

  const handleQuestionAnswers = useCallback(
    (answers: AskUserQuestionAnswers) => {
      void handlePrompt({
        text: formatAskUserQuestionAnswers(answers),
        imageUrls: []
      });
    },
    [handlePrompt]
  );

  const handleQuestionCancel = useCallback(() => {
    if (!pendingQuestion) {
      return;
    }
    setDismissedQuestionIds((prev) => new Set(prev).add(pendingQuestion.messageId));
  }, [pendingQuestion]);

  return (
    <Box flexDirection="column" width={screenWidth} minWidth={80} overflowX={'visible'}>
      <Static items={staticItems}>
        {(item) => {
          if (item.id.startsWith("__welcome__")) {
            return (
              <WelcomeScreen
                key={item.id}
                projectRoot={projectRoot}
                settings={welcomeSettings}
                skills={skills}
                version={version}
                width={screenWidth}
              />
            );
          }
          return (
            <MessageView
              key={item.id}
              message={item}
              collapsed={isCollapsedThinking(item, expandedThinkingId)}
              busy={busy}
            />
          );
        }}
      </Static>
      {(mcpHealth) ? (
        <Box>
          <Text dimColor>{mcpHealth}</Text>
        </Box>
      ) : null}
      {(statusLine || balance) ? (
        <Box>
          <Text dimColor>{[statusLine, balance ? `balance: ${balance}` : ""].filter(Boolean).join(" - ")}</Text>
        </Box>
      ) : null}
      {errorLine ? (
        <Box>
          <Text color="red">Error: {errorLine}</Text>
        </Box>
      ) : null}
      {view === "session-list" ? (
        <SessionList
          sessions={sessions}
          onSelect={(id) => void handleSelectSession(id)}
          onCancel={() => setView("chat")}
        />
      ) : shouldShowQuestionPrompt && pendingQuestion && !busy ? (
        <AskUserQuestionPrompt
          questions={pendingQuestion.questions}
          onSubmit={handleQuestionAnswers}
          onCancel={handleQuestionCancel}
        />
      ) : isExiting ? null : (
        <PromptInput
          screenWidth={screenWidth}
          skills={skills}
          promptHistory={promptHistory}
          busy={busy}
          loadingText={loadingText}
          onSubmit={handleSubmit}
          onInterrupt={handleInterrupt}
          placeholder='Type your message...'
        />
      )}
    </Box>
  );
}

function isCollapsedThinking(message: SessionMessage, expandedId: string | null): boolean {
  if (message.role !== "assistant") {
    return false;
  }
  if (!message.meta?.asThinking) {
    return false;
  }
  return message.id !== expandedId;
}

function buildSyntheticUserMessage(content: string, imageCount: number): SessionMessage {
  const now = new Date().toISOString();
  return {
    id: `local-${Math.random().toString(36).slice(2)}`,
    sessionId: "local",
    role: "user",
    content,
    contentParams:
      imageCount > 0
        ? Array.from({ length: imageCount }, () => ({
            type: "image_url",
            image_url: { url: "" }
          }))
        : null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: now,
    updateTime: now
  };
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatContextPreview(promptTokens: number, contextLimit: number): string {
  const pct = Math.round((promptTokens / contextLimit) * 100);
  return `context: ${fmtTokens(promptTokens)}/${fmtTokens(contextLimit)} (${pct}%)`;
}

function buildStatusLine(entry: SessionEntry, model?: string, contextWindow?: number): string {
  const parts: string[] = [];
  parts.push(`status: ${entry.status}`);

  const u = entry.lastResponseUsage as Record<string, unknown> | null | undefined;
  if (u && typeof u === "object") {
    const prompt = typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0;
    const completion = typeof u.completion_tokens === "number" ? u.completion_tokens : 0;
    const cacheHit = typeof u.prompt_cache_hit_tokens === "number" ? u.prompt_cache_hit_tokens : 0;
    if (prompt > 0 || completion > 0) {
      let tok = `in: ${fmtTokens(prompt)} - out: ${fmtTokens(completion)}`;
      if (cacheHit > 0) tok += ` - cache: ${fmtTokens(cacheHit)}`;
      parts.push(tok);
    }
    if (prompt > 0 && model) {
      const limit = contextWindow ?? getCompactPromptTokenThreshold(model);
      parts.push(formatContextPreview(prompt, limit));
    }
  } else if (typeof entry.activeTokens === "number" && entry.activeTokens > 0) {
    parts.push(`tokens: ${entry.activeTokens}`);
  }

  if (entry.failReason) {
    parts.push(`fail: ${entry.failReason}`);
  }
  return parts.join(" - ");
}

function buildMcpHealthLine(health: { fs: { ready: boolean; error?: string }; serena: { ready: boolean; error?: string } }): string {
  const items: string[] = [];
  const fmt = (label: string, h: { ready: boolean; error?: string }) => {
    if (h.ready) return label + " \u2713";
    return label + " \u2717";
  };
  items.push(fmt("fs", health.fs));
  items.push(fmt("serena", health.serena));
  return "mcp: " + items.join(" | ");
}

function isDeepSeekBaseURL(baseURL: string | undefined): boolean {
  if (!baseURL) return false;
  try {
    return new URL(baseURL).hostname.toLowerCase().includes("deepseek.com");
  } catch {
    return baseURL.toLowerCase().includes("deepseek.com");
  }
}

// Client factory functions extracted to ../client-factory.ts
