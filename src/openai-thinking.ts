import type { DataCollection, ReasoningEffort } from "./settings";

type ThinkingConfig = {
  type: "enabled" | "disabled";
};

type ProviderOptions = {
  only?: string[];
  allow_fallbacks: boolean;
  require_parameters?: boolean;
  zdr?: boolean;
  data_collection?: DataCollection;
};

type ThinkingRequestOptions = {
  thinking?: ThinkingConfig;
  reasoning_effort?: ReasoningEffort;
  reasoning?: {
    effort: ReasoningEffort;
  };
  provider?: ProviderOptions;
};

export function buildThinkingRequestOptions(
  thinkingEnabled: boolean,
  baseURL?: string,
  reasoningEffort: ReasoningEffort = "xhigh",
  provider?: string,
  zdr?: boolean,
  dataCollection?: DataCollection
): ThinkingRequestOptions {
  const openRouter = isOpenRouterBaseURL(baseURL);
  const deepSeek = isDeepSeekBaseURL(baseURL);

  // For generic OpenAI-compatible endpoints (not OpenRouter, not DeepSeek),
  // don't send any provider-specific thinking/reasoning fields — they cause 400 errors.
  if (!openRouter && !deepSeek) {
    return {};
  }

  // provider routing options are OpenRouter-specific — sending them to other
  // endpoints (e.g. api.deepseek.com) causes misleading 400 errors.
  if (openRouter) {
    const hasCustomRouting = provider || zdr || dataCollection;
    const providerOptions: ProviderOptions | undefined = hasCustomRouting
      ? {
          allow_fallbacks: !provider,
          ...(provider ? { only: [provider] } : {}),
          ...(zdr ? { zdr: true } : {}),
          ...(dataCollection ? { data_collection: dataCollection } : {})
        }
      : undefined;
    return {
      ...(thinkingEnabled ? { reasoning: { effort: reasoningEffort } } : {}),
      ...(providerOptions ? { provider: providerOptions } : {})
    };
  }

  return {
    thinking: { type: thinkingEnabled ? "enabled" : "disabled" },
    ...(thinkingEnabled ? { reasoning_effort: reasoningEffort } : {})
  };
}

function isOpenRouterBaseURL(baseURL: string | undefined): boolean {
  if (!baseURL) {
    return false;
  }
  try {
    return new URL(baseURL).hostname.toLowerCase() === "openrouter.ai";
  } catch {
    return baseURL.toLowerCase().includes("openrouter.ai");
  }
}

function isDeepSeekBaseURL(baseURL: string | undefined): boolean {
  if (!baseURL) {
    return true; // no URL → default endpoint is DeepSeek
  }
  try {
    const host = new URL(baseURL).hostname.toLowerCase();
    return host.includes("deepseek.com") || host.includes("volces.com");
  } catch {
    const lower = baseURL.toLowerCase();
    return lower.includes("deepseek.com") || lower.includes("volces.com");
  }
}
