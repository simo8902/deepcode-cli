# Deep Code CLI

The system prompt in this codebase is heavily modified, please rewrite before use!

Deep Code CLI is a heavily modified terminal AI coding agent for running DeepSeek and other OpenAI-compatible models.
This fork is focused on company-code usage: preserving tool/cache correctness while optionally redacting sensitive values from the final HTTP payload before it reaches a provider.

## Security Model

This CLI is designed to make accidental leakage harder, not impossible.
The internal session state stays raw so tool calls, tool results, and prompt-cache replay keep working across requests.
When `providerPrivacyMode` is set to `strict`, the CLI clones the final provider request body and redacts that clone immediately before it is sent upstream.
It does not replace normal company security controls. You should still avoid pasting real production secrets, rotate exposed keys, use provider ZDR when available, keep fallback routing disabled for sensitive work, and review final-boundary logs during hardening.

## Privacy Controls

### Final Request Sanitization

Strict provider privacy mode sanitizes only the outbound provider request body.
It does not write redacted text back into session history, cache state, or tool results.

The sanitizer redacts:

- Password-like phrases.
- JWTs.
- PEM private keys.
- Known API key formats.
- GitHub tokens.
- AWS access keys.
- Unknown high-entropy secret-looking tokens.
- Secret-looking values near keys such as `password`, `secret`, `token`, `api_key`, and `private_key`.

The strict sanitizer preserves file paths, tool call IDs, tool result structure, and ordinary code context so cached tool workflows can still replay correctly.

### Tool Output Protection

Tool results are stored raw inside the local session.
With `providerPrivacyMode: "strict"`, sensitive values inside those tool results are redacted in the final provider-bound request clone before the model sees them.

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
    "API_KEY": "sk-or-v1-REDACTED",
    "PROVIDER": "siliconflow",
    "ZDR": "true"
  },
  "providerPrivacyMode": "strict",
  "debugLogEnabled": true,
  "thinkingEnabled": true,
  "reasoningEffort": "max"
}
```

`providerPrivacyMode` defaults to `off`.
Use `strict` when the final provider payload must be scrubbed before it leaves the CLI.

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

- `providerPrivacyMode: "strict"` redacts the final provider request clone. It does not mutate local session history.
- ZDR helps with provider retention, but it does not replace local redaction.
- Provider fallback should stay disabled for company-code use.
- Secret detection is regex and entropy based; it is strong but not perfect.
- The model can still receive sanitized proprietary code and context.
- Review boundary logs while hardening, then disable them.

## License

MIT
