import { spawn } from "child_process";
import type OpenAI from "openai";
import type { CreateOpenAIClient, ToolExecutionContext, ToolExecutionResult } from "./executor";

const MAX_OUTPUT_CHARS = 30000;
const MAX_CAPTURE_CHARS = 10 * 1024 * 1024;
const WEB_SEARCH_TOOL_ACTIVITY_PREFIX = "WebSearch:";

type SearchLanguage = "en" | "zh";

type SearchDecision = {
  dominantLanguage: SearchLanguage;
  reason: string;
};

type SearchPreparation = {
  resolvedQuery: string;
  decision: SearchDecision;
  translated: boolean;
};

type LLMClientContext = {
  client: OpenAI;
  model: string;
  thinkingEnabled: boolean;
  notify?: string;
  webSearchTool?: string;
  machineId?: string;
};

export async function handleWebSearchTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const query = typeof args.query === "string" ? args.query : "";
  if (!query.trim()) {
    return {
      ok: false,
      name: "WebSearch",
      error: "Missing required \"query\" string."
    };
  }

  const llmContext = context.createOpenAIClient?.();
  const scriptPath = llmContext?.webSearchTool?.trim();
  if (scriptPath) {
    return executeConfiguredWebSearch(query, scriptPath, context);
  }

  // Built-in fallback: HTTP-based search via DuckDuckGo
  return executeBuiltInWebSearch(query, context);
}

function hasUsableClient(value: ReturnType<CreateOpenAIClient> | undefined): value is LLMClientContext {
  return Boolean(value?.client);
}

// ── Built-in web search (DuckDuckGo HTML scraping) ────────────────────────

const BUILT_IN_SEARCH_TIMEOUT_MS = 15_000;
const MAX_RESULTS = 10;

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

async function executeBuiltInWebSearch(
  query: string,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BUILT_IN_SEARCH_TIMEOUT_MS);

  try {
    const url = buildDuckDuckGoSearchUrl(query);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "text/html",
        "User-Agent": "sbdt/1.0 (AI-coding-tool; web-search)"
      }
    });

    if (!response.ok) {
      return {
        ok: false,
        name: "WebSearch",
        error: `Search request failed with HTTP ${response.status}`,
        metadata: { status: response.status }
      };
    }

    const html = await response.text();
    const results = parseDuckDuckGoHtml(html).slice(0, MAX_RESULTS);

    if (results.length === 0) {
      return {
        ok: false,
        name: "WebSearch",
        error: "No results found. The search engine may have blocked the request or returned no matches."
      };
    }

    const output = formatSearchResults(results, query);
    const truncated = output.length > MAX_OUTPUT_CHARS;
    return {
      ok: true,
      name: "WebSearch",
      output: output.slice(0, MAX_OUTPUT_CHARS),
      metadata: {
        resultCount: results.length,
        truncated
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("aborted") || message.includes("timeout")) {
      return {
        ok: false,
        name: "WebSearch",
        error: "Search request timed out."
      };
    }
    return {
      ok: false,
      name: "WebSearch",
      error: `Built-in search failed: ${message}. Configure \"webSearchTool\" in ~/.sbdt/settings.json for custom search.`
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildDuckDuckGoSearchUrl(query: string): string {
  // Use the HTML-only endpoint — easiest to parse, least likely to need JS
  const params = new URLSearchParams({ q: query, kl: "us-en" });
  return `https://html.duckduckgo.com/html/?${params.toString()}`;
}

function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo HTML results are in <div class="result"> blocks.
  // Each contains an <a class="result__a"> for title/url and
  // <a class="result__snippet"> for the snippet.
  const resultBlockRegex = /<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<\/div>\s*(?=<div[^>]*class="[^"]*result|"nav-link"|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = resultBlockRegex.exec(html)) !== null) {
    const block = match[0];

    // Extract link: <a ... class="result__a" href="...">title</a>
    const linkMatch = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!linkMatch) continue;

    const rawUrl = linkMatch[1];
    const title = stripHtml(linkMatch[2]).trim();

    // DuckDuckGo wraps external URLs via a redirect; extract the real URL
    const url = extractRealUrl(rawUrl) || rawUrl;

    // Extract snippet
    const snippetMatch = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]).trim() : "";

    if (!title || !url) continue;
    results.push({ title, url, snippet });
  }

  // Fallback: try simpler regex if structured parsing yielded nothing
  if (results.length === 0) {
    return parseDuckDuckGoHtmlFallback(html);
  }

  return results;
}

