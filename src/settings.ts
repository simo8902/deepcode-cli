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
  DATA_COLLECTION?: string;
  SBDT_CONFIRM_SIDE_EFFECTS?: string;
  IDA_MCP_URL?: string;
  CONTEXT_WINDOW?: string;
};

export type ReasoningEffort = "xhigh" | "high" | "medium" | "low" | "minimal" | "none";
export type ProviderPrivacyMode = "off" | "strict";
export type DataCollection = "allow" | "deny";
export type AssistantTone = "neutral" | "direct" | "boundary";

export type NativeLlamaCppSettings = {
  enabled?: boolean;
  pythonPath?: string;
  modelPath?: string;
  chatFormat?: string;
  nCtx?: number;
  nGpuLayers?: number;
  flashAttn?: boolean;
  nBatch?: number;
  kvTypeK?: "f16" | "q8_0";
  kvTypeV?: "f16" | "q8_0";
  useMmap?: boolean;
  maxTokens?: number;
};

export type ModelProfile = DeepcodingEnv & {
  nativeLlamaCpp?: NativeLlamaCppSettings;
};

export type DeepcodingSettings = {
  env?: DeepcodingEnv;
  models?: Record<string, ModelProfile>;
  activeModel?: string;
  thinkingEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
  debugLogEnabled?: boolean;
  notify?: string;
  webSearchTool?: string;
  providerPrivacyMode?: ProviderPrivacyMode;
  zdr?: boolean;
  dataCollection?: DataCollection;
  sideEffectConfirmationRequired?: boolean;
  promptImprovementEnabled?: boolean;
  maxAgentIterations?: number;
  assistantTone?: AssistantTone;
  hermesRepoDir?: string;
  filesystemMcpPath?: string;
  cacheControl?: boolean;
  idaMcpUrl?: string;
  temperature?: number;
  topP?: number;
  repetitionPenalty?: number;
  nativeLlamaCpp?: NativeLlamaCppSettings;
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
  dataCollection?: DataCollection;
  sideEffectConfirmationRequired: boolean;
  promptImprovementEnabled: boolean;
  maxAgentIterations: number;
  assistantTone: AssistantTone;
  hermesRepoDir?: string;
  filesystemMcpPath?: string;
  cacheControl?: boolean;
  idaMcpUrl?: string;
  contextWindow?: number;
  temperature?: number;
  topP?: number;
  repetitionPenalty?: number;
  nativeLlamaCpp?: NativeLlamaCppSettings;
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

function resolveDataCollection(value: unknown): DataCollection | undefined {
  if (value === "deny") return "deny";
  if (value === "allow") return "allow";
  return undefined;
}

function resolveAssistantTone(value: unknown): AssistantTone {
  return value === "direct" || value === "boundary" ? value : "neutral";
}

function resolveMaxAgentIterations(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return 64;
  return Math.min(1000, Math.max(1, value));
}

function resolveSideEffectConfirmationRequired(settings: DeepcodingSettings | null | undefined): boolean {
  const processOverride = process.env.SBDT_CONFIRM_SIDE_EFFECTS?.trim();
  if (processOverride) return processOverride.toLowerCase() === "true";

  const configuredEnv = settings?.env?.SBDT_CONFIRM_SIDE_EFFECTS?.trim();
  if (configuredEnv) return configuredEnv.toLowerCase() === "true";

  return settings?.sideEffectConfirmationRequired === true;
}

export function resolveSettings(
  settings: DeepcodingSettings | null | undefined,
  defaults: { model: string; baseURL: string }
): ResolvedDeepcodingSettings {
  // Resolve which env to use: active model profile > top-level env > defaults
  let env = settings?.env ?? {};
  let activeProfile: ModelProfile | undefined;
  const activeModel = settings?.activeModel?.trim();
  if (activeModel && settings?.models?.[activeModel]) {
    activeProfile = settings.models[activeModel];
    env = { ...env, ...activeProfile };
  }

  const model = env.MODEL?.trim() || defaults.model;
  const notify = typeof settings?.notify === "string" ? settings.notify.trim() : "";
  const webSearchTool =
    typeof settings?.webSearchTool === "string" ? settings.webSearchTool.trim() : "";
  const provider = env.PROVIDER?.trim();
  const providerPrivacyMode = resolveProviderPrivacyMode(
    env.PROVIDER_PRIVACY?.trim() || env.providerPrivacyMode?.trim() || settings?.providerPrivacyMode
  );
  const zdr = env.ZDR ? env.ZDR.trim().toLowerCase() === "true" : (settings?.zdr === true);
  const dataCollection = resolveDataCollection(
    env.DATA_COLLECTION?.trim() || settings?.dataCollection
  );

  // Auto-route OpenRouter-style model names (e.g. "provider/model-name") to
  // OpenRouter when no explicit BASE_URL has been configured. This lets users
  // set any OpenRouter model without also having to set BASE_URL manually.
  const explicitBaseURL = env.BASE_URL?.trim();
  const resolvedBaseURL = explicitBaseURL
    || (model.includes("/") ? "https://openrouter.ai/api/v1" : defaults.baseURL);

  return {
    apiKey: env.API_KEY?.trim(),
    baseURL: resolvedBaseURL,
    model,
    thinkingEnabled: resolveThinkingEnabled(settings, model),
    reasoningEffort: resolveReasoningEffort(settings?.reasoningEffort),
    debugLogEnabled: settings?.debugLogEnabled === true,
    notify: notify || undefined,
    webSearchTool: webSearchTool || undefined,
    provider: provider || undefined,
    providerPrivacyMode,
    zdr: zdr || undefined,
    dataCollection,
    sideEffectConfirmationRequired: resolveSideEffectConfirmationRequired(settings),
    promptImprovementEnabled: settings?.promptImprovementEnabled !== false,
    maxAgentIterations: resolveMaxAgentIterations(settings?.maxAgentIterations),
    assistantTone: resolveAssistantTone(settings?.assistantTone),
    hermesRepoDir: typeof settings?.hermesRepoDir === "string" && settings.hermesRepoDir.trim()
      ? settings.hermesRepoDir.trim()
      : undefined,
    filesystemMcpPath: typeof settings?.filesystemMcpPath === "string" && settings.filesystemMcpPath.trim()
      ? settings.filesystemMcpPath.trim()
      : undefined,
    cacheControl: settings?.cacheControl === true ? true : undefined,
    idaMcpUrl: env.IDA_MCP_URL?.trim() || process.env.IDA_MCP_URL?.trim(),
    contextWindow: (() => {
      const raw = env.CONTEXT_WINDOW?.trim();
      if (!raw) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    })(),
    temperature: typeof settings?.temperature === "number" && Number.isFinite(settings.temperature) ? settings.temperature : undefined,
    topP: typeof settings?.topP === "number" && Number.isFinite(settings.topP) ? settings.topP : undefined,
    repetitionPenalty: typeof settings?.repetitionPenalty === "number" && Number.isFinite(settings.repetitionPenalty) ? settings.repetitionPenalty : undefined,
    nativeLlamaCpp: activeProfile?.nativeLlamaCpp?.enabled === true
      ? activeProfile.nativeLlamaCpp
      : settings?.nativeLlamaCpp?.enabled === true
        ? settings.nativeLlamaCpp
      : undefined
  };
}
