const fs = require('fs');
let c = fs.readFileSync('src/session.ts', 'utf8');

// Add import for ida-handler
const importLine = "import { ToolExecutor, type CreateOpenAIClient } from \"./tools/executor\";";
const newImport = "import { ToolExecutor, type CreateOpenAIClient } from \"./tools/executor\";\nimport { startIdaMcp, getDiscoveredIdaTools } from \"./tools/ida-handler\";";
c = c.replace(importLine, newImport);

// Update getPromptToolOptions to include idaMcpTools
// Current: "idaMcpEnabled: this.getResolvedSettings().idaMcpUrl ? true : false,"
// Need to add idaMcpTools
c = c.replace(
  "idaMcpEnabled: this.getResolvedSettings().idaMcpUrl ? true : false,",
  "idaMcpEnabled: this.getResolvedSettings().idaMcpUrl ? true : false,\n      idaMcpTools: getDiscoveredIdaTools(),"
);

// Add startIdaMcp call in the constructor or somewhere appropriate
// Find constructor body end and add a call
const constructorEnd = "this.toolExecutor = new ToolExecutor(this.projectRoot, this.createOpenAIClient);";
c = c.replace(
  constructorEnd,
  constructorEnd + "\n    void this.warmIdaMcp();"
);

// Add warmIdaMcp method after getPromptToolOptions
const methodEnd = "private reportNewPrompt(): void {";
const warmMethod = `private warmIdaMcp(): void {
    const settings = this.getResolvedSettings();
    if (settings.idaMcpUrl) {
      startIdaMcp().then(() => {
        // Tools discovered — next prompt will include them
      }).catch(() => {
        // IDA not available — tools won't be registered
      });
    }
  }

  private reportNewPrompt(): void {`;
c = c.replace(methodEnd, warmMethod);

fs.writeFileSync('src/session.ts', c);
console.log('ok');
