import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import OpenAI from "openai";
import {
  resolveSettings,
  type DataCollection,
  type DeepcodingSettings,
  type NativeLlamaCppSettings,
  type ProviderPrivacyMode,
  type ReasoningEffort
} from "./settings";

export const DEFAULT_MODEL = "deepseek-v4-pro";
export const DEFAULT_BASE_URL = "https://api.deepseek.com";

export function readSettings(): DeepcodingSettings | null {
  try {
    const settingsPath = path.join(os.homedir(), ".sbdt", "settings.json");
    if (!fs.existsSync(settingsPath)) {
      return null;
    }
    const raw = fs.readFileSync(settingsPath, "utf8");
    return JSON.parse(raw) as DeepcodingSettings;
  } catch {
    return null;
  }
}

export function resolveCurrentSettings(activeModelOverride?: string): ReturnType<typeof resolveSettings> {
  const settings = readSettings();
  const effectiveSettings = activeModelOverride && settings
    ? { ...settings, activeModel: activeModelOverride }
    : settings;
  return resolveSettings(effectiveSettings, {
    model: DEFAULT_MODEL,
    baseURL: DEFAULT_BASE_URL
  });
}

export function createOpenAIClient(activeModelOverride?: string): {
  client: OpenAI | null;
  model: string;
  baseURL: string;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  debugLogEnabled: boolean;
  notify?: string;
  webSearchTool?: string;
  machineId?: string;
  provider?: string;
  providerPrivacyMode: ProviderPrivacyMode;
  zdr?: boolean;
  dataCollection?: DataCollection;
  cacheControl?: boolean;
  temperature?: number;
  topP?: number;
  repetitionPenalty?: number;
  nativeLlamaCpp?: NativeLlamaCppSettings;
} {
  const settings = resolveCurrentSettings(activeModelOverride);
  if (!settings.apiKey) {
    return {
      client: null,
      model: settings.model,
      baseURL: settings.baseURL,
      thinkingEnabled: settings.thinkingEnabled,
      reasoningEffort: settings.reasoningEffort,
      debugLogEnabled: settings.debugLogEnabled,
      notify: settings.notify,
      webSearchTool: settings.webSearchTool,
      machineId: getMachineId(),
      provider: settings.provider,
      providerPrivacyMode: settings.providerPrivacyMode,
      zdr: settings.zdr,
      dataCollection: settings.dataCollection,
      cacheControl: settings.cacheControl,
      temperature: settings.temperature,
      topP: settings.topP,
      repetitionPenalty: settings.repetitionPenalty,
      nativeLlamaCpp: settings.nativeLlamaCpp
    };
  }

  const client = new OpenAI({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL || undefined,
    defaultHeaders: {
      "Authorization": `Bearer ${settings.apiKey}`,
      "X-OpenRouter-Experimental-Metadata": "1"
    }
  });
  return {
    client,
    model: settings.model,
    baseURL: settings.baseURL,
    thinkingEnabled: settings.thinkingEnabled,
    reasoningEffort: settings.reasoningEffort,
    debugLogEnabled: settings.debugLogEnabled,
    notify: settings.notify,
    webSearchTool: settings.webSearchTool,
    machineId: getMachineId(),
    provider: settings.provider,
    providerPrivacyMode: settings.providerPrivacyMode,
    zdr: settings.zdr,
    dataCollection: settings.dataCollection,
    cacheControl: settings.cacheControl,
    temperature: settings.temperature,
    topP: settings.topP,
    repetitionPenalty: settings.repetitionPenalty,
    nativeLlamaCpp: settings.nativeLlamaCpp
  };
}

function getMachineId(): string | undefined {
  try {
    const idPath = path.join(os.homedir(), ".sbdt", "machine-id");
    if (fs.existsSync(idPath)) {
      const raw = fs.readFileSync(idPath, "utf8").trim();
      if (raw) {
        return raw;
      }
    }
    const generated = `${os.hostname()}-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    fs.mkdirSync(path.dirname(idPath), { recursive: true });
    fs.writeFileSync(idPath, generated, "utf8");
    return generated;
  } catch {
    return undefined;
  }
}
