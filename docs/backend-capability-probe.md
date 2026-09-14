# OpenAI-compatible backend capability probe

A `/models` response or a successful plain chat completion does not prove that a backend can run Open Dungeon Master's DM loop. ODM depends on streaming and structured function/tool calls, including a continuation after the tool result is returned.

Run the probe before assigning a new backend/model to a campaign:

```bash
node scripts/probe-openai-backend.mjs --url http://127.0.0.1:8001/v1 --model qwen3.6-35b
```

For authenticated servers, pass `--api-key` or set `OPENAI_COMPAT_API_KEY`. `OPENAI_COMPAT_BASE_URL` and `OPENAI_COMPAT_MODEL` are also accepted as defaults. Add `--json` for machine-readable output.

The probe performs three checks against the actual `/chat/completions` endpoint:

1. a streamed text response is received and parsed;
2. the model emits a real `probe_echo` function call with exact JSON arguments (`word: "куб"`, `n: 7`) rather than merely mentioning the tool in prose;
3. after ODM-style tool output is appended to the conversation, the model produces a continuation.

The command exits non-zero if any required stage fails. Authenticated redirects are deliberately not followed, so an API key is not forwarded to a different location by an HTTP redirect.

This is a compatibility diagnostic only. It does not change global or campaign settings.
