import type { ReasoningEffort } from "./settings";

type ThinkingConfig = {
  type: "enabled" | "disabled";
};

type ProviderOptions = {
  only?: string[];
  allow_fallbacks: boolean;
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
  _zdr?: boolean
): ThinkingRequestOptions {
  const providerOptions: ProviderOptions | undefined =
    provider
      ? {
          only: [provider],
          allow_fallbacks: false
        }
      : undefined;

  if (isOpenRouterBaseURL(baseURL)) {
    return {
      ...(thinkingEnabled ? { reasoning: { effort: reasoningEffort } } : {}),
      ...(providerOptions ? { provider: providerOptions } : {})
    };
  }

  return {
    thinking: { type: thinkingEnabled ? "enabled" : "disabled" },
    ...(thinkingEnabled ? { reasoning_effort: reasoningEffort } : {}),
    ...(providerOptions ? { provider: providerOptions } : {})
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
