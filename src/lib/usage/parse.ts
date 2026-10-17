// What each backend says a call cost, read into one shape. Pure string and
// number work so scripts/test-shared-host.mjs can drive it; the transports
// (src/lib/model-client.ts, src/lib/openai-responses.ts) call these on the
// bodies and stream events they already parse.
//
// Input and output are what every backend reports. The rest is reported by
// some backends only, so a field a backend did not send stays undefined
// (unknown), never 0: a cache that missed and a backend that does not say
// are different facts (docs/agent-context-efficiency-audit-2026-10-17.md F09).
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  // Input tokens the backend served from its prompt cache.
  cachedInputTokens?: number;
  // Input tokens written to a provider's cache, where it charges for that.
  cacheWriteTokens?: number;
  // Output tokens spent reasoning, inside outputTokens.
  reasoningTokens?: number;
  // How long the backend says it spent reading the prompt and writing the
  // reply, and loading the model first (Ollama).
  promptMs?: number;
  generateMs?: number;
  loadMs?: number;
};

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;

// A reported figure, or undefined when the backend did not send one.
const known = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

// Only the fields that were reported, so a spread never writes undefined
// over a figure another part of the reply carried.
function defined(fields: Partial<TokenUsage>): Partial<TokenUsage> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<TokenUsage>;
}

// llama-server's `timings` on the last chunk: cache_n is the prompt it
// reused from its cache, prompt_ms and predicted_ms the two phases.
function llamaTimings(row: Record<string, unknown> | null): Partial<TokenUsage> {
  const timings = record(row?.timings);
  if (!timings) {
    return {};
  }
  return defined({
    cachedInputTokens: known(timings.cache_n),
    promptMs: known(timings.prompt_ms),
    generateMs: known(timings.predicted_ms),
  });
}

// Chat Completions: `usage.prompt_tokens` / `usage.completion_tokens` on the
// reply, or on the last stream chunk when stream_options.include_usage was
// sent (OpenAI, llama-server, vLLM, LM Studio, OpenRouter all do). Cached
// input is `prompt_tokens_details.cached_tokens` (OpenAI, OpenRouter, newer
// llama-server), `prompt_cache_hit_tokens` (DeepSeek) or
// `cache_read_input_tokens` (Anthropic's compatible endpoint).
export function chatUsage(row: unknown): TokenUsage | null {
  const top = record(row);
  const usage = record(top?.usage);
  if (!usage) {
    return null;
  }
  const inputTokens = count(usage.prompt_tokens);
  const outputTokens = count(usage.completion_tokens);
  if (!inputTokens && !outputTokens) {
    return null;
  }
  const promptDetails = record(usage.prompt_tokens_details);
  const completionDetails = record(usage.completion_tokens_details);
  return {
    inputTokens,
    outputTokens,
    ...llamaTimings(top),
    ...defined({
      cachedInputTokens:
        known(promptDetails?.cached_tokens) ?? known(usage.prompt_cache_hit_tokens) ?? known(usage.cache_read_input_tokens),
      cacheWriteTokens: known(usage.cache_creation_input_tokens) ?? known(promptDetails?.cache_write_tokens),
      reasoningTokens: known(completionDetails?.reasoning_tokens),
    }),
  };
}

// llama-server sends its timings on the last chunk, which may not be the
// chunk that carries the usage. Read on every chunk and merged.
export function chatTimings(row: unknown): Partial<TokenUsage> {
  return llamaTimings(record(row));
}

// The Responses API: `response.usage.input_tokens` / `output_tokens` on the
// completed (or incomplete) response object, with the cached input and the
// reasoning in their details.
export function responsesUsage(response: unknown): TokenUsage | null {
  const usage = record(record(response)?.usage);
  if (!usage) {
    return null;
  }
  const inputTokens = count(usage.input_tokens);
  const outputTokens = count(usage.output_tokens);
  if (!inputTokens && !outputTokens) {
    return null;
  }
  return {
    inputTokens,
    outputTokens,
    ...defined({
      cachedInputTokens: known(record(usage.input_tokens_details)?.cached_tokens),
      reasoningTokens: known(record(usage.output_tokens_details)?.reasoning_tokens),
    }),
  };
}

const nsToMs = (value: unknown): number | undefined => {
  const ns = known(value);
  return ns === undefined ? undefined : Math.round(ns / 1_000_000);
};

// Ollama's /api/chat: `prompt_eval_count` and `eval_count` ride on the final
// object (the one with done: true) and on a non-streamed reply, with the
// phases in nanoseconds. Ollama reports no cache figure: a prompt it reused
// shows as a short prompt_eval_count, which is counted as input as it is.
export function ollamaUsage(row: unknown): TokenUsage | null {
  const top = record(row);
  if (!top) {
    return null;
  }
  const inputTokens = count(top.prompt_eval_count);
  const outputTokens = count(top.eval_count);
  if (!inputTokens && !outputTokens) {
    return null;
  }
  return {
    inputTokens,
    outputTokens,
    ...defined({
      promptMs: nsToMs(top.prompt_eval_duration),
      generateMs: nsToMs(top.eval_duration),
      loadMs: nsToMs(top.load_duration),
    }),
  };
}
