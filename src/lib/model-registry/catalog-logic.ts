// The model catalog: what models.dev (https://models.dev/api.json) knows of
// every model each provider serves (ids, context windows, tool calls,
// reasoning, modalities, prices, deprecations), read into one compact shape,
// and the questions ODM asks of it: which row a configured model id is, and
// whether that model can do what the table needs. Pure, no I/O, so
// scripts/test-model-registry.mjs drives every rule; the fetching, caching
// and refresh live in catalog.ts.
//
// Everything that arrives here is data from somewhere else (the network, a
// cache file). It is read field by field into fresh objects: nothing in it
// is ever executed, and an unknown field is dropped.

import { RECOMMENDED_WINDOW, storyWindowVerdict } from "@/lib/story-window";

export type CatalogModel = {
  // The models.dev provider id ("openai", "openrouter", "deepinfra").
  provider: string;
  // The id the provider's API takes.
  id: string;
  name: string;
  family: string;
  // 0 = the catalog does not say.
  contextTokens: number;
  outputTokens: number;
  toolCall: boolean;
  reasoning: boolean;
  structuredOutput: boolean;
  // Modalities: "text", "image", "audio", "video", "pdf".
  input: string[];
  output: string[];
  openWeights: boolean;
  status: "" | "deprecated" | "beta" | "alpha";
  // YYYY-MM-DD, "" when unknown.
  released: string;
  updated: string;
  // USD per million tokens; null for a model not billed per token.
  cost: { input: number; output: number } | null;
};

export type CatalogProvider = {
  id: string;
  name: string;
  // The provider's OpenAI-compatible base URL, where models.dev gives one.
  api: string;
  models: Record<string, CatalogModel>;
};

export type CatalogProviders = Record<string, CatalogProvider>;

export type ModelCatalog = {
  // When the rows were fetched from models.dev (ISO); "" for the bundled
  // snapshot, whose date is in the snapshot itself.
  fetchedAt: string;
  source: "live" | "cache" | "snapshot";
  providers: CatalogProviders;
};

// Ceilings on what is read, so a wrong or hostile answer cannot fill memory.
export const MAX_PROVIDERS = 1_000;
export const MAX_MODELS_PER_PROVIDER = 5_000;
export const MAX_ID_LENGTH = 200;
const MAX_TEXT = 300;

// Keys that would change an object's shape rather than add a row to it.
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const text = (value: unknown, max = MAX_TEXT): string => (typeof value === "string" ? value.trim().slice(0, max) : "");

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

const flag = (value: unknown): boolean => value === true;

const MODALITIES = new Set(["text", "image", "audio", "video", "pdf"]);

function modalities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && MODALITIES.has(entry)).slice(0, 5);
}

function status(value: unknown): CatalogModel["status"] {
  return value === "deprecated" || value === "beta" || value === "alpha" ? value : "";
}

