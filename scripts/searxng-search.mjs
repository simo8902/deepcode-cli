#!/usr/bin/env node
// SearXNG web search script for sbdt WebSearch tool
// Usage: node searxng-search.mjs "search query"
// Env vars:
//   SEARXNG_BASE_URL - your SearXNG instance (default: http://localhost:8888)
//   FETCH_PAGES=1    - scrape full text of top 3 result pages

const SEARXNG_BASE = process.env.SEARXNG_BASE_URL || "http://localhost:8888";
const SEARCH_TIMEOUT_MS = 20_000;
const PAGE_FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT || "6000", 10);
const MAX_RESULTS = 10;
const FETCH_COUNT = process.env.FETCH_PAGES === "1" ? 3 : 0;

// ── Snippet cleaning ───────────────────────────────────────────────────────

const NOISE_PATTERNS = [
  /\b(Ashburn|San Jose|New York|Los Angeles|Chicago|Houston|Phoenix|Philadelphia|San Antonio|San Diego|Dallas|Austin|Jacksonville|Fort Worth|Columbus|Charlotte|Indianapolis|San Francisco|Seattle|Denver|Nashville|Oklahoma City|El Paso|Washington),\s*(VA|DC|TX|CA|FL|IL|AZ|PA|WA|CO|TN|OK|NY|OH|NC|IN|NV|GA|MA|MI|MD|MN|MO|OR|WI)\s+Weather\s+Today[\s\S]*?(?=\bWeather\b|$)/gi,
  /WinterCast\s+Local\s+\{stormName\}\s+Tracker[\s\S]*?(?=\b\d{1,2}-Day\b|$)/gi,
  /Hourly\s+10-Day\s+Radar\s+MinuteCast®\s+Monthly[\s\S]*?(?=\b\d{1,2}-\b|$)/gi,
];

function cleanSnippet(text) {
  if (!text) return "";
  let cleaned = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  for (const pattern of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "").replace(/\s+/g, " ").trim();
  }
  return cleaned;
}

// ── Page content fetching ──────────────────────────────────────────────────

async function fetchPageContents(results) {
  const contents = [];
  for (let i = 0; i < Math.min(results.length, FETCH_COUNT); i++) {
    try {
      const text = await fetchPageText(results[i].url);
      contents.push(text);
    } catch {
      contents.push(null);
    }
  }
  return contents;
}

async function fetchPageText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
      }
    });
    if (!res.ok) return null;
    const html = await res.text();
    return extractContent(html, url);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractContent(html, url) {
  const parts = [];

  // 1. Open Graph / meta description — always server-rendered
  const ogDesc = match1(html, /<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i);
  if (ogDesc) parts.push(he.decode(ogDesc));

  // 2. Meta description fallback
  if (!ogDesc) {
    const metaDesc = match1(html, /<meta[^>]+name="description"[^>]+content="([^"]+)"/i);
    if (metaDesc) parts.push(he.decode(metaDesc));
  }

  // 3. Title
  const title = match1(html, /<title>([\s\S]*?)<\/title>/i);
  if (title) parts.push("Page title: " + he.decode(title.trim()));

  // 4. JSON-LD structured data — weather temps live here
  const jsonldMatches = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (jsonldMatches) {
    for (const match of jsonldMatches) {
      try {
        const inner = match1(match, /<script[^>]*>([\s\S]*?)<\/script>/i);
        if (inner) {
          const parsed = JSON.parse(inner);
          const flat = flattenJsonLD(parsed);
          if (flat) parts.push(flat);
        }
      } catch { /* ignore */ }
    }
  }

  // 5. If metadata is rich enough, skip body parsing
  const metaText = parts.join(" | ");
  if (metaText.length > 200) {
    return metaText.slice(0, 4000);
  }

  // 6. Fallback: extract body text from main content areas
  let bodyHtml = html;
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
    || html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    || html.match(/<div[^>]*role="main"[^>]*>([\s\S]*?)<\/div>/i);
  if (mainMatch) bodyHtml = mainMatch[1];

  const text = stripHtml(bodyHtml);
  if (text.length > 50) {
    return (metaText ? metaText + " | " : "") + text.slice(0, 3000);
  }

  return metaText || null;
}

function flattenJsonLD(obj, depth = 0) {
  if (depth > 5) return null;
  if (!obj || typeof obj !== "object") return null;

  const parts = [];
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const f = flattenJsonLD(item, depth + 1);
      if (f) parts.push(f);
    }
    return parts.join(" | ") || null;
  }

  const type = obj["@type"];
  const name = obj.name;
  const desc = obj.description;

  if (type === "WeatherForecast" || obj.temperature) {
    const temp = obj.temperature ? (typeof obj.temperature === "object" ? obj.temperature.value + "°" + (obj.temperature.unit || "") : obj.temperature) : "";
    const cond = obj.weatherCondition || obj.condition || "";
    const wdesc = obj.description || desc || "";
    return [name, temp, cond, wdesc].filter(Boolean).join(" · ") || null;
  }

  const kv = [];
  if (name) kv.push(name);
  if (desc) kv.push(desc);
  for (const key of ["temperature", "price", "datePublished", "author", "headline"]) {
    if (obj[key] != null) kv.push(key + ": " + (typeof obj[key] === "object" ? JSON.stringify(obj[key]) : obj[key]));
  }
  return kv.join(" · ") || null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function match1(str, regex) {
  const m = str.match(regex);
  return m ? m[1] : null;
}

function stripHtml(html) {
  return he.decode(
    html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

const he = {
  decode(str) {
    return str
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, "/")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
};

// ── Main ───────────────────────────────────────────────────────────────────

const query = process.argv[2];
if (!query?.trim()) {
  console.error("Usage: searxng-search.mjs <query>");
  process.exit(1);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

const formBody = new URLSearchParams({ q: query.trim(), format: "json" }).toString();

try {
  const response = await fetch(`${SEARXNG_BASE}/search`, {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Accept": "text/html,application/json",
      "Accept-Encoding": "gzip, deflate",
      "Accept-Language": "en-US,en;q=0.9",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "sbdt/1.0 (AI-coding-tool; searxng-search)",
      "X-Forwarded-For": "127.0.0.1"
    },
    body: formBody
  });

  if (!response.ok) {
    console.error(`Search failed: HTTP ${response.status}`);
    process.exit(1);
  }

  const data = await response.json();
  const results = (data.results || []).slice(0, MAX_RESULTS);

  if (results.length === 0) {
    console.log(`No results found for "${query}".`);
    process.exit(0);
  }

  const pageContents = FETCH_COUNT > 0
    ? await fetchPageContents(results)
    : [];

  console.log(`Web search results (via SearXNG):`);
  console.log();

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const fetched = pageContents[i];

    console.log(`${i + 1}. ${r.title || "Untitled"}`);
    console.log(`   URL: ${r.url || "(no url)"}`);

    if (fetched) {
      console.log(`   ${cleanSnippet(fetched)}`);
    } else if (r.content) {
      console.log(`   ${cleanSnippet(r.content)}`);
    }
    console.log();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("aborted") || message.includes("timeout")) {
    console.error("Search request timed out.");
  } else {
    console.error(`Search error: ${message}`);
  }
  process.exit(1);
} finally {
  clearTimeout(timeout);
}
