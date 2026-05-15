# Deep Code CLI

Deep Code CLI is a terminal AI coding agent any OpenAI-compatible endpoints
Focused on company-code usage: correct tool/cache replay, sensitive-value redaction before the final HTTP payload reaches the provider, and transparent multi-provider settings.

## Security Model

The internal session state stays raw so tool calls, tool results, and prompt-cache replay keep working across requests.
When `PROVIDER_PRIVACY` is set to `strict`, the CLI clones the final provider request body and redacts that clone immediately before it is sent upstream.
It does not replace normal company security controls. Still avoid pasting real production secrets, rotate exposed keys, use provider ZDR when available, keep fallback routing disabled for sensitive work, and review final-boundary logs during hardening.

## Privacy Controls

### Final Request Sanitization

Strict provider privacy mode sanitizes only the outbound provider request body.
It does not write redacted text back into session history, cache state, or tool results.

The sanitizer redacts:

- Password-like phrases
- JWTs
- PEM private keys
- Known API key formats (OpenRouter, OpenAI, GitHub, AWS)
- Unknown high-entropy secret-looking tokens
- Secret-looking values near keys such as `password`, `secret`, `token`, `api_key`, `private_key`

The strict sanitizer preserves file paths, tool call IDs, tool result structure, and ordinary code context so cached tool workflows replay correctly.

### Tool Output Protection

Tool results are stored raw inside the local session.
With `PROVIDER_PRIVACY: "strict"`, sensitive values inside those tool results are redacted in the final provider-bound request clone before the model sees them.

### Sensitive File Reads

Obvious secret-bearing files are refused by default: `.env`, `.npmrc`, `.pypirc`, private keys, certificate/key stores, kube configs, Docker configs, cloud credentials, and service-account JSON files.

To explicitly allow sensitive reads:

```powershell
$env:DEEPCODE_ALLOW_SENSITIVE_READS="true"
node dist/cli.js
```

## Configuration

Create or edit `~/.deepcode/settings.json`.

### All settings keys

**Inside `env`** (uppercase, mirror environment variables):

| Key | Type | Description |
|-----|------|-------------|
| `MODEL` | string | Model ID, e.g. `qwen/qwen3.6-max-preview` |
| `BASE_URL` | string | API base URL |
| `API_KEY` | string | Provider API key |
| `THINKING` | `"enabled"` | Enable thinking/reasoning mode (alternative to top-level `thinkingEnabled`) |
| `PROVIDER` | string | Pin a specific OpenRouter provider, e.g. `"siliconflow"` (OpenRouter only) |
| `PROVIDER_PRIVACY` | `"off"` \| `"strict"` | Redact secrets from outbound request body |
| `ZDR` | `"true"` | Enable Zero Data Retention (OpenRouter only) |
| `DATA_COLLECTION` | `"allow"` \| `"deny"` | Provider data collection opt-out (OpenRouter only) |

**Top-level** (no `env` equivalent — must be outside `env`):

| Key | Type | Description |
|-----|------|-------------|
| `debugLogEnabled` | boolean | Write full request/response logs to `~/.deepcode/logs/` |
| `reasoningEffort` | `"xhigh"` \| `"high"` \| `"medium"` \| `"low"` \| `"minimal"` \| `"none"` \| `"max"` | Reasoning depth (`"max"` is an alias for `"xhigh"`) |
| `thinkingEnabled` | boolean | Enable thinking mode (alternative to `THINKING` in env) |

> **Note:** `PROVIDER`, `ZDR`, and `DATA_COLLECTION` are OpenRouter-specific. When `BASE_URL` is not `openrouter.ai`, they are silently ignored and never sent to the API. `allow_fallbacks: false` is automatically applied whenever any of `PROVIDER`, `ZDR`, or `DATA_COLLECTION` is set.

### Example settings.json

```json
{
  "env": {
    "MODEL": "gpt6.0 heh",
    "BASE_URL": "https://openrouter.ai/api/v1",
    "API_KEY": "key, huh? not giving that sh1t",
    "THINKING": "enabled",
    "PROVIDER_PRIVACY": "strict",
    "ZDR": "true",
    "DATA_COLLECTION": "deny"
  },
  "debugLogEnabled": false,
  "reasoningEffort": "medium"
}
```
## Logs

```text
~/.deepcode/logs/error.log      — API errors (last 20 entries)
~/.deepcode/logs/warn.log       — Duplicate tool_call_id warnings (last 100 entries)
~/.deepcode/logs/final-http-body.jsonl — Full outbound request bodies (when debugLogEnabled)
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` | Insert newline |
| `Ctrl+V` | Paste image from clipboard |
| `Esc` | Interrupt current response |
| `/` | Open command menu |
| `/new` | Start a new session |
| `/resume` | Resume a previous session |
| `/skills` | List available skills |
| `/exit` | Exit |
| `Ctrl+D` twice | Exit |

## Important Notes

- `PROVIDER_PRIVACY: "strict"` redacts the final provider request clone only — local session history is never mutated.
- ZDR helps with provider-side retention but does not replace local redaction.
- Provider fallback is automatically disabled when `PROVIDER`, `ZDR`, or `DATA_COLLECTION` is set.
- Secret detection is regex and entropy based — strong but not perfect.
- The model still receives sanitized proprietary code and context.
- Review boundary logs while hardening, then set `debugLogEnabled: false`.

## License

MIT