function parseDuckDuckGoHtmlFallback(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  // Find all links with class containing "result"
  const linkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

  const links: Array<{ url: string; title: string }> = [];
  const snippets: string[] = [];

  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(html)) !== null) {
    const rawUrl = m[1];
    const title = stripHtml(m[2]).trim();
    const url = extractRealUrl(rawUrl) || rawUrl;
    if (title && url) links.push({ url, title });
  }

  while ((m = snippetRegex.exec(html)) !== null) {
    snippets.push(stripHtml(m[1]).trim());
  }

  for (let i = 0; i < Math.min(links.length, snippets.length); i++) {
    results.push({ ...links[i], snippet: snippets[i] });
  }

  return results;
}

function extractRealUrl(rawUrl: string): string | null {
  // DuckDuckGo redirect URLs look like: //duckduckgo.com/l/?uddg=...&rut=...
  try {
    const decoded = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
    const parsed = new URL(decoded);
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) {
      return decodeURIComponent(uddg);
    }
    // If it's a direct URL (not a redirect), return as-is
    if (parsed.hostname && !parsed.hostname.includes("duckduckgo.com")) {
      return decoded;
    }
  } catch {
    // not a valid URL, ignore
  }
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&nbsp;/g, " ");
}

function formatSearchResults(results: SearchResult[], _query: string): string {
  if (results.length === 0) {
    return `No results found.`;
  }

  const lines: string[] = [`Web search results:`, ""];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   URL: ${r.url}`);
    if (r.snippet) {
      lines.push(`   ${r.snippet}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ── External script search (existing) ─────────────────────────────────────

async function executeConfiguredWebSearch(
  query: string,
  scriptPath: string,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const execution = await runWebSearchScript(scriptPath, query, context);
  const output = execution.stdout.slice(0, MAX_OUTPUT_CHARS);
  const truncated = execution.stdout.length > MAX_OUTPUT_CHARS;

  if (execution.error) {
    return {
      ok: false,
      name: "WebSearch",
      error: execution.error,
      output: output || undefined,
      metadata: {
        exitCode: execution.exitCode,
        signal: execution.signal,
        stderr: execution.stderr || undefined,
        truncated
      }
    };
  }

  if (execution.exitCode !== 0 || execution.signal !== null) {
    return {
      ok: false,
      name: "WebSearch",
      error: buildCommandError(execution.exitCode, execution.signal),
      output: output || undefined,
      metadata: {
        exitCode: execution.exitCode,
        signal: execution.signal,
        stderr: execution.stderr || undefined,
        truncated
      }
    };
  }

  return {
    ok: true,
    name: "WebSearch",
    output: output || undefined,
    metadata: {
      exitCode: execution.exitCode,
      signal: execution.signal,
      truncated,
      stderr: execution.stderr || undefined
    }
  };
}

async function runWebSearchScript(
  scriptPath: string,
  query: string,
  context: ToolExecutionContext
): Promise<{ stdout: string; stderr: string; exitCode: number | null; signal: string | null; error?: string }> {
  return new Promise((resolve) => {
    // On Windows, .cjs/.js/.mjs files can't be spawned directly (EFTYPE).
    // Detect JS extensions and run through node.
    const isJsScript = /\.(c|m)?js$/i.test(scriptPath);
    const spawnCmd = isJsScript ? "node" : scriptPath;
    const spawnArgs = isJsScript ? [scriptPath, query] : [query];

    const child = spawn(spawnCmd, spawnArgs, {
      cwd: context.projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const pid = child.pid;
    if (typeof pid === "number") {
      context.onProcessStart?.(pid, formatWebSearchActivityLabel(query));
    }

    let stdout = "";
    let stderr = "";
    let error: string | undefined;

    child.stdout?.on("data", (chunk: string | Buffer) => {
      stdout = appendChunk(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderr = appendChunk(stderr, chunk);
    });

    child.on("error", (spawnError) => {
      error = spawnError.message;
    });

    child.on("close", (code, signal) => {
      if (typeof pid === "number") {
        context.onProcessExit?.(pid);
      }
      resolve({
        stdout,
        stderr,
        exitCode: typeof code === "number" ? code : null,
        signal: signal ?? null,
        error
      });
    });
  });
}

async function prepareSearchQuery(query: string, llmContext: LLMClientContext): Promise<SearchPreparation> {
  const decision = await decideSearchLanguage(query, llmContext);
  const containsChinese = containsChineseChar(query);

  if (decision.dominantLanguage === "en" && containsChinese) {
    const translatedQuery = await translateQuery(query, "English", llmContext);
    if (translatedQuery) {
      return { resolvedQuery: translatedQuery, decision, translated: true };
    }
  }

  if (decision.dominantLanguage === "zh" && !containsChinese) {
    const translatedQuery = await translateQuery(query, "Chinese", llmContext);
    if (translatedQuery) {
      return { resolvedQuery: translatedQuery, decision, translated: true };
    }
  }

  return { resolvedQuery: query, decision, translated: false };
}

function containsChineseChar(text: string): boolean {
  return /[一-鿿]/.test(text);
}

async function decideSearchLanguage(
  query: string,
  llmContext: LLMClientContext
): Promise<SearchDecision> {
  const prompt = `Decide whether the topic below has more useful online material in English or Chinese.

Topic:
\`\`\`text
${query}
\`\`\`

Return strict JSON:
{"dominant_language":"en"|"zh","reason":"one short sentence"}
Do not include markdown or any extra text.`;

  const result = parseJsonResponse(await chat(llmContext, prompt));
  const dominantLanguage = result.dominant_language;

  if (dominantLanguage !== "en" && dominantLanguage !== "zh") {
    throw new Error(`Unexpected dominant language: ${String(dominantLanguage)}`);
  }

  return {
    dominantLanguage,
    reason: typeof result.reason === "string" ? result.reason : ""
  };
}

async function translateQuery(
  query: string,
  targetLanguage: "English" | "Chinese",
  llmContext: LLMClientContext
): Promise<string> {
  const prompt = `Translate the query text below into ${targetLanguage}.

Requirements:
- Preserve product names, library names, API names, versions, and abbreviations when appropriate.
- Return only the translated query, without quotes or explanation.

Query:
\`\`\`text
${query}
\`\`\``;

  return stripCodeFence(await chat(llmContext, prompt)).trim().replace(/^['"]|['"]$/g, "");
}

async function chat(llmContext: LLMClientContext, prompt: string): Promise<string> {
  const response = await llmContext.client.chat.completions.create({
    model: llmContext.model,
    messages: [{ role: "user", content: prompt }]
  });

  const content = response.choices?.[0]?.message?.content as unknown;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return (content as Array<{ text?: string }>)
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("\n")
      .trim();
  }
  return "";
}

function parseJsonResponse(text: string): Record<string, unknown> {
  const cleaned = stripCodeFence(text).trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    }
    throw new Error(`Failed to parse JSON response: ${cleaned || "<empty>"}`);
  }
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:[\w-]+)?\n([\s\S]*?)\n```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

function appendChunk(existing: string, chunk: string | Buffer): string {
  if (existing.length >= MAX_CAPTURE_CHARS) {
    return existing;
  }
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  const remaining = MAX_CAPTURE_CHARS - existing.length;
  return `${existing}${text.slice(0, remaining)}`;
}

function formatWebSearchActivityLabel(query: string): string {
  const normalizedQuery = query.replace(/\s+/g, " ").trim();
  const maxQueryLength = 180;
  const clippedQuery =
    normalizedQuery.length > maxQueryLength
      ? `${normalizedQuery.slice(0, maxQueryLength - 3)}...`
      : normalizedQuery;
  return `${WEB_SEARCH_TOOL_ACTIVITY_PREFIX} ${clippedQuery}`;
}

function buildCommandError(exitCode: number | null, signal: string | null): string {
  if (signal) {
    return `WebSearch command terminated by signal ${signal}.`;
  }
  if (exitCode !== null) {
    return `WebSearch command failed with exit code ${exitCode}.`;
  }
  return "WebSearch command failed.";
}
