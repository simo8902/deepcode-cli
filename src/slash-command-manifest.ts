export type BuiltinSlashCommandKind =
  | "skills"
  | "new"
  | "init"
  | "resume"
  | "exit"
  | "ida"
  | "ce"
  | "model"
  | "log"
  | "cbm";

export type CommandSurface = "terminal" | "electron" | "cli";

export type BuiltinSlashCommand = {
  kind: BuiltinSlashCommandKind;
  name: string;
  label: string;
  description: string;
  surfaces: readonly CommandSurface[];
};

export const BUILTIN_SLASH_COMMAND_MANIFEST: readonly BuiltinSlashCommand[] = [
  { kind: "skills", name: "skills", label: "/skills", description: "List available skills", surfaces: ["terminal", "electron", "cli"] },
  { kind: "new", name: "new", label: "/new", description: "Start a fresh conversation", surfaces: ["terminal", "electron", "cli"] },
  { kind: "init", name: "init", label: "/init", description: "Regenerate project instructions (automatic when missing)", surfaces: ["terminal", "electron", "cli"] },
  { kind: "resume", name: "resume", label: "/resume", description: "Pick a previous conversation to continue", surfaces: ["terminal", "electron", "cli"] },
  { kind: "exit", name: "exit", label: "/exit", description: "Quit SBDT", surfaces: ["terminal", "electron", "cli"] },
  { kind: "ida", name: "ida", label: "/ida", description: "Reconnect to IDA Pro MCP server", surfaces: ["terminal", "electron", "cli"] },
  { kind: "ce", name: "ce", label: "/CE", description: "Reconnect to Cheat Engine MCP server", surfaces: ["terminal", "electron", "cli"] },
  { kind: "cbm", name: "cbm", label: "/cbm", description: "Connect Codebase Memory tools", surfaces: ["terminal", "electron", "cli"] },
  { kind: "model", name: "model", label: "/model", description: "List or switch saved model profiles", surfaces: ["terminal", "electron", "cli"] },
  { kind: "log", name: "log", label: "/log", description: "Write current session tool output to a log", surfaces: ["terminal", "electron", "cli"] }
];

export function getBuiltinSlashCommands(surface: CommandSurface): BuiltinSlashCommand[] {
  return BUILTIN_SLASH_COMMAND_MANIFEST.filter((command) => command.surfaces.includes(surface));
}

export function getBuiltinSlashCommandNames(surface: CommandSurface): string {
  return getBuiltinSlashCommands(surface).map((command) => command.label).join(", ");
}

export function formatBuiltinSlashCommandHelp(surface: CommandSurface): string[] {
  return getBuiltinSlashCommands(surface).map(
    (command) => `  ${command.label.padEnd(16)} ${command.description}`
  );
}
