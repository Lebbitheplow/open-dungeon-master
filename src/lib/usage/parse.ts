// What each backend says a call cost, read into one shape. Pure string and
// number work so scripts/test-shared-host.mjs can drive it; the transports
// (src/lib/model-client.ts, src/lib/openai-responses.ts) call these on the
// bodies and stream events they already parse.

export type TokenUsage = { inputTokens: number; outputTokens: number };

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;

// Chat Completions: `usage.prompt_tokens` / `usage.completion_tokens` on the
// reply, or on the last stream chunk when stream_options.include_usage was
// sent (OpenAI, llama-server, vLLM, LM Studio, OpenRouter all do).
export function chatUsage(record: unknown): TokenUsage | null {
  const usage = (record as { usage?: unknown } | null)?.usage as
    | { prompt_tokens?: unknown; completion_tokens?: unknown }
    | null
    | undefined;
  if (!usage || typeof usage !== "object") {
    return null;
  }
  const inputTokens = count(usage.prompt_tokens);
  const outputTokens = count(usage.completion_tokens);
  return inputTokens || outputTokens ? { inputTokens, outputTokens } : null;
}

// The Responses API: `response.usage.input_tokens` / `output_tokens` on the
// completed (or incomplete) response object.
export function responsesUsage(response: unknown): TokenUsage | null {
  const usage = (response as { usage?: unknown } | null)?.usage as
    | { input_tokens?: unknown; output_tokens?: unknown }
    | null
    | undefined;
  if (!usage || typeof usage !== "object") {
    return null;
  }
  const inputTokens = count(usage.input_tokens);
  const outputTokens = count(usage.output_tokens);
  return inputTokens || outputTokens ? { inputTokens, outputTokens } : null;
}

// Ollama's /api/chat: `prompt_eval_count` and `eval_count` ride on the final
// object (the one with done: true) and on a non-streamed reply.
export function ollamaUsage(record: unknown): TokenUsage | null {
  const row = record as { prompt_eval_count?: unknown; eval_count?: unknown } | null;
  if (!row || typeof row !== "object") {
    return null;
  }
  const inputTokens = count(row.prompt_eval_count);
  const outputTokens = count(row.eval_count);
  return inputTokens || outputTokens ? { inputTokens, outputTokens } : null;
}
