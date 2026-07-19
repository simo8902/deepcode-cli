import type { SkillInfo } from "../session";
import {
  getBuiltinSlashCommands,
  type BuiltinSlashCommandKind
} from "../slash-command-manifest";

export type SlashCommandKind = "skill" | BuiltinSlashCommandKind;

export type SlashCommandItem = {
  kind: SlashCommandKind;
  name: string;
  label: string;
  description: string;
  skill?: SkillInfo;
};

export const BUILTIN_SLASH_COMMANDS: SlashCommandItem[] = getBuiltinSlashCommands("terminal").map((command) => ({
  kind: command.kind,
  name: command.name,
  label: command.label,
  description: command.description
}));

export function buildSlashCommands(skills: SkillInfo[]): SlashCommandItem[] {
  const skillItems: SlashCommandItem[] = skills.map((skill) => ({
    kind: "skill",
    name: skill.commandName ?? skill.name,
    label: `/${skill.commandName ?? skill.name}`,
    description: skill.isAmbiguous
      ? `${skill.description || "(no description)"} [duplicate name; qualified command required]`
      : skill.description || "(no description)",
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
