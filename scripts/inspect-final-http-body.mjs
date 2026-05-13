#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const logPath = args[0] && !args[0].startsWith("--")
  ? args[0]
  : path.join(os.homedir(), ".deepcode", "logs", "final-http-body.jsonl");
const sessionFilter = readArg("--session");
const needle = readArg("--contains");

if (!fs.existsSync(logPath)) {
  console.error(`Log file not found: ${logPath}`);
  process.exit(1);
}

const entries = fs
  .readFileSync(logPath, "utf8")
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0)
  .map((line, index) => parseLine(line, index + 1))
  .filter(Boolean)
  .filter((entry) => !sessionFilter || entry.sessionId === sessionFilter)
  .filter((entry) => !needle || JSON.stringify(entry).includes(needle));

if (entries.length === 0) {
  console.error("No matching request entries found.");
  process.exit(1);
}

const bySession = new Map();
for (const entry of entries) {
  const list = bySession.get(entry.sessionId) ?? [];
  list.push(entry);
  bySession.set(entry.sessionId, list);
}

for (const [sessionId, sessionEntries] of bySession.entries()) {
  console.log(`\nSession ${sessionId ?? "(none)"}: ${sessionEntries.length} request(s)`);
  let sawCache = false;
  let sawToolReplay = false;
  let previousToolResultCount = 0;

  sessionEntries.forEach((entry, index) => {
    const body = entry.body && typeof entry.body === "object" ? entry.body : {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const cacheOk = JSON.stringify(body.cache_control) === JSON.stringify({ type: "ephemeral", ttl: "1h" });
    sawCache ||= cacheOk;

    const assistantToolCalls = messages
      .filter((message) => message?.role === "assistant" && Array.isArray(message.tool_calls))
      .flatMap((message) => message.tool_calls);
    const toolMessages = messages.filter((message) => message?.role === "tool");
    sawToolReplay ||= index > 0 && toolMessages.length > previousToolResultCount;
    previousToolResultCount = Math.max(previousToolResultCount, toolMessages.length);

    console.log(
      [
        `  #${index + 1}`,
        entry.timestamp ?? "",
        cacheOk ? "cache=OK" : "cache=missing",
        `messages=${messages.length}`,
        `assistant_tool_calls=${assistantToolCalls.length}`,
        `tool_results=${toolMessages.length}`
      ].join(" | ")
    );

    for (const call of assistantToolCalls) {
      const id = call && typeof call === "object" ? call.id : undefined;
      const fn = call?.function && typeof call.function === "object" ? call.function.name : undefined;
      console.log(`      call ${id ?? "(no id)"} -> ${fn ?? "(unknown)"}`);
    }

    for (const toolMessage of toolMessages.slice(-5)) {
      const text = typeof toolMessage.content === "string" ? summarize(toolMessage.content) : "";
      console.log(`      result ${toolMessage.tool_call_id ?? "(no id)"}: ${text}`);
    }
  });

  console.log(`  cache_control: ${sawCache ? "PASS" : "FAIL"}`);
  console.log(`  tool replay across requests: ${sawToolReplay ? "PASS" : "FAIL"}`);
}

function readArg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseLine(line, number) {
  try {
    return JSON.parse(line);
  } catch (error) {
    console.error(`Skipping malformed JSONL line ${number}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function summarize(value) {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}
