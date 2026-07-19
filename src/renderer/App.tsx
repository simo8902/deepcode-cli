import React, { useState, useCallback, useEffect, useRef } from "react";

type Message = {
  id: string;
  role: string;
  content: string;
  meta?: { asThinking?: boolean };
};

type ToolCallInfo = { toolName: string; params: string };

function isTerminalSessionStatus(status: unknown): boolean {
  return status === "failed"
    || status === "waiting_for_user"
    || status === "completed"
    || status === "interrupted";
}

type SlashCommand = { label: string; description: string };

const SLASH_COMMANDS: SlashCommand[] = [
  { label: "/model", description: "List or switch saved model profiles" },
  { label: "/new", description: "Start a fresh conversation" },
  { label: "/resume", description: "List or resume previous sessions" },
  { label: "/skills", description: "List available skills" },
  { label: "/log", description: "Export session tool log to file" },
  { label: "/ida", description: "Reconnect to IDA Pro MCP server" },
  { label: "/ce", description: "Reconnect to Cheat Engine MCP server" },
  { label: "/init", description: "Initialize an AGENTS.md file" },
  { label: "/exit", description: "Quit the app" },
];

// Window API type (provided by preload)
declare global {
  interface Window {
    api: {
      sendPrompt: (prompt: { text?: string; imageUrls?: string[] }) => Promise<void>;
      interrupt: () => Promise<void>;
      newSession: () => Promise<void>;
      listSessions: () => Promise<unknown[]>;
      resumeSession: (sessionId: string) => Promise<Message[]>;
      getMessages: (sessionId: string) => Promise<Message[]>;
      getSkills: (sessionId?: string) => Promise<unknown[]>;
      onAssistantMessage: (cb: (message: Message) => void) => void;
      onSessionUpdated: (cb: (entry: unknown) => void) => void;
      onStreamProgress: (cb: (progress: unknown) => void) => void;
      onToolCall: (cb: (info: ToolCallInfo) => void) => void;
      onMcpHealth: (cb: (health: unknown) => void) => void;
      onClearChat: (cb: () => void) => void;
    };
  }
}

