// Reading what inference servers say about their models. Pure, so the tests
// feed each reader a recorded answer; the fetching is in discovery.ts. The
// OpenAI-compatible /models reader is src/lib/setup/discovery-logic.ts
// readModelList, shared with the guided setup.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export type OllamaModel = {
  // The tag Ollama takes: "gemma4:31b-it-qat".
  id: string;
  label: string;
  sizeGb: number;
  family: string;
  parameters: string;
  quantization: string;
  modifiedAt: string;
};

// GET /api/tags: every model pulled into this Ollama.
export function readOllamaTags(json: unknown): OllamaModel[] {
  if (!isRecord(json) || !Array.isArray(json.models)) return [];
  const out: OllamaModel[] = [];
  const seen = new Set<string>();
  for (const entry of json.models) {
    if (!isRecord(entry)) continue;
    const id = typeof entry.name === "string" ? entry.name.trim() : typeof entry.model === "string" ? entry.model.trim() : "";
    if (!id || id.length > 200 || seen.has(id)) continue;
    seen.add(id);
    const details = isRecord(entry.details) ? entry.details : {};
    const size = typeof entry.size === "number" && entry.size > 0 ? Math.round((entry.size / 1024 ** 3) * 10) / 10 : 0;
    out.push({
      id,
      label: id,
      sizeGb: size,
      family: typeof details.family === "string" ? details.family : "",
      parameters: typeof details.parameter_size === "string" ? details.parameter_size : "",
      quantization: typeof details.quantization_level === "string" ? details.quantization_level : "",
      modifiedAt: typeof entry.modified_at === "string" ? entry.modified_at : "",
    });
  }
  return out;
}

export type OllamaModelInfo = {
  // The model's trained window, from model_info "<arch>.context_length".
  contextTokens: number;
  // Ollama's own list where it gives one: "completion", "tools", "vision",
  // "thinking", "embedding".
  capabilities: string[];
  // The whole model's parameter count (model_info "general.parameter_count");
  // 0 when Ollama does not say.
  parameters: number;
};

// POST /api/show {model}: the window, size and abilities of one model.
export function readOllamaShow(json: unknown): OllamaModelInfo | null {
  if (!isRecord(json)) return null;
  let contextTokens = 0;
  const info = isRecord(json.model_info) ? json.model_info : {};
  for (const [key, value] of Object.entries(info)) {
    if (/\.context_length$/.test(key) && typeof value === "number" && value > 0) {
      contextTokens = Math.floor(value);
      break;
    }
  }
  const count = info["general.parameter_count"];
  const parameters = typeof count === "number" && Number.isFinite(count) && count > 0 ? count : 0;
  const capabilities = Array.isArray(json.capabilities)
    ? json.capabilities.filter((entry): entry is string => typeof entry === "string").slice(0, 10)
    : [];
  return { contextTokens, capabilities, parameters };
}

// Ollama models that cannot narrate: embedding models answer no chat at all.
export function isOllamaChatModel(model: Pick<OllamaModel, "id" | "family">, info?: OllamaModelInfo | null): boolean {
  if (info?.capabilities.length) {
    return info.capabilities.includes("completion") && !info.capabilities.includes("embedding");
  }
  return !/(embed|embedding|bge-|minilm|rerank|nomic-embed|mxbai)/i.test(`${model.id} ${model.family}`);
}

// The ids of GET /v1/models on an OpenAI-compatible server, each once, the
// ones `keep` accepts.
export function readModelIdList(json: unknown, keep: (id: string) => boolean): string[] {
  if (!isRecord(json) || !Array.isArray(json.data)) return [];
  const out: string[] = [];
  for (const entry of json.data) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    const id = entry.id.trim();
    if (!id || id.length > 200 || out.includes(id)) continue;
    if (keep(id)) out.push(id);
  }
  return out;
}

// GET /v1/models of an OpenAI-compatible images API, kept to the picture
// models. `paints` is the catalog's word on an id; a server's list carries
// no modalities, so the name decides when the catalog has not heard of it.
export function readImageModelList(json: unknown, paints: (id: string) => boolean | null, byName: (id: string) => boolean): string[] {
  return readModelIdList(json, (id) => paints(id) ?? byName(id));
}
