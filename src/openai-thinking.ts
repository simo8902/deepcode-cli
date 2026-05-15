import type { DataCollection, ReasoningEffort } from "./settings";

type ThinkingConfig = {
  type: "enabled" | "disabled";
};

type ProviderOptions = {
  only?: string[];
  allow_fallbacks: boolean;
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

  // provider routing options (allow_fallbacks, zdr, data_collection) are
  // OpenRouter-specific — sending them to other endpoints (e.g. api.deepseek.com)
  // causes the API to return misleading 400 errors.
  const hasProviderOptions = openRouter && (provider || zdr || dataCollection);
  const providerOptions: ProviderOptions | undefined = hasProviderOptions
    ? {
        ...(provider ? { only: [provider] } : {}),
        allow_fallbacks: false,
        ...(zdr ? { zdr: true } : {}),
        ...(dataCollection ? { data_collection: dataCollection } : {})
      }
    : undefined;

  if (openRouter) {
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
