import type { LlmStreamProgress, SessionEntry } from "../session";

type RunningProcesses = SessionEntry["processes"];

export type LoadingTextInput = {
  progress: LlmStreamProgress | null;
  processes?: RunningProcesses;
  activeTool?: string | null;
  now: number;
};

export type LoadingTextOutput = {
  prefix: string;
  tool: string | null;
};

export function buildLoadingText(input: LoadingTextInput): LoadingTextOutput {
  const { activeTool, progress } = input;
  if (activeTool) {
    return { prefix: "lemme work on ur ask twin via ", tool: activeTool };
  }
  if (progress?.detail) {
    return { prefix: progress.detail, tool: null };
  }
  return { prefix: "lemme work on ur ask twin...", tool: null };
}
