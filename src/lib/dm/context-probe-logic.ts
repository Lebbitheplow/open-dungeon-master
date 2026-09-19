// Reading a context window out of an OpenAI-compatible endpoint's /props.
//
// Split out of model-client.ts so it can be tested directly: the shape of
// this response is the fragile part, it varies by llama.cpp version and by
// whether the server is running as a single model or as a --models-preset
// router, and getting it wrong fails silently as an under-budgeted prompt
// rather than as an error.
//
// Dependency-free so scripts/test-context-probe.mjs can import it directly.

export function normalizeBaseUrl(baseUrl: string): string {
  return (baseUrl ?? "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

// A --models-preset router serves several models from one port, each launched
// with its own -c. Without the model query it answers for the ROUTER, which
// reports n_ctx 0 and model "none": indistinguishable from a miss, and it
// would quietly drop the budget to the conservative default.
export function buildPropsUrl(baseUrl: string, model: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) {
    return "";
  }
  return model ? `${base}/props?model=${encodeURIComponent(model)}` : `${base}/props`;
}

export type PropsShape = {
  n_ctx?: unknown;
  default_generation_settings?: { n_ctx?: unknown } | null;
};

// Newer llama.cpp exposes n_ctx at the top level; older builds and the router
// nest it under default_generation_settings. Zero means "the server did not
// really answer for a model", so it is treated as absent rather than as a
// context window of zero.
export function readContextWindow(props: PropsShape | null | undefined): number | null {
  if (!props || typeof props !== "object") {
    return null;
  }
  const candidates = [props.n_ctx, props.default_generation_settings?.n_ctx];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
  }
  return null;
}

// OpenAI reports no window on any endpoint, and an app-hosted world has no
// environment file to set OPENAI_COMPAT_CONTEXT in, so a table on its own
// key would otherwise pack against the 16K stand-in forever. Every chat model
// OpenAI still sells has at least 128K of room; the newer lines have far
// more, but the prompt is billed by the token on this backend, so the floor
// they all share is also the ceiling worth paying for. Only the retired
// small-window models are named, which keeps a model this table has never
// heard of on the safe number instead of a guess.
export const OPENAI_CONTEXT_TOKENS = 128_000;

const OPENAI_SMALL_WINDOWS: Array<[RegExp, number]> = [
  [/^gpt-3\.5/, 16_385],
  [/^gpt-4-32k/, 32_768],
  [/^gpt-4(-0314|-0613)?$/, 8_192],
];

export function openAiContextWindow(model: string): number {
  // A fine-tune is named ft:<base model>:<org>:<suffix>:<id>.
  const name = (model ?? "").trim().toLowerCase();
  const base = name.startsWith("ft:") ? (name.split(":")[1] ?? "") : name;
  for (const [pattern, window] of OPENAI_SMALL_WINDOWS) {
    if (pattern.test(base)) {
      return window;
    }
  }
  return OPENAI_CONTEXT_TOKENS;
}

export function contextCacheKey(baseUrl: string, model: string): string {
  return `${normalizeBaseUrl(baseUrl)}::${model ?? ""}`;
}
