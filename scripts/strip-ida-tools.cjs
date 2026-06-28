const fs = require('fs');
let c = fs.readFileSync('src/prompt.ts', 'utf8');

// Find the IDA tools block — it starts with "// ── IDA Pro reverse engineering tools"
// and ends before "return tools;"
const startMarker = '\n  // ── IDA Pro reverse engineering tools ───────────────────────────────────';
const endMarker = '\n\n  return tools;';

let start = c.indexOf(startMarker);
let end = c.indexOf(endMarker);

if (start !== -1 && end !== -1) {
  // Replace the entire IDA block + the return with just the return, keeping the dynamic injection
  const before = c.substring(0, start);
  const after = c.substring(end + endMarker.length);
  
  // Add dynamic IDA tool injection before return
  const dynamicBlock = `
  // ── IDA Pro MCP tools (dynamically discovered) ──────────────────────────
  if (options.idaMcpEnabled) {
    const idaTools = options.idaMcpTools ?? [];
    for (const tool of idaTools) {
      tools.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description ?? "",
          parameters: tool.inputSchema ?? { type: "object", properties: {}, additionalProperties: false },
        },
      });
    }
  }`;
  
  c = before + dynamicBlock + '\n\n  return tools;' + after.substring('return tools;'.length);
  console.log('Replaced IDA tools block with dynamic injection');
} else {
  console.log('Markers not found, start:', start, 'end:', end);
}

fs.writeFileSync('src/prompt.ts', c);
