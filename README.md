# Deep Code CLI

The system prompt in this codebase is heavily modified, please rewrite before use!

Deep Code CLI is a heavily modified terminal AI coding agent for running DeepSeek and other OpenAI-compatible models through a stricter privacy layer.
This fork is focused on company-code usage: reducing accidental leaks, sanitizing the final HTTP payload before it reaches a provider, and keeping provider routing explicit.

## Security Model

This CLI is designed to make accidental leakage harder, not impossible
It protects the model request pipeline by scanning and sanitizing the JSON body that is actually sent upstream. That includes user messages, system messages, assistant reasoning fields, tool messages, and nested request fields
It does not replace normal company security controls. You should still avoid pasting real production secrets, use provider ZDR when available, keep fallback routing disabled, and review final-boundary logs during hardening

## Privacy Controls

### Final Request Sanitization

Before any request is sent to the model provider, the CLI builds a sanitized outbound request body.

The sanitizer redacts:

- Password-like phrases.
- JWTs.
- PEM private keys.
- Known API key formats.
- GitHub tokens.
- AWS access keys.
- Unknown high-entropy secret-looking tokens.
- Absolute local paths in model-replayed content.

High-risk secrets are blocked before send. Generic test credentials are redacted instead of failing the session.

### Tool Output Protection

Tool results are scanned before they become `tool` messages. If a tool output contains high-risk secret material, the CLI blocks automatic continuation and inserts a local warning instead of sending the raw result to the model.

### Sensitive File Reads

Obvious secret-bearing files are refused by default, including `.env`, `.npmrc`, `.pypirc`, private keys, certificate/key stores, kube configs, Docker configs, cloud credentials, and service-account JSON files.

## Configuration

Create or edit:

```text
~/.deepcode/settings.json
```

Example OpenRouter + DeepSeek configuration:

```json
{
  "env": {
    "MODEL": "deepseek/deepseek-v4-pro",
    "BASE_URL": "https://openrouter.ai/api/v1",
    "API_KEY": "sk-or-...",
    "PROVIDER": "siliconflow",
    "ZDR": "true"
  },
  "debugLogEnabled": true,
  "thinkingEnabled": true,
  "reasoningEffort": "max"
}
```

To explicitly allow sensitive reads:

```powershell
$env:DEEPCODE_ALLOW_SENSITIVE_READS="true"
node dist/cli.js
```

Logs are written to:

```text
%USERPROFILE%\.deepcode\logs\final-http-body.jsonl
```

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `Enter` | Send message |
| `Shift+Enter` | Insert newline |
| `Ctrl+V` | Paste image from clipboard where supported |
| `Esc` | Interrupt current response |
| `/` | Open command menu |
| `/new` | Start a new session |
| `/resume` | Resume a previous session |
| `/skills` | List available skills |
| `/exit` | Exit |
| `Ctrl+D` twice | Exit |


## Important Notes

- ZDR helps with provider retention, but it does not replace local redaction and blocking.
- Provider fallback should stay disabled for company-code use.
- Secret detection is regex and entropy based; it is strong but not perfect.
- The model can still receive sanitized proprietary code and context.
- Review boundary logs while hardening, then disable them.

## License

MIT