function price(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

// One model, from either shape: models.dev's own (limit.context, tool_call,
// modalities.input) or the compact one this module writes (contextTokens,
// toolCall, input). Null when it is not a model row at all.
export function readCatalogModel(provider: string, id: string, raw: unknown): CatalogModel | null {
  if (!isRecord(raw)) return null;
  const cleanId = text(id, MAX_ID_LENGTH);
  if (!cleanId || UNSAFE_KEYS.has(cleanId)) return null;
  const limit = isRecord(raw.limit) ? raw.limit : {};
  const mods = isRecord(raw.modalities) ? raw.modalities : {};
  const cost = isRecord(raw.cost) ? raw.cost : null;
  const costIn = cost ? price(cost.input ?? cost.i) : null;
  const costOut = cost ? price(cost.output ?? cost.o) : null;
  return {
    provider,
    id: cleanId,
    name: text(raw.name) || cleanId,
    family: text(raw.family),
    contextTokens: count(raw.contextTokens ?? limit.context),
    outputTokens: count(raw.outputTokens ?? limit.output),
    toolCall: flag(raw.toolCall ?? raw.tool_call),
    reasoning: flag(raw.reasoning),
    structuredOutput: flag(raw.structuredOutput ?? raw.structured_output),
    input: modalities(raw.input ?? mods.input),
    output: modalities(raw.output ?? mods.output),
    openWeights: flag(raw.openWeights ?? raw.open_weights),
    status: status(raw.status),
    released: text(raw.released ?? raw.release_date, 10),
    updated: text(raw.updated ?? raw.last_updated, 10),
    cost: costIn !== null && costOut !== null ? { input: costIn, output: costOut } : null,
  };
}

// The providers block of either shape. Malformed providers and models are
// left out rather than failing the whole read: one bad row on models.dev
// must not cost the other eight thousand.
export function readCatalogProviders(json: unknown): CatalogProviders {
  const out: CatalogProviders = {};
  if (!isRecord(json)) return out;
  let providers = 0;
  for (const [key, raw] of Object.entries(json)) {
    if (providers >= MAX_PROVIDERS) break;
    const id = text(key, 100);
    if (!id || UNSAFE_KEYS.has(id) || !isRecord(raw) || !isRecord(raw.models)) continue;
    const models: Record<string, CatalogModel> = {};
    let n = 0;
    for (const [modelKey, rawModel] of Object.entries(raw.models)) {
      if (n >= MAX_MODELS_PER_PROVIDER) break;
      const model = readCatalogModel(id, isRecord(rawModel) && typeof rawModel.id === "string" ? rawModel.id : modelKey, rawModel);
      if (!model) continue;
      models[model.id] = model;
      n += 1;
    }
    out[id] = { id, name: text(raw.name, 100) || id, api: text(raw.api, 500), models };
    providers += 1;
  }
  return out;
}

export function catalogModelCount(providers: CatalogProviders): number {
  return Object.values(providers).reduce((sum, provider) => sum + Object.keys(provider.models).length, 0);
}

// The stored form (the cache file and the bundled snapshot).
export type StoredCatalog = { fetchedAt: string; providers: CatalogProviders };

export function readStoredCatalog(json: unknown): StoredCatalog | null {
  if (!isRecord(json) || !isRecord(json.providers)) return null;
  const providers = readCatalogProviders(json.providers);
  if (!Object.keys(providers).length) return null;
  return { fetchedAt: text(json.fetchedAt, 40), providers };
}

// ---- which provider a base URL is ----

// Hosts ODM reaches by name. Anything else is matched against the `api`
// address each catalog provider declares, and a private address is nobody's.
const KNOWN_HOSTS: ReadonlyArray<[RegExp, string]> = [
  [/(^|\.)api\.openai\.com$/, "openai"],
  [/(^|\.)openrouter\.ai$/, "openrouter"],
  [/(^|\.)api\.anthropic\.com$/, "anthropic"],
  [/generativelanguage\.googleapis\.com$/, "google"],
  [/(^|\.)api\.x\.ai$/, "xai"],
  [/(^|\.)api\.groq\.com$/, "groq"],
  [/(^|\.)api\.deepseek\.com$/, "deepseek"],
  [/(^|\.)api\.mistral\.ai$/, "mistral"],
  [/(^|\.)api\.fireworks\.ai$/, "fireworks-ai"],
  [/(^|\.)api\.cerebras\.ai$/, "cerebras"],
  [/(^|\.)api\.deepinfra\.com$/, "deepinfra"],
  [/(^|\.)ollama\.com$/, "ollama-cloud"],
  [/(^|\.)api\.moonshot\.(ai|cn)$/, "moonshotai"],
];

function hostOf(url: string): string {
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function providerForBaseUrl(baseUrl: string, providers: CatalogProviders = {}): string {
  const host = hostOf(baseUrl);
  if (!host) return "";
  for (const [pattern, id] of KNOWN_HOSTS) {
    if (pattern.test(host)) return id;
  }
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1)/.test(host) || !host.includes(".")) {
    return "";
  }
  for (const provider of Object.values(providers)) {
    if (provider.api && hostOf(provider.api) === host) return provider.id;
  }
  return "";
}

// ---- finding a configured id in the catalog ----

// A fine-tune is named ft:<base>:<org>:<suffix>:<id>.
function baseOfFineTune(id: string): string {
  return id.toLowerCase().startsWith("ft:") ? (id.split(":")[1] ?? "") : id;
}

