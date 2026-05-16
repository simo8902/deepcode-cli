import React from "react";
import {Box, Text} from "ink";
import * as os from "node:os";
import path from 'node:path';
import type {SkillInfo} from "../session";
import type {ResolvedDeepcodingSettings} from "../settings";
import {buildSlashCommands, BUILTIN_SLASH_COMMANDS, formatSlashCommandDescription} from "./slashCommands";

type WelcomeScreenProps = {
  projectRoot: string;
  settings: ResolvedDeepcodingSettings;
  skills: SkillInfo[];
  version: string;
  width: number;
};

const SHORTCUT_TIPS = [
  { label: "Enter", description: "Send the prompt" },
  { label: "Shift+Enter", description: "Insert a newline" },
  { label: "Ctrl+V", description: "Paste an image from the clipboard" },
  { label: "Esc", description: "Interrupt the current model turn" },
  { label: "/", description: "Open the skills and commands menu" },
  { label: "Ctrl+D twice", description: "Quit Deep Code CLI" }
];

export function WelcomeScreen({
  version,
}: WelcomeScreenProps): React.ReactElement {
  return (
    <Box flexDirection="column" marginY={1} paddingX={1}>
      <Box>
        <Text color={"green"}>SIMEON's dev CLI</Text>
        <Text> (v{version || "unknown"})</Text>
      </Box>
      <Text>
        developed and <Text color="green">maintained by SIMO</Text>
      </Text>
    </Box>
  );
}

export function formatHomeRelativePath(value: string, home = os.homedir()): string {
  const pathApi = value.startsWith("/") && home.startsWith("/") ? path.posix : path;
  const normalizedValue = pathApi.resolve(value);
  const normalizedHome = pathApi.resolve(home);
  const relative = pathApi.relative(normalizedHome, normalizedValue);

  if (relative === "") {
    return "~";
  }
  if (!relative.startsWith("..") && !pathApi.isAbsolute(relative)) {
    return `~/${relative.replace(/\\/g, "/")}`;
  }
  return normalizedValue.replace(/\\/g, "/");
}

export function buildWelcomeTips(skills: SkillInfo[]): Array<{ label: string; description: string }> {
  const slashTips = buildSlashCommands(skills)
    .filter((item) => item.kind !== "skill" || item.skill?.isLoaded)
    .map((item) => ({
      label: item.label,
      description: formatSlashCommandDescription(item.description)
    }));

  return [
    ...slashTips,
    ...SHORTCUT_TIPS.filter((tip) => !BUILTIN_SLASH_COMMANDS.some((command) => command.label === tip.label))
  ];
}