export function AlienApp() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [menuIndex, setMenuIndex] = useState(0);

  // IPC event listeners
  useEffect(() => {
    window.api.onAssistantMessage((msg) => {
      setMessages((prev) => [...prev, msg]);
    });
    window.api.onSessionUpdated((entry) => {
      if (entry && typeof entry === "object" && "status" in entry) {
        setBusy(!isTerminalSessionStatus(entry.status));
      }
    });
    window.api.onStreamProgress((progress) => {
      if (progress && typeof progress === "object" && "phase" in progress && progress.phase === "start") {
        setActiveTool(null);
      }
      setBusy(progress !== null);
    });
    window.api.onToolCall((info) => {
      const params = info.params ? formatParams(info.params) : "";
      setBusy(true);
      setActiveTool(`${info.toolName}${params ? "  " + params : ""}`);
    });
    window.api.onClearChat(() => {
      setMessages([]);
      setInput("");
      setBusy(false);
      setActiveTool(null);
    });
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // Global keyboard: any key focuses input, "/" clears it
  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      if (busy) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (e.key === "/") {
        e.preventDefault();
        setInput("");
        inputRef.current?.focus();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onGlobalKey);
    return () => window.removeEventListener("keydown", onGlobalKey);
  }, [busy]);

  const slashToken = input.startsWith("/") ? input.split(/\s+/)[0] : null;
  const slashMenu = slashToken
    ? SLASH_COMMANDS.filter(c =>
        c.label.startsWith(slashToken) || c.label.slice(1).startsWith(slashToken.slice(1)))
    : [];
  const showMenu = slashMenu.length > 0 && !busy;

  const handleSubmit = useCallback((overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || busy) return;
    setInput("");
    const isCommand = text.startsWith("/");
    if (!isCommand) {
      setBusy(true);
      setActiveTool(null);
    }
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: text },
    ]);
    void window.api.sendPrompt({ text });
  }, [input, busy]);

  const handleInterrupt = useCallback(() => {
    void window.api.interrupt();
    setBusy(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showMenu) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMenuIndex(i => (i + 1) % slashMenu.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMenuIndex(i => (i - 1 + slashMenu.length) % slashMenu.length);
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const selected = slashMenu[menuIndex];
          if (selected) {
            handleSubmit(selected.label);
            return;
          }
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setInput("");
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          const selected = slashMenu[menuIndex];
          if (selected) {
            setInput(selected.label + " ");
          }
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, showMenu, slashMenu, menuIndex]
  );

  return (
    <div className="alien-app">
      {/* Scanline overlay */}
      <div className="scanlines" />
      <div className="vignette" />

      {/* Header */}
      <header className="alien-header">
        <div className="logo">
          <span className="logo-text">SimoByteDaemon</span>
        </div>
      </header>

      {/* Messages */}
      <main className="alien-messages">
        {messages.length === 0 && (
          <div className="alien-welcome">
            <svg className="welcome-logo" viewBox="0 0 160 160" fill="none">
              <path d="M4 4 L56 3 L60 7 L64 5 L62 19 L66 31 L62 43 L66 55 L58 63 L48 59 L38 65 L28 59 L18 65 L8 59 L4 47 L8 35 L3 23 L8 11 Z" fill="rgba(0,50,25,0.14)" stroke="rgba(0,255,136,0.3)" strokeWidth="1"/>
              <path d="M8 8 L54 7 L56 11 L58 19 L62 29 L58 41 L62 51 L56 57 L48 55 L38 59 L28 55 L18 59 L10 55 L7 45 L11 33 L7 21 L11 13 Z" fill="none" stroke="rgba(0,255,136,0.04)" strokeWidth="0.3"/>
              <rect x="18" y="10" width="28" height="28" rx="1" fill="rgba(0,12,6,0.5)" stroke="rgba(0,255,136,0.35)" strokeWidth="0.7"/>
              <rect x="23" y="15" width="18" height="18" fill="none" stroke="rgba(0,255,136,0.06)" strokeWidth="0.3"/>
              <rect x="26" y="18" width="12" height="12" fill="none" stroke="rgba(0,255,136,0.04)" strokeWidth="0.2"/>
              <circle cx="26" cy="18" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="29" cy="18" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="32" cy="18" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="35" cy="18" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="38" cy="18" r="0.3" fill="rgba(0,255,136,0.15)"/>
              <circle cx="26" cy="21" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="29" cy="21" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="32" cy="21" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="35" cy="21" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="38" cy="21" r="0.3" fill="rgba(0,255,136,0.15)"/>
              <circle cx="26" cy="24" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="29" cy="24" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="32" cy="24" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="35" cy="24" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="38" cy="24" r="0.3" fill="rgba(0,255,136,0.15)"/>
              <circle cx="26" cy="27" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="29" cy="27" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="32" cy="27" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="35" cy="27" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="38" cy="27" r="0.3" fill="rgba(0,255,136,0.15)"/>
              <circle cx="26" cy="30" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="29" cy="30" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="32" cy="30" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="35" cy="30" r="0.3" fill="rgba(0,255,136,0.15)"/><circle cx="38" cy="30" r="0.3" fill="rgba(0,255,136,0.15)"/>
              <path d="M20 12 L22 12 L21 14 Z" fill="rgba(0,255,136,0.3)"/>
              <rect x="46" y="14" width="6" height="5" rx="0.5" fill="none" stroke="rgba(0,255,136,0.2)" strokeWidth="0.4"/>
              <line x1="46" y1="17" x2="52" y2="17" stroke="rgba(0,255,136,0.15)" strokeWidth="0.3"/>
              <text x="19" y="44" fill="rgba(0,255,136,0.1)" fontSize="2.5" fontFamily="monospace">LGA1200</text>
              <rect x="10" y="5" width="3" height="2.5" fill="rgba(0,12,6,0.5)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <rect x="14" y="5" width="3" height="2.5" fill="rgba(0,12,6,0.5)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <rect x="18" y="5" width="3" height="2.5" fill="rgba(0,12,6,0.5)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <rect x="22" y="5" width="3" height="2.5" fill="rgba(0,12,6,0.5)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <rect x="26" y="5" width="3" height="2.5" fill="rgba(0,12,6,0.5)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <rect x="30" y="5" width="3" height="2.5" fill="rgba(0,12,6,0.5)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <text x="10" y="4" fill="rgba(0,255,136,0.08)" fontSize="1.8" fontFamily="monospace">Q1 Q2 Q3 Q4 Q5 Q6</text>
              <rect x="8" y="44" width="6" height="6" rx="0.5" fill="rgba(0,12,6,0.35)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.4"/>
              <circle cx="11" cy="47" r="2" fill="none" stroke="rgba(0,255,136,0.1)" strokeWidth="0.3"/>
              <text x="7" y="53" fill="rgba(0,255,136,0.08)" fontSize="1.8" fontFamily="monospace">L1</text>
              <rect x="48" y="44" width="6" height="6" rx="0.5" fill="rgba(0,12,6,0.35)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.4"/>
              <circle cx="51" cy="47" r="2" fill="none" stroke="rgba(0,255,136,0.1)" strokeWidth="0.3"/>
              <text x="47" y="53" fill="rgba(0,255,136,0.08)" fontSize="1.8" fontFamily="monospace">L2</text>
              <circle cx="8" cy="54" r="2.5" fill="rgba(0,12,6,0.35)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.4"/>
              <circle cx="8" cy="54" r="1.5" fill="none" stroke="rgba(0,255,136,0.1)" strokeWidth="0.2"/>
              <path d="M6.5 52.5 L9.5 55.5 M9.5 52.5 L6.5 55.5" stroke="rgba(0,255,136,0.08)" strokeWidth="0.2"/>
              <text x="3" y="60" fill="rgba(0,255,136,0.08)" fontSize="1.8" fontFamily="monospace">CE1</text>
              <circle cx="52" cy="54" r="2.5" fill="rgba(0,12,6,0.35)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.4"/>
              <circle cx="52" cy="54" r="1.5" fill="none" stroke="rgba(0,255,136,0.1)" strokeWidth="0.2"/>
              <path d="M50.5 52.5 L53.5 55.5 M53.5 52.5 L50.5 55.5" stroke="rgba(0,255,136,0.08)" strokeWidth="0.2"/>
              <text x="47" y="60" fill="rgba(0,255,136,0.08)" fontSize="1.8" fontFamily="monospace">CE2</text>
              <circle cx="6" cy="6" r="2.2" fill="#03080a" stroke="rgba(0,255,136,0.4)" strokeWidth="0.5"/>
              <circle cx="6" cy="6" r="0.6" fill="rgba(0,255,136,0.15)"/>
              <circle cx="6" cy="6" r="3.2" fill="none" stroke="rgba(0,255,136,0.12)" strokeWidth="0.3"/>
              <path d="M12 8 L12 10 L16 10 L16 12 L18 12" stroke="rgba(0,255,136,0.18)" strokeWidth="0.5" fill="none"/>
              <path d="M16 8 L16 10 L20 10 L20 12" stroke="rgba(0,255,136,0.18)" strokeWidth="0.5" fill="none"/>
              <path d="M20 8 L20 10 L24 10" stroke="rgba(0,255,136,0.18)" strokeWidth="0.5" fill="none"/>
              <path d="M24 8 L24 10 L28 10" stroke="rgba(0,255,136,0.18)" strokeWidth="0.5" fill="none"/>
              <path d="M28 8 L28 10 L32 10" stroke="rgba(0,255,136,0.18)" strokeWidth="0.5" fill="none"/>
              <path d="M46 40 L44 44" stroke="rgba(0,255,136,0.15)" strokeWidth="0.4" fill="none"/>
              <path d="M18 44 L20 48 L14 54" stroke="rgba(0,255,136,0.12)" strokeWidth="0.4" fill="none"/>
              <circle cx="16" cy="48" r="0.5" fill="rgba(0,255,136,0.2)"/>
              <circle cx="44" cy="42" r="0.5" fill="rgba(0,255,136,0.2)"/>
              <circle cx="20" cy="48" r="0.5" fill="rgba(0,255,136,0.2)"/>
              <circle cx="42" cy="48" r="0.5" fill="rgba(0,255,136,0.2)"/>
              <path d="M74 4 L156 3 L154 17 L156 29 L152 41 L156 51 L150 53 L140 49 L130 53 L120 49 L110 53 L100 49 L90 53 L80 49 L74 51 Z" fill="rgba(0,50,25,0.14)" stroke="rgba(0,255,136,0.3)" strokeWidth="1"/>
              <path d="M78 8 L152 7 L150 15 L152 27 L148 37 L152 47 L148 49 L138 47 L128 49 L118 47 L108 49 L98 47 L88 49 L78 47 Z" fill="none" stroke="rgba(0,255,136,0.04)" strokeWidth="0.3"/>
              <rect x="80" y="10" width="70" height="5" rx="0.5" fill="rgba(0,20,10,0.2)" stroke="rgba(0,255,136,0.25)" strokeWidth="0.4"/>
              <rect x="112" y="10" width="3" height="5" fill="rgba(0,255,136,0.04)" stroke="rgba(0,255,136,0.15)" strokeWidth="0.3"/>
              <rect x="80" y="10" width="3" height="5" fill="rgba(0,20,10,0.3)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <rect x="147" y="10" width="3" height="5" fill="rgba(0,20,10,0.3)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <rect x="80" y="17" width="70" height="5" rx="0.5" fill="rgba(0,20,10,0.2)" stroke="rgba(0,255,136,0.25)" strokeWidth="0.4"/>
              <rect x="112" y="17" width="3" height="5" fill="rgba(0,255,136,0.04)" stroke="rgba(0,255,136,0.15)" strokeWidth="0.3"/>
              <rect x="80" y="17" width="3" height="5" fill="rgba(0,20,10,0.3)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <rect x="147" y="17" width="3" height="5" fill="rgba(0,20,10,0.3)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <text x="84" y="9" fill="rgba(0,255,136,0.1)" fontSize="2.2" fontFamily="monospace">DIMM_A1</text>
              <text x="84" y="16" fill="rgba(0,255,136,0.1)" fontSize="2.2" fontFamily="monospace">DIMM_B1</text>
              <rect x="84" y="28" width="16" height="16" rx="0.5" fill="rgba(0,12,6,0.4)" stroke="rgba(0,255,136,0.3)" strokeWidth="0.6"/>
              <rect x="87" y="31" width="10" height="10" fill="none" stroke="rgba(0,255,136,0.08)" strokeWidth="0.3"/>
              <circle cx="92" cy="36" r="4" fill="none" stroke="rgba(0,255,136,0.06)" strokeWidth="0.3"/>
              <circle cx="86" cy="30" r="0.5" fill="rgba(0,255,136,0.3)"/>
              <text x="84" y="48" fill="rgba(0,255,136,0.1)" fontSize="2.2" fontFamily="monospace">PCH Z490</text>
              <rect x="110" y="30" width="4" height="3" fill="rgba(0,12,6,0.5)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <rect x="115" y="30" width="4" height="3" fill="rgba(0,12,6,0.5)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <rect x="120" y="30" width="4" height="3" fill="rgba(0,12,6,0.5)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <rect x="110" y="35" width="4" height="3" fill="rgba(0,12,6,0.5)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <rect x="115" y="35" width="4" height="3" fill="rgba(0,12,6,0.5)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <rect x="120" y="35" width="4" height="3" fill="rgba(0,12,6,0.5)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <text x="110" y="41" fill="rgba(0,255,136,0.08)" fontSize="1.8" fontFamily="monospace">Q7-Q12</text>
              <circle cx="132" cy="34" r="2" fill="rgba(0,12,6,0.35)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.4"/>
              <circle cx="132" cy="34" r="1.2" fill="none" stroke="rgba(0,255,136,0.1)" strokeWidth="0.2"/>
              <circle cx="140" cy="34" r="2" fill="rgba(0,12,6,0.35)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.4"/>
              <circle cx="140" cy="34" r="1.2" fill="none" stroke="rgba(0,255,136,0.1)" strokeWidth="0.2"/>
              <text x="131" y="40" fill="rgba(0,255,136,0.08)" fontSize="1.8" fontFamily="monospace">CE3 CE4</text>
              <path d="M100 28 L104 28 L108 30" stroke="rgba(0,255,136,0.15)" strokeWidth="0.5" fill="none"/>
              <path d="M100 36 L106 36 L110 34" stroke="rgba(0,255,136,0.12)" strokeWidth="0.5" fill="none"/>
              <path d="M124 32 L128 32 L132 30" stroke="rgba(0,255,136,0.12)" strokeWidth="0.5" fill="none"/>
              <path d="M80 15 L78 15 L76 20" stroke="rgba(0,255,136,0.12)" strokeWidth="0.4" fill="none"/>
              <path d="M80 22 L78 22 L76 26" stroke="rgba(0,255,136,0.12)" strokeWidth="0.4" fill="none"/>
              <circle cx="108" cy="30" r="0.5" fill="rgba(0,255,136,0.2)"/>
              <circle cx="106" cy="36" r="0.5" fill="rgba(0,255,136,0.2)"/>
              <circle cx="128" cy="32" r="0.5" fill="rgba(0,255,136,0.2)"/>
              <circle cx="128" cy="38" r="0.5" fill="rgba(0,255,136,0.2)"/>
              <circle cx="76" cy="20" r="0.5" fill="rgba(0,255,136,0.2)"/>
              <circle cx="76" cy="26" r="0.5" fill="rgba(0,255,136,0.2)"/>
              <circle cx="150" cy="8" r="2.2" fill="#03080a" stroke="rgba(0,255,136,0.4)" strokeWidth="0.5"/>
              <circle cx="150" cy="8" r="0.6" fill="rgba(0,255,136,0.15)"/>
              <circle cx="150" cy="8" r="3.2" fill="none" stroke="rgba(0,255,136,0.12)" strokeWidth="0.3"/>
              <path d="M6 84 L58 83 L62 87 L60 101 L64 115 L60 129 L64 143 L58 155 L48 151 L38 157 L28 151 L18 157 L8 151 L6 137 L10 125 L5 113 L9 101 Z" fill="rgba(0,50,25,0.14)" stroke="rgba(0,255,136,0.3)" strokeWidth="1"/>
              <path d="M10 88 L54 87 L56 91 L54 99 L58 113 L54 127 L58 141 L52 149 L44 147 L34 151 L26 147 L16 151 L10 147 L8 135 L12 123 L8 111 L12 99 Z" fill="none" stroke="rgba(0,255,136,0.04)" strokeWidth="0.3"/>
              <rect x="10" y="90" width="48" height="6" rx="0.5" fill="rgba(0,20,10,0.2)" stroke="rgba(0,255,136,0.25)" strokeWidth="0.4"/>
              <rect x="34" y="90" width="3" height="6" fill="rgba(0,255,136,0.04)" stroke="rgba(0,255,136,0.15)" strokeWidth="0.3"/>
              <rect x="10" y="90" width="3" height="6" fill="rgba(0,20,10,0.3)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <rect x="55" y="90" width="3" height="6" fill="rgba(0,20,10,0.3)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <text x="14" y="89" fill="rgba(0,255,136,0.1)" fontSize="2.2" fontFamily="monospace">PCIEX16_1</text>
              <rect x="12" y="104" width="12" height="9" rx="0.5" fill="rgba(0,12,6,0.5)" stroke="rgba(0,255,136,0.3)" strokeWidth="0.5"/>
              <circle cx="14" cy="106" r="0.4" fill="rgba(0,255,136,0.3)"/>
              <line x1="9" y1="106" x2="12" y2="106" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <line x1="9" y1="108.5" x2="12" y2="108.5" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <line x1="9" y1="111" x2="12" y2="111" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <line x1="24" y1="106" x2="27" y2="106" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <line x1="24" y1="108.5" x2="27" y2="108.5" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <line x1="24" y1="111" x2="27" y2="111" stroke="rgba(0,255,136,0.2)" strokeWidth="0.3"/>
              <text x="12" y="118" fill="rgba(0,255,136,0.1)" fontSize="2" fontFamily="monospace">U_BOOT</text>
              <path d="M8 122 L20 122 L20 130 L8 130 Z" fill="rgba(0,12,6,0.3)" stroke="rgba(0,255,136,0.25)" strokeWidth="0.4"/>
              <path d="M8 122 L8 130 L4 130 L4 124 Z" fill="rgba(0,12,6,0.3)" stroke="rgba(0,255,136,0.25)" strokeWidth="0.4"/>
              <text x="6" y="134" fill="rgba(0,255,136,0.08)" fontSize="1.8" fontFamily="monospace">SATA1</text>
              <path d="M22 122 L34 122 L34 130 L22 130 Z" fill="rgba(0,12,6,0.3)" stroke="rgba(0,255,136,0.25)" strokeWidth="0.4"/>
              <path d="M22 122 L22 130 L18 130 L18 124 Z" fill="rgba(0,12,6,0.3)" stroke="rgba(0,255,136,0.25)" strokeWidth="0.4"/>
              <text x="20" y="134" fill="rgba(0,255,136,0.08)" fontSize="1.8" fontFamily="monospace">SATA2</text>
              <circle cx="44" cy="124" r="2" fill="rgba(0,12,6,0.35)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.4"/>
              <circle cx="44" cy="124" r="1.2" fill="none" stroke="rgba(0,255,136,0.1)" strokeWidth="0.2"/>
              <circle cx="50" cy="124" r="2" fill="rgba(0,12,6,0.35)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.4"/>
              <circle cx="50" cy="124" r="1.2" fill="none" stroke="rgba(0,255,136,0.1)" strokeWidth="0.2"/>
              <text x="42" y="130" fill="rgba(0,255,136,0.08)" fontSize="1.8" fontFamily="monospace">CE5 CE6</text>
              <circle cx="14" cy="140" r="2.2" fill="#03080a" stroke="rgba(0,255,136,0.4)" strokeWidth="0.5"/>
              <circle cx="14" cy="140" r="0.6" fill="rgba(0,255,136,0.15)"/>
              <circle cx="14" cy="140" r="3.2" fill="none" stroke="rgba(0,255,136,0.12)" strokeWidth="0.3"/>
              <path d="M12 104 L12 100 L14 98 L14 96" stroke="rgba(0,255,136,0.15)" strokeWidth="0.4" fill="none"/>
              <path d="M24 108 L32 108 L36 110" stroke="rgba(0,255,136,0.12)" strokeWidth="0.4" fill="none"/>
              <path d="M20 130 L20 138 L24 144" stroke="rgba(0,255,136,0.1)" strokeWidth="0.4" fill="none"/>
              <path d="M34 130 L38 136 L42 140" stroke="rgba(0,255,136,0.1)" strokeWidth="0.4" fill="none"/>
              <path d="M10 98 L8 102 L8 106 L12 110" stroke="rgba(0,80,40,0.4)" strokeWidth="0.5" fill="none" strokeDasharray="2 1.5"/>
              <circle cx="32" cy="108" r="0.5" fill="rgba(0,255,136,0.2)"/>
              <circle cx="36" cy="110" r="0.5" fill="rgba(0,255,136,0.2)"/>
              <circle cx="24" cy="144" r="0.5" fill="rgba(0,255,136,0.2)"/>
              <circle cx="42" cy="140" r="0.5" fill="rgba(0,255,136,0.2)"/>
              <path d="M72 64 L156 63 L156 78 L152 88 L156 98 L152 108 L156 118 L152 132 L148 144 L138 152 L128 148 L118 152 L108 148 L98 152 L88 148 L78 152 L74 144 L76 132 L72 120 L76 108 L72 96 L76 84 Z" fill="rgba(0,50,25,0.14)" stroke="rgba(0,255,136,0.3)" strokeWidth="1"/>
              <path d="M76 68 L152 67 L150 76 L148 86 L152 96 L148 106 L152 116 L148 128 L146 138 L138 144 L128 142 L118 146 L108 142 L98 146 L88 142 L80 146 L78 138 L80 128 L76 116 L80 104 L76 92 L80 80 Z" fill="none" stroke="rgba(0,255,136,0.04)" strokeWidth="0.3"/>
              <rect x="80" y="70" width="30" height="11" rx="0.5" fill="rgba(0,12,6,0.4)" stroke="rgba(0,255,136,0.3)" strokeWidth="0.5"/>
              <circle cx="83" cy="73" r="0.4" fill="rgba(0,255,136,0.2)"/><circle cx="86" cy="73" r="0.4" fill="rgba(0,255,136,0.2)"/><circle cx="89" cy="73" r="0.4" fill="rgba(0,255,136,0.2)"/><circle cx="92" cy="73" r="0.4" fill="rgba(0,255,136,0.2)"/><circle cx="95" cy="73" r="0.4" fill="rgba(0,255,136,0.2)"/><circle cx="98" cy="73" r="0.4" fill="rgba(0,255,136,0.2)"/><circle cx="101" cy="73" r="0.4" fill="rgba(0,255,136,0.2)"/><circle cx="104" cy="73" r="0.4" fill="rgba(0,255,136,0.2)"/><circle cx="107" cy="73" r="0.4" fill="rgba(0,255,136,0.2)"/>
              <circle cx="83" cy="78" r="0.4" fill="rgba(0,255,136,0.2)"/><circle cx="86" cy="78" r="0.4" fill="rgba(0,255,136,0.2)"/><circle cx="89" cy="78" r="0.4" fill="rgba(0,255,136,0.2)"/><circle cx="92" cy="78" r="0.4" fill="rgba(0,255,136,0.2)"/><circle cx="95" cy="78" r="0.4" fill="rgba(0,255,136,0.2)"/><circle cx="98" cy="78" r="0.4" fill="rgba(0,255,136,0.2)"/><circle cx="101" cy="78" r="0.4" fill="rgba(0,255,136,0.2)"/><circle cx="104" cy="78" r="0.4" fill="rgba(0,255,136,0.2)"/><circle cx="107" cy="78" r="0.4" fill="rgba(0,255,136,0.2)"/>
              <text x="80" y="69" fill="rgba(0,255,136,0.1)" fontSize="2.2" fontFamily="monospace">ATX_PWR 24PIN</text>
              <rect x="80" y="88" width="44" height="5" rx="0.5" fill="rgba(0,20,10,0.2)" stroke="rgba(0,255,136,0.25)" strokeWidth="0.4"/>
              <rect x="84" y="88" width="2" height="5" fill="rgba(0,255,136,0.04)"/>
              <rect x="112" y="88" width="2" height="5" fill="rgba(0,255,136,0.04)"/>
              <text x="84" y="87" fill="rgba(0,255,136,0.1)" fontSize="2.2" fontFamily="monospace">M2_1 NVMe</text>
              <rect x="130" y="88" width="8" height="6" rx="0.5" fill="rgba(0,12,6,0.4)" stroke="rgba(0,255,136,0.25)" strokeWidth="0.4"/>
              <circle cx="132" cy="90" r="0.3" fill="rgba(0,255,136,0.2)"/><circle cx="135" cy="90" r="0.3" fill="rgba(0,255,136,0.2)"/>
              <circle cx="132" cy="92" r="0.3" fill="rgba(0,255,136,0.2)"/><circle cx="135" cy="92" r="0.3" fill="rgba(0,255,136,0.2)"/>
              <text x="130" y="87" fill="rgba(0,255,136,0.08)" fontSize="1.8" fontFamily="monospace">F_USB</text>
              <rect x="80" y="100" width="10" height="10" rx="0.5" fill="rgba(0,12,6,0.4)" stroke="rgba(0,255,136,0.3)" strokeWidth="0.5"/>
              <rect x="83" y="103" width="4" height="4" fill="none" stroke="rgba(0,255,136,0.08)" strokeWidth="0.3"/>
              <circle cx="82" cy="102" r="0.4" fill="rgba(0,255,136,0.3)"/>
              <text x="80" y="114" fill="rgba(0,255,136,0.1)" fontSize="2" fontFamily="monospace">ALC892</text>
              <circle cx="98" cy="104" r="2" fill="rgba(0,12,6,0.35)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.4"/>
              <circle cx="98" cy="104" r="1.2" fill="none" stroke="rgba(0,255,136,0.1)" strokeWidth="0.2"/>
              <circle cx="104" cy="104" r="2" fill="rgba(0,12,6,0.35)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.4"/>
              <circle cx="104" cy="104" r="1.2" fill="none" stroke="rgba(0,255,136,0.1)" strokeWidth="0.2"/>
              <circle cx="110" cy="104" r="2" fill="rgba(0,12,6,0.35)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.4"/>
              <circle cx="110" cy="104" r="1.2" fill="none" stroke="rgba(0,255,136,0.1)" strokeWidth="0.2"/>
              <text x="96" y="110" fill="rgba(0,255,136,0.08)" fontSize="1.8" fontFamily="monospace">CE7 CE8 CE9</text>
              <rect x="120" y="100" width="14" height="10" rx="0.5" fill="rgba(0,12,6,0.4)" stroke="rgba(0,255,136,0.25)" strokeWidth="0.5"/>
              <circle cx="123" cy="103" r="0.3" fill="rgba(0,255,136,0.2)"/><circle cx="126" cy="103" r="0.3" fill="rgba(0,255,136,0.2)"/><circle cx="129" cy="103" r="0.3" fill="rgba(0,255,136,0.2)"/>
              <circle cx="123" cy="107" r="0.3" fill="rgba(0,255,136,0.2)"/><circle cx="126" cy="107" r="0.3" fill="rgba(0,255,136,0.2)"/><circle cx="129" cy="107" r="0.3" fill="rgba(0,255,136,0.2)"/>
              <text x="120" y="99" fill="rgba(0,255,136,0.08)" fontSize="1.8" fontFamily="monospace">F_PANEL</text>
              <circle cx="142" cy="104" r="2.2" fill="#03080a" stroke="rgba(0,255,136,0.4)" strokeWidth="0.5"/>
              <circle cx="142" cy="104" r="0.6" fill="rgba(0,255,136,0.15)"/>
              <circle cx="142" cy="104" r="3.2" fill="none" stroke="rgba(0,255,136,0.12)" strokeWidth="0.3"/>
              <circle cx="80" cy="120" r="2" fill="rgba(0,12,6,0.35)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.4"/>
              <circle cx="80" cy="120" r="1.2" fill="none" stroke="rgba(0,255,136,0.1)" strokeWidth="0.2"/>
              <circle cx="86" cy="120" r="2" fill="rgba(0,12,6,0.35)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.4"/>
              <circle cx="86" cy="120" r="1.2" fill="none" stroke="rgba(0,255,136,0.1)" strokeWidth="0.2"/>
              <circle cx="92" cy="120" r="2" fill="rgba(0,12,6,0.35)" stroke="rgba(0,255,136,0.2)" strokeWidth="0.4"/>
              <circle cx="92" cy="120" r="1.2" fill="none" stroke="rgba(0,255,136,0.1)" strokeWidth="0.2"/>
              <text x="80" y="126" fill="rgba(0,255,136,0.08)" fontSize="1.8" fontFamily="monospace">CE10-12</text>
              <rect x="100" y="116" width="20" height="14" rx="0.5" fill="rgba(0,12,6,0.4)" stroke="rgba(0,255,136,0.25)" strokeWidth="0.5"/>
              <rect x="104" y="120" width="12" height="6" fill="none" stroke="rgba(0,255,136,0.08)" strokeWidth="0.3"/>
              <text x="102" y="115" fill="rgba(0,255,136,0.08)" fontSize="2" fontFamily="monospace">LAN RTL8111</text>
              <rect x="126" y="118" width="12" height="9" rx="0.5" fill="rgba(0,12,6,0.4)" stroke="rgba(0,255,136,0.25)" strokeWidth="0.5"/>
              <circle cx="129" cy="121" r="0.3" fill="rgba(0,255,136,0.2)"/><circle cx="132" cy="121" r="0.3" fill="rgba(0,255,136,0.2)"/><circle cx="135" cy="121" r="0.3" fill="rgba(0,255,136,0.2)"/>
              <circle cx="129" cy="124" r="0.3" fill="rgba(0,255,136,0.2)"/><circle cx="132" cy="124" r="0.3" fill="rgba(0,255,136,0.2)"/><circle cx="135" cy="124" r="0.3" fill="rgba(0,255,136,0.2)"/>
              <text x="126" y="117" fill="rgba(0,255,136,0.08)" fontSize="1.8" fontFamily="monospace">TPM</text>
              <path d="M110 81 L110 88" stroke="rgba(0,255,136,0.15)" strokeWidth="0.5" fill="none"/>
              <path d="M90 100 L90 96 L92 93 L98 93" stroke="rgba(0,255,136,0.12)" strokeWidth="0.4" fill="none"/>
              <path d="M100 100 L104 104 L110 104" stroke="rgba(0,255,136,0.12)" strokeWidth="0.4" fill="none"/>
              <path d="M120 110 L124 116 L130 116" stroke="rgba(0,255,136,0.1)" strokeWidth="0.4" fill="none"/>
              <path d="M138 110 L142 114 L142 118" stroke="rgba(0,255,136,0.1)" strokeWidth="0.4" fill="none"/>
              <path d="M134 88 L138 92 L142 96" stroke="rgba(0,255,136,0.12)" strokeWidth="0.4" fill="none"/>
              <path d="M80 82 L76 86 L76 92" stroke="rgba(0,80,40,0.4)" strokeWidth="0.5" fill="none" strokeDasharray="2 1.5"/>
              <path d="M148 100 L152 106 L148 112" stroke="rgba(0,80,40,0.3)" strokeWidth="0.5" fill="none" strokeDasharray="2 1"/>
              <circle cx="92" cy="93" r="0.5" fill="rgba(0,255,136,0.2)"/>
              <circle cx="110" cy="104" r="0.5" fill="rgba(0,255,136,0.2)"/>
              <circle cx="130" cy="116" r="0.5" fill="rgba(0,255,136,0.2)"/>
              <circle cx="142" cy="118" r="0.5" fill="rgba(0,255,136,0.2)"/>
              <circle cx="138" cy="92" r="0.5" fill="rgba(0,255,136,0.2)"/>
              <path d="M30 67 L36 63 L32 73 L44 69 L38 79 L50 75 L44 85" fill="none" stroke="#000" strokeWidth="2.5" opacity="0.9"/>
              <path d="M30 67 L36 63 L32 73 L44 69 L38 79 L50 75 L44 85" fill="none" stroke="rgba(0,255,136,0.08)" strokeWidth="0.4"/>
              <path d="M50 85 L56 79 L54 87" fill="none" stroke="#000" strokeWidth="2" opacity="0.85"/>
              <path d="M50 85 L56 79 L54 87" fill="none" stroke="rgba(0,255,136,0.06)" strokeWidth="0.3"/>
              <path d="M64 30 L70 26 L66 36 L74 32" fill="none" stroke="#000" strokeWidth="2" opacity="0.85"/>
              <path d="M64 30 L70 26 L66 36 L74 32" fill="none" stroke="rgba(0,255,136,0.06)" strokeWidth="0.3"/>
              <path d="M64 50 L70 46 L66 56 L72 52" fill="none" stroke="#000" strokeWidth="2" opacity="0.85"/>
              <path d="M64 50 L70 46 L66 56 L72 52" fill="none" stroke="rgba(0,255,136,0.06)" strokeWidth="0.3"/>
              <path d="M60 90 L66 86 L62 96 L70 92 L66 100" fill="none" stroke="#000" strokeWidth="2" opacity="0.85"/>
              <path d="M60 90 L66 86 L62 96 L70 92 L66 100" fill="none" stroke="rgba(0,255,136,0.06)" strokeWidth="0.3"/>
              <path d="M68 110 L74 106 L70 116 L76 112" fill="none" stroke="#000" strokeWidth="2" opacity="0.85"/>
              <path d="M68 110 L74 106 L70 116 L76 112" fill="none" stroke="rgba(0,255,136,0.06)" strokeWidth="0.3"/>
              <path d="M66 132 L72 128 L68 138 L74 134" fill="none" stroke="#000" strokeWidth="2" opacity="0.8"/>
              <path d="M66 132 L72 128 L68 138 L74 134" fill="none" stroke="rgba(0,255,136,0.06)" strokeWidth="0.3"/>
              <line x1="34" y1="65" x2="38" y2="69" stroke="rgba(0,255,136,0.1)" strokeWidth="0.3"/>
              <line x1="40" y1="71" x2="44" y2="75" stroke="rgba(0,255,136,0.08)" strokeWidth="0.3"/>
              <line x1="66" y1="28" x2="68" y2="32" stroke="rgba(0,255,136,0.08)" strokeWidth="0.3"/>
              <line x1="68" y1="54" x2="70" y2="58" stroke="rgba(0,255,136,0.08)" strokeWidth="0.3"/>
              <circle cx="44" cy="69" r="1.5" fill="#00ff88" opacity="0.85"/>
              <circle cx="44" cy="69" r="3" fill="none" stroke="#00ff88" strokeWidth="0.5" opacity="0.3"/>
              <circle cx="50" cy="75" r="1.2" fill="#00ff88" opacity="0.6"/>
              <circle cx="38" cy="79" r="1" fill="#00ff88" opacity="0.5"/>
              <circle cx="70" cy="32" r="1.3" fill="#00ff88" opacity="0.7"/>
              <circle cx="70" cy="32" r="2.5" fill="none" stroke="#00ff88" strokeWidth="0.4" opacity="0.25"/>
              <circle cx="66" cy="36" r="0.9" fill="#00ff88" opacity="0.45"/>
              <circle cx="72" cy="52" r="1.2" fill="#00ff88" opacity="0.6"/>
              <circle cx="66" cy="56" r="0.8" fill="#00ff88" opacity="0.4"/>
              <circle cx="70" cy="92" r="1.3" fill="#00ff88" opacity="0.7"/>
              <circle cx="70" cy="92" r="2.5" fill="none" stroke="#00ff88" strokeWidth="0.4" opacity="0.25"/>
              <circle cx="62" cy="96" r="0.9" fill="#00ff88" opacity="0.45"/>
              <circle cx="76" cy="112" r="1.2" fill="#00ff88" opacity="0.6"/>
              <circle cx="70" cy="116" r="0.8" fill="#00ff88" opacity="0.4"/>
              <circle cx="74" cy="134" r="1" fill="#00ff88" opacity="0.5"/>
              <circle cx="68" cy="138" r="0.8" fill="#00ff88" opacity="0.4"/>
              <path d="M40 73 L46 77 L42 83 L36 79 Z" fill="rgba(0,50,25,0.06)" stroke="rgba(0,255,136,0.12)" strokeWidth="0.4"/>
              <circle cx="41" cy="78" r="0.4" fill="rgba(0,255,136,0.1)"/>
              <line x1="38" y1="76" x2="42" y2="80" stroke="rgba(0,255,136,0.06)" strokeWidth="0.2"/>
              <path d="M50 80 L56 84 L52 90 L46 86 Z" fill="rgba(0,50,25,0.05)" stroke="rgba(0,255,136,0.1)" strokeWidth="0.3"/>
              <circle cx="51" cy="85" r="0.3" fill="rgba(0,255,136,0.08)"/>
              <path d="M64 38 L70 42 L66 48 L60 44 Z" fill="rgba(0,50,25,0.06)" stroke="rgba(0,255,136,0.12)" strokeWidth="0.4"/>
              <circle cx="65" cy="43" r="0.4" fill="rgba(0,255,136,0.1)"/>
              <path d="M64 58 L70 62 L66 68 L60 64 Z" fill="rgba(0,50,25,0.05)" stroke="rgba(0,255,136,0.1)" strokeWidth="0.3"/>
              <path d="M60 100 L66 104 L62 110 L56 106 Z" fill="rgba(0,50,25,0.06)" stroke="rgba(0,255,136,0.12)" strokeWidth="0.4"/>
              <circle cx="61" cy="105" r="0.4" fill="rgba(0,255,136,0.1)"/>
              <path d="M66 118 L72 122 L68 128 L62 124 Z" fill="rgba(0,50,25,0.05)" stroke="rgba(0,255,136,0.1)" strokeWidth="0.3"/>
              <path d="M64 140 L70 144 L66 150 L60 146 Z" fill="rgba(0,50,25,0.04)" stroke="rgba(0,255,136,0.08)" strokeWidth="0.3"/>
              <line x1="34" y1="70" x2="30" y2="76" stroke="rgba(0,255,136,0.06)" strokeWidth="0.2"/>
              <line x1="48" y1="72" x2="52" y2="68" stroke="rgba(0,255,136,0.06)" strokeWidth="0.2"/>
              <line x1="56" y1="82" x2="60" y2="86" stroke="rgba(0,255,136,0.06)" strokeWidth="0.2"/>
              <line x1="62" y1="40" x2="58" y2="44" stroke="rgba(0,255,136,0.06)" strokeWidth="0.2"/>
              <line x1="62" y1="60" x2="58" y2="64" stroke="rgba(0,255,136,0.06)" strokeWidth="0.2"/>
              <line x1="58" y1="102" x2="54" y2="106" stroke="rgba(0,255,136,0.06)" strokeWidth="0.2"/>
              <line x1="58" y1="120" x2="54" y2="124" stroke="rgba(0,255,136,0.06)" strokeWidth="0.2"/>
            </svg>
            <h1 className="welcome-title">SBDT</h1>
            <p className="welcome-subtitle">// awaiting ur brain to wakeup</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="message-label">
              {msg.role === "user" ? "› YOU" : msg.role === "assistant" ? "› SBDT" : "› SYS"}
            </div>
            <div className={`message-content ${msg.meta?.asThinking ? "thinking" : ""}`}>
              {msg.content || "..."}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>

      {/* Loading indicator */}
      {busy && (
        <div className="loading-bar">
          <span className="loading-prefix">
            {activeTool
              ? `lemme work on ur ask twin via `
              : `lemme work on ur ask twin...`}
          </span>
          {activeTool && <span className="loading-tool">{activeTool}</span>}
          <span className="loading-cursor" />
        </div>
      )}

      {/* Slash command menu */}
      {showMenu && (
        <div className="slash-menu">
          {slashMenu.map((cmd, i) => (
            <div
              key={cmd.label}
              className={`slash-item ${i === menuIndex ? "active" : ""}`}
              onMouseEnter={() => setMenuIndex(i)}
              onClick={() => {
                handleSubmit(cmd.label);
                inputRef.current?.focus();
              }}
            >
              <span className="slash-label">{cmd.label}</span>
              <span className="slash-desc">{cmd.description}</span>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <footer className="alien-input-area">
        <div className="input-wrapper">
          <span className="input-prompt">›</span>
          <textarea
            ref={inputRef}
            className="alien-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={busy ? "" : "Type / for commands, or your message..."}
            rows={1}
            disabled={busy}
          />
          {busy && (
            <button className="alien-btn interrupt" onClick={handleInterrupt}>
              ◼ STOP
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

function formatParams(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join("  ");
    }
  } catch {
    // fallthrough
  }
  return raw;
}