function tailOf(id: string): string {
  return id.split("/").pop() ?? id;
}

// A key that reads through the ways one set of weights gets named: Ollama's
// "gemma4:31b-it-qat", DeepInfra's "google/gemma-4-31B-it", a GGUF's
// "Qwen3.6-35B-A3B-Q8_0". Vendor prefix, instruct and quantisation tags and
// punctuation all go; what stays is the family and the size.
const QUANT_TAIL = /[-_:.](q\d(_[a-z0-9]+)*|iq\d[a-z0-9_]*|fp\d+|bf16|f16|f32|int\d|awq|gptq|gguf|mlx|\d+bit|nvfp4|w\d+a\d+|exl\d)$/i;
const DROPPED_TOKENS = new Set(["it", "instruct", "chat", "qat", "latest", "hf", "gguf", "uncensored", "abliterated"]);

export function looseModelKey(id: string): string {
  let name = tailOf(baseOfFineTune(id.trim().toLowerCase()));
  for (let i = 0; i < 4; i += 1) {
    const stripped = name.replace(QUANT_TAIL, "");
    if (stripped === name) break;
    name = stripped;
  }
  return name
    .split(/[-_:/\s]+/)
    .filter((token) => token && !DROPPED_TOKENS.has(token))
    .join("")
    .replace(/[^a-z0-9]/g, "");
}

// When several providers list the same weights, the vendor's own row comes
// first; after that the rows are ordered by provider id so the answer is
// the same every time.
const PROVIDER_RANK = ["openai", "anthropic", "google", "xai", "deepseek", "mistral", "moonshotai", "zai", "minimax", "alibaba", "meta", "openrouter"];

function providerRank(id: string): number {
  const at = PROVIDER_RANK.indexOf(id);
  return at === -1 ? PROVIDER_RANK.length : at;
}

function byPreference(a: CatalogModel, b: CatalogModel): number {
  return (
    // A provider that retired its own hosting of some weights says nothing
    // about the weights; a row still served speaks for them.
    Number(a.status === "deprecated") - Number(b.status === "deprecated") ||
    // Weights that call tools somewhere call tools: a host that switched
    // them off does not speak for the model.
    Number(b.toolCall) - Number(a.toolCall) ||
    Number(b.openWeights) - Number(a.openWeights) ||
    providerRank(a.provider) - providerRank(b.provider) ||
    a.provider.localeCompare(b.provider) ||
    a.id.localeCompare(b.id)
  );
}

type CatalogIndex = { exact: Map<string, CatalogModel[]>; tail: Map<string, CatalogModel[]>; loose: Map<string, CatalogModel[]> };

const indexes = new WeakMap<CatalogProviders, CatalogIndex>();

function push(map: Map<string, CatalogModel[]>, key: string, model: CatalogModel) {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(model);
  else map.set(key, [model]);
}

function indexOf(providers: CatalogProviders): CatalogIndex {
  const cached = indexes.get(providers);
  if (cached) return cached;
  const index: CatalogIndex = { exact: new Map(), tail: new Map(), loose: new Map() };
  for (const provider of Object.values(providers)) {
    for (const model of Object.values(provider.models)) {
      push(index.exact, model.id.toLowerCase(), model);
      push(index.tail, tailOf(model.id).toLowerCase(), model);
      push(index.loose, looseModelKey(model.id), model);
    }
  }
  for (const map of [index.exact, index.tail, index.loose]) {
    for (const list of map.values()) list.sort(byPreference);
  }
  indexes.set(providers, index);
  return index;
}

