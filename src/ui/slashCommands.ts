import type { SkillInfo } from "../session";

export type SlashCommandKind = "skill" | "skills" | "new" | "init" | "resume" | "exit" | "ida" | "ce";

export type SlashCommandItem = {
  kind: SlashCommandKind;
  name: string;
  label: string;
  description: string;
  skill?: SkillInfo;
};

export const BUILTIN_SLASH_COMMANDS: SlashCommandItem[] = [
  {
    kind: "skills",
    name: "skills",
    label: "/skills",
    description: "List available skills"
  },
  {
    kind: "new",
    name: "new",
    label: "/new",
    description: "Start a fresh conversation"
  },
  {
    kind: "init",
    name: "init",
    label: "/init",
    description: "Initialize an AGENTS.md file with instructions for LLM"
  },
  {
    kind: "resume",
    name: "resume",
    label: "/resume",
    description: "Pick a previous conversation to continue"
  },
  {
    kind: "exit",
    name: "exit",
    label: "/exit",
    description: "Quit Deep Code CLI"
  },
  {
    kind: "ida",
    name: "ida",
    label: "/ida",
    description: "Reconnect to IDA Pro MCP server"
  },
  {
    kind: "ce",
    name: "ce",
    label: "/CE",
    description: "Reconnect to Cheat Engine MCP server"
  }
];

export function buildSlashCommands(skills: SkillInfo[]): SlashCommandItem[] {
  const skillItems: SlashCommandItem[] = skills.map((skill) => ({
    kind: "skill",
    name: skill.name,
    label: `/${skill.name}`,
    description: skill.description || "(no description)",
    skill
  }));
  return [...skillItems, ...BUILTIN_SLASH_COMMANDS];
}

export function filterSlashCommands(
  items: SlashCommandItem[],
  token: string
): SlashCommandItem[] {
  if (!token.startsWith("/")) {
    return [];
  }
  const query = token.slice(1).toLowerCase();
  if (!query) {
    return items;
  }
  return items.filter((item) => item.name.toLowerCase().includes(query));
}

export function findExactSlashCommand(
  items: SlashCommandItem[],
  token: string
): SlashCommandItem | null {
  if (!token.startsWith("/")) {
    return null;
  }
  const query = token.slice(1).toLowerCase();
  const matches = items.filter((item) => item.name.toLowerCase() === query);
  return matches.find((item) => item.kind !== "skill") ?? matches[0] ?? null;
}

export function formatSlashCommandDescription(description: string): string {
  return (description || "(no description)").trim().replace(/\s+/g, " ");
}

export function formatSlashCommandLabel(item: SlashCommandItem): string {
  return item.kind === "skill" && item.skill?.isLoaded ? `${item.label} ✓` : item.label;
}
