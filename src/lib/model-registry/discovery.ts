// Asking each kind of backend which models it serves: Ollama's own API for
// the "local" provider, an OpenAI-compatible server's /models for "custom"
// (the guided setup's reader, src/lib/setup/discovery.ts), an
// OpenAI-compatible images API's /models kept to the picture models, and a
// speech server's /models whole (narration and dictation). The
// readers are pure (discovery-logic.ts); this file does the fetching, with
// short timeouts and no retries, so a listing never holds a page.

import { listModels, type ModelListing } from "@/lib/setup/discovery";
import { modelsUrl, normalizeBaseUrl } from "@/lib/setup/discovery-logic";
import { serverEnv } from "@/lib/server-env";
import { rememberLocalContextWindow } from "@/lib/text-models";
import { isImageModelId } from "./catalog-logic";
import { isOllamaChatModel, readImageModelList, readModelIdList, readOllamaShow, readOllamaTags, type OllamaModel, type OllamaModelInfo } from "./discovery-logic";

const LIST_TIMEOUT_MS = 6_000;
const SHOW_TIMEOUT_MS = 8_000;

// Where the "local" provider's Ollama is, as model-client dials it.
export function ollamaBaseUrl(): string {
  return serverEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

export type OllamaListing =
  | { ok: true; baseUrl: string; models: OllamaModel[] }
  | { ok: false; baseUrl: string; error: string };

export async function listOllamaModels(baseUrl = ollamaBaseUrl()): Promise<OllamaListing> {
  const base = baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
  try {
    const response = await fetch(`${base}/api/tags`, { cache: "no-store", signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
    if (!response.ok) {
      return { ok: false, baseUrl: base, error: `Ollama answered ${response.status} when asked for its models.` };
    }
    return { ok: true, baseUrl: base, models: readOllamaTags(await response.json().catch(() => null)) };
  } catch {
    return { ok: false, baseUrl: base, error: `Nothing answered at ${base}. Is Ollama running?` };
  }
}

type Shown = Map<string, OllamaModelInfo | null>;
declare global {
  var __odmOllamaShown: Shown | undefined;
}

// One model's window and abilities, asked once per process: Ollama answers
// /api/show from the model file, and the file does not change under a
// running server. The window learned here is what the "local" provider's
// prompt is packed against (src/lib/text-models.ts).
export async function ollamaModelInfo(model: string, baseUrl = ollamaBaseUrl()): Promise<OllamaModelInfo | null> {
  const base = baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
  const key = `${base}::${model}`;
  const shown = (globalThis.__odmOllamaShown ??= new Map());
  if (shown.has(key)) return shown.get(key) ?? null;
  let info: OllamaModelInfo | null = null;
  try {
    const response = await fetch(`${base}/api/show`, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(SHOW_TIMEOUT_MS),
    });
    info = response.ok ? readOllamaShow(await response.json().catch(() => null)) : null;
  } catch {
    info = null;
  }
  // Only an answer is remembered: a server that was down is asked again.
  if (info) {
    shown.set(key, info);
    if (info.contextTokens) rememberLocalContextWindow(model, info.contextTokens);
  }
  return info;
}

export function forgetOllamaInfoForTests() {
  globalThis.__odmOllamaShown = undefined;
}

// The chat models an OpenAI-compatible server lists. The key is used for
// this one request and never stored here.
export function listCustomModels(baseUrl: string, apiKey: string): Promise<ModelListing> {
  return listModels(baseUrl, apiKey);
}

export type ModelIdListing =
  | { ok: true; baseUrl: string; models: string[] }
  | { ok: false; baseUrl: string; error: string; needsKey?: boolean };

// The picture models an OpenAI-compatible images API lists. `paints` is the
// catalog's word on an id (true, false, or null for one it has not heard
// of); a name that says it paints is kept when the catalog is silent.
export function listImageModels(baseUrl: string, apiKey: string, paints: (id: string) => boolean | null): Promise<ModelIdListing> {
  return listModelIds(baseUrl, apiKey, (json) => readImageModelList(json, paints, isImageModelId));
}

// Every model a speech server lists: a Whisper service, Speaches, OpenAI.
// Nothing is left out; the picker narrows what it shows by name.
export function listSpeechModels(baseUrl: string, apiKey: string): Promise<ModelIdListing> {
  return listModelIds(baseUrl, apiKey, (json) => readModelIdList(json, () => true));
}

async function listModelIds(baseUrlInput: string, apiKey: string, read: (json: unknown) => string[]): Promise<ModelIdListing> {
  const baseUrl = normalizeBaseUrl(baseUrlInput);
  if (!baseUrl) {
    return { ok: false, baseUrl, error: "Enter the server's address." };
  }
  let host = "";
  try {
    host = new URL(baseUrl).host;
  } catch {
    return { ok: false, baseUrl, error: "That address is not a web address." };
  }
  try {
    const response = await fetch(modelsUrl(baseUrl), {
      cache: "no-store",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS * 2),
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, baseUrl, needsKey: true, error: apiKey ? `${host} turned the key down.` : `${host} wants an API key.` };
    }
    if (!response.ok) {
      return { ok: false, baseUrl, error: `${host} answered ${response.status} when asked for its models.` };
    }
    return { ok: true, baseUrl, models: read(await response.json().catch(() => null)) };
  } catch {
    return { ok: false, baseUrl, error: `Nothing answered at ${host}. Is the server running, and is the address right?` };
  }
}

type SoleCache = Map<string, { at: number; id: string; answered: boolean; ttl: number }>;
declare global {
  var __odmSoleModel: SoleCache | undefined;
}
const SOLE_TTL_MS = 5 * 60_000;
// How long a speech server that did not answer is left alone: the
// capability probe's window (src/lib/capabilities.ts PROBE_CACHE_MS), so a
// Whisper box that is switched off costs one listing timeout per half
// minute on the paths that have no probe of their own (the voice-chat
// transcript, narration), not one per request.
const SOLE_SILENT_TTL_MS = 30_000;

// The one model a backend serves, when it serves exactly one: a
// llama-server started with a single model, an Ollama with one pull, a
// Whisper service with the model it loaded. A blank model setting runs it,
// so nothing has to be named in code or by the admin for the plain install
// to work; a server with several models is asked to have one picked.
// Remembered a few minutes per address.
export async function soleListedModel(input: { provider: "local" | "custom" | "speech"; baseUrl: string; apiKey?: string }): Promise<string> {
  return (await soleModelListing(input)).id;
}

// The same, with whether the server answered at all: a caller with a blank
// model tells "pick one of several" from "nothing answered there" by it.
export async function soleModelListing(input: { provider: "local" | "custom" | "speech"; baseUrl: string; apiKey?: string }): Promise<{ id: string; answered: boolean }> {
  const key = `${input.provider}::${input.baseUrl.trim()}`;
  const cache = (globalThis.__odmSoleModel ??= new Map());
  const kept = cache.get(key);
  if (kept && Date.now() - kept.at < kept.ttl) return { id: kept.id, answered: kept.answered };
  let id = "";
  let answered = false;
  if (input.provider === "local") {
    const listing = await listOllamaModels(input.baseUrl || ollamaBaseUrl());
    const chat = listing.ok ? listing.models.filter((model) => isOllamaChatModel(model)) : [];
    id = chat.length === 1 ? chat[0].id : "";
    answered = listing.ok;
  } else if (input.provider === "speech") {
    const listing = await listSpeechModels(input.baseUrl, input.apiKey ?? "");
    id = listing.ok && listing.models.length === 1 ? listing.models[0] : "";
    answered = listing.ok;
  } else {
    const listing = await listCustomModels(input.baseUrl, input.apiKey ?? "");
    id = listing.ok && listing.models.length === 1 ? listing.models[0].id : "";
    answered = listing.ok;
  }
  // Whatever the server answered is remembered, "several" (or none) too, so
  // a blank field is not listed again on every turn or page. A storyteller
  // that was down is asked again on the next turn, which should find a
  // server just started; a speech server that was down is left alone for
  // the probe's window.
  if (answered) cache.set(key, { at: Date.now(), id, answered, ttl: SOLE_TTL_MS });
  else if (input.provider === "speech") cache.set(key, { at: Date.now(), id: "", answered, ttl: SOLE_SILENT_TTL_MS });
  return { id, answered };
}

export function forgetSoleModelsForTests() {
  globalThis.__odmSoleModel = undefined;
}