// The catalog row for a configured model id. A provider hint (the base
// URL's, or the agent program's vendor) is tried first and exactly; then
// the id anywhere, then its tail (OpenRouter's "openai/gpt-5.6" against
// OpenAI's "gpt-5.6"), then the loose key, for weights served under another
// name. Null when nothing fits: an unknown model is allowed, just unknown.
export function findCatalogModel(providers: CatalogProviders, modelId: string, providerHint = ""): CatalogModel | null {
  const id = baseOfFineTune(modelId.trim());
  if (!id) return null;
  const lower = id.toLowerCase();
  const hinted = providerHint ? providers[providerHint] : undefined;
  if (hinted) {
    const own = Object.values(hinted.models).find((model) => model.id.toLowerCase() === lower);
    if (own) return own;
    const tail = tailOf(lower);
    const byTail = Object.values(hinted.models).filter((model) => tailOf(model.id).toLowerCase() === tail);
    if (byTail.length === 1) return byTail[0];
  }
  const index = indexOf(providers);
  const loose = looseModelKey(lower);
  const found = index.exact.get(lower)?.[0] ?? index.tail.get(tailOf(lower))?.[0] ?? index.loose.get(loose)?.[0];
  if (found) return found;
  // A served alias is often the catalog name cut short ("qwen3.6-35b" for
  // Qwen3.6-35B-A3B, "gemma4-26b" for gemma-4-26B-A4B): the shortest row
  // the alias begins, when the alias names a family and a size.
  if (loose.length < 6 || !/\d/.test(loose)) return null;
  let best: CatalogModel | null = null;
  let bestKey = "";
  for (const [key, rows] of index.loose) {
    if (key.startsWith(loose) && (!best || key.length < bestKey.length || (key.length === bestKey.length && byPreference(rows[0], best) < 0))) {
      best = rows[0];
      bestKey = key;
    }
  }
  return best;
}

// Every row of one provider, for a picker that lists what a vendor sells
// when the vendor's own API lists nothing useful.
export function providerModels(providers: CatalogProviders, providerId: string): CatalogModel[] {
  return Object.values(providers[providerId]?.models ?? {}).sort((a, b) => b.released.localeCompare(a.released) || a.id.localeCompare(b.id));
}

// ---- what ODM needs of a model ----

// narration and dictation are the speech models: what they need of a model
// is that the speech server serves it, which no catalog row says.
export type ModelRole = "story" | "utility" | "image" | "narration" | "dictation";
export type ModelFit = "ok" | "warn" | "unfit" | "unknown";

export type ModelVerdict = {
  fit: ModelFit;
  // Worded for the admin, worst first.
  warnings: string[];
  // One line of what the catalog says: window, abilities, price.
  summary: string;
};

// A picture model by its name, for a server whose list carries no
// modalities and a catalog that has not heard of it.
export function isImageModelId(id: string): boolean {
  return /(gpt-image|dall-e|imagen|flux|stable-diffusion|sdxl|image-\d|-image\b|seedream|ideogram|recraft|hidream|kandinsky|qwen-image|z-image)/i.test(id);
}

// A speech model by its name, for the speech pickers: only what is shown
// first, with every listed model one click away, and never what is sent.
export function isSpeechModelId(id: string, role: "narration" | "dictation"): boolean {
  return role === "narration"
    ? /(tts|speech|voice|kokoro|orpheus|piper|sesame)/i.test(id)
    : /(whisper|transcri|stt|asr|parakeet|canary|voxtral)/i.test(id);
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  return `${Math.round(tokens / 1_000)}K`;
}

function formatPrice(cost: CatalogModel["cost"]): string {
  if (!cost) return "";
  if (cost.input === 0 && cost.output === 0) return "free";
  const dollars = (value: number) => (value >= 1 ? `$${Math.round(value * 100) / 100}` : `$${value}`);
  return `${dollars(cost.input)} in / ${dollars(cost.output)} out per M tokens`;
}

// `local`: the weights run on the admin's own machine, so a hosting
// provider's price and retirement of them are not this model's.
export function describeCatalogModel(model: CatalogModel | null, options: { local?: boolean } = {}): string {
  if (!model) return "Not in the model catalog.";
  const parts: string[] = [];
  if (model.contextTokens) parts.push(`${formatTokens(model.contextTokens)} context`);
  if (model.output.includes("image")) parts.push("paints pictures");
  if (model.toolCall) parts.push("tool calls");
  if (model.reasoning) parts.push("reasoning");
  if (model.input.includes("image")) parts.push("sees pictures");
  if (model.openWeights) parts.push("open weights");
  const price = options.local ? "" : formatPrice(model.cost);
  if (price) parts.push(price);
  if (model.status && !options.local) parts.push(model.status);
  return parts.join(" · ") || model.name;
}

