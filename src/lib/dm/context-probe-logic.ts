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
  chat_template?: unknown;
};

// How the model's chat template is told to think less, from the template
// llama-server reports on /props: "effort" for one that reads
// reasoning_effort and has no thinking switch (gpt-oss's Harmony template,
// which ignores enable_thinking and reasons at "medium" whatever it is
// sent), "switch" for one with enable_thinking (Qwen, Gemma), null when it
// says neither or the server sent no template.
export function readReasoningKnob(props: PropsShape | null | undefined): "effort" | "switch" | null {
  const template = props && typeof props.chat_template === "string" ? props.chat_template : "";
  if (template.includes("enable_thinking")) {
    return "switch";
  }
  return template.includes("reasoning_effort") ? "effort" : null;
}

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

// How many parameters the model behind an OpenAI-compatible endpoint has, from
// its /v1/models listing: llama-server reports meta.n_params for each model it
// has loaded. The entry is the one named (by id or alias), or the only one
// listed when none is named or the name matches none (a single-model server
// answers to any name). Null when the listing says nothing.
export function readModelParams(listing: unknown, model: string): number | null {
  const data = listing && typeof listing === "object" ? (listing as { data?: unknown }).data : null;
  if (!Array.isArray(data)) {
    return null;
  }
  const entries = data.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
  const wanted = (model ?? "").trim().toLowerCase();
  const named = (entry: Record<string, unknown>) =>
    [entry.id, ...(Array.isArray(entry.aliases) ? entry.aliases : [])].some(
      (name) => typeof name === "string" && name.trim().toLowerCase() === wanted,
    );
  const entry = (wanted ? entries.find(named) : null) ?? (entries.length === 1 ? entries[0] : null);
  const meta = entry?.meta && typeof entry.meta === "object" ? (entry.meta as { n_params?: unknown }) : null;
  const count = meta?.n_params;
  return typeof count === "number" && Number.isFinite(count) && count > 0 ? count : null;
}

// The size a model's name states ("qwen3.5-9b", "gemma4:12b-it", "Qwen3-30B-A3B"
// reads 30: the first figure is the whole model), for a server that reports
// none. Not a list of models: the convention every release names its size by.
// Null when the name carries no such figure.
export function paramsFromModelName(model: string): number | null {
  const match = /(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)b(?![a-z0-9])/i.exec(model ?? "");
  const billions = match ? Number.parseFloat(match[1]) : Number.NaN;
  return Number.isFinite(billions) && billions > 0 ? Math.round(billions * 1e9) : null;
}

// OpenAI reports no window on any endpoint. Every chat model it still sells
// has at least 128K of room; the newer lines have far more, but the prompt
// is billed by the token on this backend, so the floor they all share is
// also the ceiling worth paying for. The retired small-window models are
// sized by the model catalog (src/lib/model-registry), not by a table here.
export const OPENAI_CONTEXT_TOKENS = 128_000;

export function contextCacheKey(baseUrl: string, model: string): string {
  return `${normalizeBaseUrl(baseUrl)}::${model ?? ""}`;
}
