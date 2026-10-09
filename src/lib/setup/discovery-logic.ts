// The guided setup's eyes (src/app/setup): which AI services a fresh server
// looks for on its own machine, and how their answers are read. Pure, so
// scripts/test-setup-wizard.mjs can drive every rule without a network. The
// fetching lives in discovery.ts.
import { isPrivateBackendHost } from "../backend-host.ts";

// The kinds of local text server the wizard can name. A server it cannot
// tell apart still works; it is listed as "openai-compatible".
export type TextServerKind =
  | "llama.cpp"
  | "ollama"
  | "lm-studio"
  | "vllm"
  | "koboldcpp"
  | "tabbyapi"
  | "jan"
  | "openai-compatible";

export const TEXT_SERVER_LABEL: Record<TextServerKind, string> = {
  "llama.cpp": "llama.cpp",
  ollama: "Ollama",
  "lm-studio": "LM Studio",
  vllm: "vLLM",
  koboldcpp: "KoboldCpp",
  tabbyapi: "TabbyAPI",
  jan: "Jan",
  "openai-compatible": "OpenAI-compatible server",
};

// Each program's own default port, ODM's documented llama-server first. The
// guess names the program when its answer does not.
export const TEXT_PORTS: ReadonlyArray<{ port: number; guess: TextServerKind }> = [
  { port: 8001, guess: "llama.cpp" },
  { port: 8080, guess: "llama.cpp" },
  { port: 11434, guess: "ollama" },
  { port: 1234, guess: "lm-studio" },
  { port: 8000, guess: "vllm" },
  { port: 5001, guess: "koboldcpp" },
  { port: 5000, guess: "tabbyapi" },
  { port: 1337, guess: "jan" },
];

export const COMFYUI_PORT = 8188;
export const KOKORO_PORT = 8880;
export const WHISPER_PORT = 8870;

// Where to look. Inside a container 127.0.0.1 is the container itself, so
// the host is asked for by its Docker name first; host networking makes
// 127.0.0.1 the host again, which is why it stays on the list.
export function scanHosts(inContainer: boolean): string[] {
  return inContainer ? ["host.docker.internal", "127.0.0.1"] : ["127.0.0.1"];
}

// The text-server ports worth asking, without this server's own port: a
// server listening on 8000 or 8080 would otherwise find itself.
export function textPorts(ownPort: string | number | undefined): Array<{ port: number; guess: TextServerKind }> {
  const own = Number(ownPort);
  return TEXT_PORTS.filter((entry) => entry.port !== own);
}

// A base URL the way the app stores one: scheme, host, port and /v1. People
// paste a bare host, a /v1 base or the whole /chat/completions endpoint, and
// all three mean the same server.
export function normalizeBaseUrl(input: string): string {
  let text = input.trim();
  if (!text) {
    return "";
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    text = `http://${text}`;
  }
  text = text.replace(/\/+$/, "").replace(/\/chat\/completions$/i, "").replace(/\/models$/i, "").replace(/\/+$/, "");
  return /\/v\d+$/.test(text) ? text : `${text}/v1`;
}

export function modelsUrl(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  return base ? `${base}/models` : "";
}

export type ListedModel = {
  id: string;
  label: string;
  // The model's window where the server says it; OpenRouter does.
  context?: number;
};

type RawModel = {
  id?: unknown;
  name?: unknown;
  owned_by?: unknown;
  context_length?: unknown;
  supported_parameters?: unknown;
};

function rawModels(json: unknown): RawModel[] {
  if (!json || typeof json !== "object") {
    return [];
  }
  const record = json as { data?: unknown; models?: unknown };
  const list = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];
  return list.filter((entry): entry is RawModel => Boolean(entry) && typeof entry === "object");
}

// Models that cannot narrate: embeddings, speech, pictures, moderation,
// rerankers, and OpenAI's audio and realtime variants. A DM needs a chat
// model with tool calls, and a list full of these hides the one that works.
const NOT_A_STORYTELLER =
  /(embed|embedding|bge-|\be5-|minilm|rerank|whisper|transcribe|\btts\b|tts-|kokoro|dall-e|gpt-image|image-|sora|moderation|realtime|audio|search-preview|computer-use|davinci|babbage|\bclip\b|vision-encoder)/i;

export function isStorytellerModel(id: string): boolean {
  return !NOT_A_STORYTELLER.test(id);
}

// The chat models a server lists, in its own order. OpenRouter says which
// models take tools; those that do not are dropped, since the DM runs on
// tool calls and a model without them narrates past its dice.
export function readModelList(json: unknown): ListedModel[] {
  const seen = new Set<string>();
  const out: ListedModel[] = [];
  for (const entry of rawModels(json)) {
    const id = typeof entry.id === "string" ? entry.id.trim() : typeof entry.name === "string" ? entry.name.trim() : "";
    if (!id || seen.has(id) || !isStorytellerModel(id)) {
      continue;
    }
    if (Array.isArray(entry.supported_parameters) && !entry.supported_parameters.includes("tools")) {
      continue;
    }
    seen.add(id);
    const label = typeof entry.name === "string" && entry.name.trim() && entry.name.trim() !== id ? entry.name.trim() : id;
    const context = typeof entry.context_length === "number" && entry.context_length > 0 ? entry.context_length : undefined;
    out.push({ id, label, ...(context ? { context } : {}) });
  }
  return out;
}