// The story prompt packs against the window; below this the table loses
// its recent history every few turns.
export const SMALL_CONTEXT_TOKENS = RECOMMENDED_WINDOW;

// `tools` is the backend's own word on tool calls where it gives one
// (Ollama's capabilities); it outranks the catalog's.
export function assessModel(input: {
  role: ModelRole;
  id: string;
  catalog: CatalogModel | null;
  listed: boolean | null;
  local?: boolean;
  tools?: boolean | null;
  // The weights' size on disk against what this machine can hold
  // (src/lib/model-registry/hardware.ts), for a model that runs here.
  memory?: { sizeGb: number; budgetGb: number } | null;
}): ModelVerdict {
  const warnings: string[] = [];
  let fit: ModelFit = "ok";
  const unfit = (why: string) => {
    fit = "unfit";
    warnings.push(why);
  };
  const warn = (why: string) => {
    if (fit === "ok") fit = "warn";
    warnings.push(why);
  };
  const { catalog, role } = input;
  const writes = role === "story" || role === "utility";
  if (input.listed === false) {
    warn("Not listed by the server right now. Load it there, or pick one it lists.");
  }
  const noTools = (why: string) => {
    if (role === "story") unfit(`${why} The storyteller runs on them: dice, sheets and scenes are all tool calls.`);
    else warn(`${why} Lore checks and bookkeeping that use them will fall back to plain text.`);
  };
  if (writes && input.tools === false) {
    noTools("Takes no tool calls, by the server's own account.");
  }
  if (input.memory && input.memory.sizeGb && input.memory.budgetGb && input.memory.sizeGb * 1.1 > input.memory.budgetGb) {
    unfit(`Too big for this machine: ${input.memory.sizeGb} GB of weights against ${Math.round(input.memory.budgetGb)} GB of memory.`);
  }
  if (!catalog) {
    if (role === "image" && !isImageModelId(input.id)) {
      warn("Not in the catalog, and its name does not say it paints. ODM will try it as a picture model.");
    }
    return { fit: fit === "ok" ? "unknown" : fit, warnings, summary: describeCatalogModel(null) };
  }
  if (input.local) {
    // Weights on the admin's own disk are nobody's to retire.
  } else if (catalog.status === "deprecated") {
    warn("Deprecated by its provider. It may stop answering; pick a newer model when you can.");
  } else if (catalog.status === "alpha" || catalog.status === "beta") {
    warn(`Marked ${catalog.status} by its provider; it may change or go away.`);
  }
  if (role === "image") {
    if (!catalog.output.includes("image")) {
      unfit("Does not paint pictures: it answers in text only.");
    }
  } else if (writes) {
    if (!catalog.output.includes("text")) {
      unfit("Does not write text, so it cannot narrate.");
    }
    if (!catalog.toolCall && input.tools !== false) {
      if (input.tools === true) {
        // The server says it does; the catalog's row was another host's.
      } else if (input.local) {
        // A loosely matched row for weights on this machine: a doubt, not a verdict.
        warn("The catalog's row for these weights takes no tool calls; test the backend to be sure.");
      } else {
        noTools("Takes no tool calls.");
      }
    }
    if (catalog.contextTokens && role === "story") {
      // The storyteller's own minimums (src/lib/story-window.ts). Too small
      // to narrate rules a hosted model out; a local row is a loose match
      // for the weights, so it only warns.
      const verdict = storyWindowVerdict(catalog.contextTokens);
      if (verdict.level === "short" && !input.local) unfit(verdict.text);
      else if (verdict.text) warn(verdict.text);
    } else if (catalog.contextTokens && catalog.contextTokens < SMALL_CONTEXT_TOKENS) {
      warn(`A ${formatTokens(catalog.contextTokens)} window is small for a campaign; the table will forget recent turns often.`);
    }
  }
  return { fit, warnings, summary: describeCatalogModel(catalog, { local: input.local }) };
}
