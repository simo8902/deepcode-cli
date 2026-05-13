import { defaultsToThinkingMode } from "./model-capabilities";

export type DeepcodingEnv = {
  MODEL?: string;
  BASE_URL?: string;
  API_KEY?: string;
  THINKING?: string;
  PROVIDER?: string;
  PROVIDER_PRIVACY?: string;
  providerPrivacyMode?: string;
  ZDR?: string;
};

export type ReasoningEffort = "xhigh" | "high" | "medium" | "low" | "minimal" | "none";
export type ProviderPrivacyMode = "off" | "strict";

export type DeepcodingSettings = {
  env?: DeepcodingEnv;
  thinkingEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
  debugLogEnabled?: boolean;
  notify?: string;
  webSearchTool?: string;
  providerPrivacyMode?: ProviderPrivacyMode;
  zdr?: boolean;
};

export type ResolvedDeepcodingSettings = {
  apiKey?: string;
  baseURL: string;
  model: string;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  debugLogEnabled: boolean;
  notify?: string;
  webSearchTool?: string;
  provider?: string;
  providerPrivacyMode: ProviderPrivacyMode;
  zdr?: boolean;
};

function resolveReasoningEffort(value: unknown): ReasoningEffort {
  const valid: ReasoningEffort[] = ["xhigh", "high", "medium", "low", "minimal", "none"];
  if (value === "max") {
    return "xhigh";
  }
  return valid.includes(value as ReasoningEffort) ? (value as ReasoningEffort) : "xhigh";
}

function resolveThinkingEnabled(
  settings: DeepcodingSettings | null | undefined,
  model: string
): boolean {
  if (typeof settings?.thinkingEnabled === "boolean") {
    return settings.thinkingEnabled;
  }

  const legacyThinking = settings?.env?.THINKING;
  if (typeof legacyThinking === "string" && legacyThinking.trim()) {
    return legacyThinking.trim().toLowerCase() === "enabled";
  }

  return defaultsToThinkingMode(model);
}

function resolveProviderPrivacyMode(value: unknown): ProviderPrivacyMode {
  return value === "strict" ? "strict" : "off";
}

export function resolveSettings(
  settings: DeepcodingSettings | null | undefined,
  defaults: { model: string; baseURL: string }
): ResolvedDeepcodingSettings {
  const env = settings?.env ?? {};
  const model = env.MODEL?.trim() || defaults.model;
  const notify = typeof settings?.notify === "string" ? settings.notify.trim() : "";
  const webSearchTool =
    typeof settings?.webSearchTool === "string" ? settings.webSearchTool.trim() : "";
  const provider = env.PROVIDER?.trim();
  const providerPrivacyMode = resolveProviderPrivacyMode(
    env.PROVIDER_PRIVACY?.trim() || env.providerPrivacyMode?.trim() || settings?.providerPrivacyMode
  );
  const zdr = env.ZDR ? env.ZDR.trim().toLowerCase() === "true" : (settings?.zdr === true);

  return {
    apiKey: env.API_KEY?.trim(),
    baseURL: env.BASE_URL?.trim() || defaults.baseURL,
    model,
    thinkingEnabled: resolveThinkingEnabled(settings, model),
    reasoningEffort: resolveReasoningEffort(settings?.reasoningEffort),
    debugLogEnabled: settings?.debugLogEnabled === true,
    notify: notify || undefined,
    webSearchTool: webSearchTool || undefined,
    provider: provider || undefined,
    providerPrivacyMode,
    zdr: zdr || undefined
  };
}