// Which program answered, from the owner it gives its models, falling back
// to the program that usually sits on that port.
export function identifyTextServer(json: unknown, guess: TextServerKind): TextServerKind {
  const owners = rawModels(json)
    .map((entry) => (typeof entry.owned_by === "string" ? entry.owned_by.toLowerCase() : ""))
    .filter(Boolean);
  const owner = owners[0] ?? "";
  if (owner.includes("llamacpp") || owner.includes("llama.cpp") || owner.includes("llama-server")) return "llama.cpp";
  if (owner === "library" || owner.includes("ollama")) return "ollama";
  if (owner.includes("vllm")) return "vllm";
  if (owner.includes("koboldcpp")) return "koboldcpp";
  if (owner.includes("tabby")) return "tabbyapi";
  if (owner === "organization_owner" || owner.includes("lmstudio") || owner.includes("lm-studio")) return "lm-studio";
  return guess;
}

// What the wizard makes of one GET to a /models endpoint.
export type ProbeVerdict = "found" | "needs-key" | "absent";

export function readModelsAnswer(status: number): ProbeVerdict {
  if (status >= 200 && status < 300) return "found";
  // 401 is a key-gated OpenAI-style server (llama-server --api-key,
  // TabbyAPI). A 403 is not: macOS's AirPlay answers 403 on port 5000.
  if (status === 401) return "needs-key";
  return "absent";
}

// ODM's documented default DM model.
export const DEFAULT_LOCAL_MODEL = "qwen3.6-35b";

// The hosted providers the wizard knows by name. Their base URL is fixed,
// so all that is asked is the key.
export type KeyProviderId = "openai" | "openrouter" | "other";

export type KeyProvider = {
  id: KeyProviderId;
  label: string;
  baseUrl: string;
  keyUrl: string;
  keyPlaceholder: string;
  // The model preselected when the provider lists it. The client app's
  // OpenAI setup preselects the same one (open-dungeon-master-client
  // src/shared/ai-setup.ts DEFAULT_MODEL).
  preferred: readonly string[];
  // One key also covers pictures, narration and dictation.
  coversMedia: boolean;
};

export const KEY_PROVIDERS: readonly KeyProvider[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-...",
    preferred: ["gpt-5.1", "gpt-5.4-mini", "gpt-5-mini", "gpt-5"],
    coversMedia: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
    keyPlaceholder: "sk-or-...",
    preferred: ["google/gemini-3.5-flash"],
    coversMedia: false,
  },
  {
    id: "other",
    label: "Another provider",
    baseUrl: "",
    keyUrl: "",
    keyPlaceholder: "Your provider's API key",
    preferred: [],
    coversMedia: false,
  },
];

// Which of the wizard's answers a saved storyteller address is: a server on
// this machine or network ("local"), or a hosted provider reached on a key.
export function storySourceForUrl(url: string): "local" | KeyProviderId {
  const host = (() => {
    try {
      return new URL(normalizeBaseUrl(url)).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (host === "openai.com" || host.endsWith(".openai.com")) return "openai";
  if (host === "openrouter.ai" || host.endsWith(".openrouter.ai")) return "openrouter";
  return !host || isPrivateBackendHost(normalizeBaseUrl(url)) ? "local" : "other";
}

export function keyProvider(id: KeyProviderId): KeyProvider {
  return KEY_PROVIDERS.find((provider) => provider.id === id) ?? KEY_PROVIDERS[2];
}

// A pasted key often says whose it is. OpenRouter's start "sk-or-"; most of
// OpenAI's start "sk-". Anything else is left to the person.
export function providerForKey(key: string): KeyProviderId | null {
  const text = key.trim();
  if (/^sk-or-/i.test(text)) return "openrouter";
  if (/^sk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{16,}/.test(text)) return "openai";
  return null;
}

// The model to preselect: the documented default when the server has it,
// then the provider's preferred ones, then the first chat model listed.
export function recommendedModel(models: readonly ListedModel[], preferred: readonly string[] = [DEFAULT_LOCAL_MODEL]): string {
  for (const want of preferred) {
    const exact = models.find((model) => model.id === want);
    if (exact) return exact.id;
  }
  for (const want of preferred) {
    const close = models.find((model) => model.id.toLowerCase().includes(want.toLowerCase()));
    if (close) return close.id;
  }
  return models[0]?.id ?? "";
}

// ComfyUI's checkpoint list, from GET /object_info/CheckpointLoaderSimple.
export function readComfyCheckpoints(json: unknown): string[] {
  const node = (json as { CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: unknown } } } } | null)
    ?.CheckpointLoaderSimple;
  const field = node?.input?.required?.ckpt_name;
  const list = Array.isArray(field) && Array.isArray(field[0]) ? field[0] : [];
  return list.filter((name): name is string => typeof name === "string" && name.trim() !== "");
}

// Kokoro-FastAPI's voice list, from GET /v1/audio/voices.
export function readKokoroVoices(json: unknown): string[] {
  const voices = (json as { voices?: unknown } | null)?.voices;
  return Array.isArray(voices) ? voices.filter((voice): voice is string => typeof voice === "string") : [];
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

// The key a model listing is asked with. A typed key always; otherwise the
// saved one, but only for the host it was saved for, so running the wizard
// again lists the models without pasting the key, and a saved key can never
// be sent to an address somebody typed.
export function keyForListing(input: { typed: string; savedKey: string; savedBaseUrl: string; baseUrl: string }): string {
  if (input.typed.trim()) {
    return input.typed.trim();
  }
  const saved = input.savedKey.trim();
  const host = hostOf(normalizeBaseUrl(input.baseUrl));
  return saved && host && host === hostOf(normalizeBaseUrl(input.savedBaseUrl)) ? saved : "";
}

export function originOf(host: string, port: number): string {
  return `http://${host}:${port}`;
}
