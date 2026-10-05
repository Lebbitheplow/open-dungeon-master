import { configValue, getGlobalConfig } from "@/lib/app-config";
import { openAiSpeechConfig } from "@/lib/openai-images";
import { TTS_VOICES } from "@/lib/tts-voices";

// Where narration is rendered (issue 89). One setting names the kind of
// speech server, the way the text model's does, and everything else follows
// from it:
//
//   kokoro  a Kokoro-FastAPI service, the shipped default at 127.0.0.1:8880.
//   openai  any server that speaks OpenAI's /v1/audio/speech: OpenAI itself,
//           or a local one (Kokoro-FastAPI, Speaches, openedai-speech, ...)
//           with its own address, model and key.
//   off     no narration on this server.
//
// Both kinds are the same request on the wire; the kind only picks the
// defaults, so a server set up before this existed keeps working untouched.
// The decision logic is pure and exported so scripts/test-tts-backend.mjs can
// drive it without a network.

export type TtsProvider = "kokoro" | "openai" | "off";

export type TtsBackend = {
  provider: TtsProvider;
  // The /v1 root: speech is POSTed to `${v1}/audio/speech`.
  v1: string;
  model: string;
  apiKey: string;
  // The voice used when a campaign names one this server does not have.
  defaultVoice: string;
};

export const KOKORO_DEFAULT_URL = "http://127.0.0.1:8880";
export const OPENAI_DEFAULT_URL = "https://api.openai.com/v1";
export const OPENAI_DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";

// OpenAI publishes no voice list endpoint; these are the documented voices.
export const OPENAI_TTS_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
];

// A bare host, a /v1 base, or a trailing slash all land on the same root,
// the same forgiveness the text model's address gets.
export function v1Root(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return /\/v\d+$/.test(base) ? base : `${base}/v1`;
}

export function isOpenAiHost(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "api.openai.com";
  } catch {
    return false;
  }
}

export type TtsBackendInput = {
  provider: string;
  // Admin value, then env, for each kind of server.
  kokoroUrl: string;
  openaiUrl: string;
  model: string;
  apiKey: string;
  voice: string;
  // The server's shared OpenAI key (images, dictation), lent only to
  // api.openai.com itself.
  sharedOpenAiKey: string;
};

export function resolveTtsBackend(input: TtsBackendInput): TtsBackend {
  const provider: TtsProvider = input.provider === "openai" || input.provider === "off" ? input.provider : "kokoro";
  if (provider === "openai") {
    const base = input.openaiUrl.trim() || OPENAI_DEFAULT_URL;
    const official = isOpenAiHost(base);
    return {
      provider,
      v1: v1Root(base),
      // A local server names its own models; only OpenAI has a default.
      model: input.model.trim() || (official ? OPENAI_DEFAULT_TTS_MODEL : "tts-1"),
      apiKey: input.apiKey.trim() || (official ? input.sharedOpenAiKey.trim() : ""),
      defaultVoice: input.voice.trim() || (official ? "alloy" : ""),
    };
  }
  return {
    provider,
    v1: v1Root(input.kokoroUrl.trim() || KOKORO_DEFAULT_URL),
    model: input.model.trim() || "kokoro",
    apiKey: input.apiKey.trim(),
    defaultVoice: input.voice.trim() || "af_heart",
  };
}

// The server's saved narration backend. `override` carries the admin form's
// unsaved values so "Test" tries what is typed, not what was last saved.
export function ttsBackend(override: Partial<Pick<TtsBackendInput, "provider" | "kokoroUrl" | "openaiUrl" | "model" | "voice">> & { apiKey?: string } = {}): TtsBackend {
  const speech = getGlobalConfig().speech;
  const provider = override.provider ?? configValue(speech.ttsProvider, "TTS_PROVIDER");
  return resolveTtsBackend({
    provider,
    kokoroUrl: override.kokoroUrl?.trim() || configValue(speech.kokoroUrl, "KOKORO_URL"),
    openaiUrl: override.openaiUrl?.trim() || configValue(speech.ttsBaseUrl, "TTS_BASE_URL"),
    model: override.model?.trim() || configValue(speech.ttsModel, "TTS_MODEL"),
    apiKey: override.apiKey?.trim() || configValue(speech.ttsApiKey, "TTS_API_KEY"),
    voice: override.voice?.trim() || configValue(speech.ttsVoice, "TTS_VOICE"),
    sharedOpenAiKey: openAiSpeechConfig().apiKey,
  });
}

export type TtsVoice = { id: string; label: string };

// A voice list as servers answer it: Kokoro-FastAPI sends { voices: [ids] },
// others send objects, or OpenAI's { data: [...] } envelope.
export function parseVoiceList(payload: unknown): string[] {
  const root = payload as { voices?: unknown; data?: unknown } | unknown[] | null;
  const list = Array.isArray(root) ? root : Array.isArray(root?.voices) ? root.voices : Array.isArray(root?.data) ? root.data : [];
  const ids: string[] = [];
  for (const entry of list) {
    const id =
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object"
          ? ((entry as Record<string, unknown>).id ?? (entry as Record<string, unknown>).voice_id ?? (entry as Record<string, unknown>).name)
          : null;
    if (typeof id === "string" && id.trim() && id.length <= 120 && !ids.includes(id.trim())) {
      ids.push(id.trim());
    }
  }
  return ids.slice(0, 400);
}

// The picker's list: the curated voices this server really has first, under
// their friendly names, then everything else it reports by id.
export function labelVoices(ids: string[]): TtsVoice[] {
  const curated: TtsVoice[] = TTS_VOICES.filter((voice) => ids.includes(voice.id)).map((voice) => ({ id: voice.id, label: voice.label }));
  const known = new Set(curated.map((voice) => voice.id));
  return [...curated, ...ids.filter((id) => !known.has(id)).map((id) => ({ id, label: id }))];
}

// What a server offers when it will not say: Kokoro's shipped voices, or
// OpenAI's documented ones. An unknown compatible server offers nothing and
// the picker falls back to typing a voice.
export function fallbackVoices(backend: Pick<TtsBackend, "provider" | "v1">): string[] {
  if (backend.provider === "kokoro") {
    return TTS_VOICES.map((voice) => voice.id);
  }
  return isOpenAiHost(backend.v1) ? OPENAI_TTS_VOICES : [];
}

// The voice actually asked for. Campaigns, personalities and NPCs made on a
// Kokoro server carry Kokoro voice ids; on a server that has no such voice
// they would fail every passage, so a Kokoro id the server does not list
// becomes the server's default voice. Anything else is sent as written: a
// custom voice string is the server's to understand.
export function effectiveVoice(voice: string, backend: Pick<TtsBackend, "provider" | "defaultVoice">, serverVoices: string[]): string {
  const asked = voice.trim() || backend.defaultVoice;
  if (backend.provider !== "openai" || !backend.defaultVoice) {
    return asked;
  }
  const kokoroId = TTS_VOICES.some((entry) => entry.id === asked);
  return kokoroId && !serverVoices.includes(asked) ? backend.defaultVoice : asked;
}

// Why a render failed, in words for the table (issue 88). Never the key, and
// never more of an upstream body than a sentence.
export function describeSpeechFailure(error: unknown, backend: Pick<TtsBackend, "provider" | "v1">): string {
  const where = backend.provider === "kokoro" ? "The Kokoro speech server" : "The speech server";
  if (error instanceof SpeechHttpError) {
    if (error.status === 401 || error.status === 403) {
      return `${where} refused the API key (HTTP ${error.status}).`;
    }
    if (error.status === 404) {
      return `${where} has no speech endpoint at ${backend.v1}/audio/speech (HTTP 404).`;
    }
    const detail = error.detail ? `: ${error.detail}` : "";
    return `${where} answered HTTP ${error.status}${detail}`.replace(/\.?$/, ".");
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return `${where} took too long to answer.`;
  }
  if (error instanceof SpeechEmptyError) {
    return `${where} answered without any audio.`;
  }
  return `${where} could not be reached at ${hostOf(backend.v1)}.`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// Plain fields, not parameter properties: the test scripts load this file
// through Node's type stripping, which has no such syntax.
export class SpeechHttpError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(`Speech request failed: HTTP ${status}${detail ? ` ${detail}` : ""}`);
    this.name = "SpeechHttpError";
    this.status = status;
    this.detail = detail;
  }
}

export class SpeechEmptyError extends Error {
  constructor() {
    super("Speech request returned no audio.");
    this.name = "SpeechEmptyError";
  }
}

// The one sentence of an upstream error body worth repeating.
export function upstreamDetail(body: string): string {
  let text = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; detail?: unknown; message?: unknown };
    const found =
      (typeof parsed.error === "object" && parsed.error ? parsed.error.message : parsed.error) ?? parsed.detail ?? parsed.message;
    if (typeof found === "string") {
      text = found;
    } else if (found !== undefined) {
      text = JSON.stringify(found);
    }
  } catch {
    // Not JSON: an HTML error page says nothing a table can use.
    if (/<\s*(html|!doctype)/i.test(body)) {
      return "";
    }
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

async function requestSpeech(backend: TtsBackend, input: string, voice: string, speed: number): Promise<Buffer> {
  const response = await fetch(`${backend.v1}/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(backend.apiKey ? { Authorization: `Bearer ${backend.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: backend.model, voice, input, response_format: "mp3", ...(speed !== 1 ? { speed } : {}) }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    throw new SpeechHttpError(response.status, upstreamDetail(await response.text().catch(() => "")));
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) {
    throw new SpeechEmptyError();
  }
  return audio;
}

// One clip of speech from the configured server.
export async function synthesizeSpeech(input: string, voice: string, speed = 1, backend: TtsBackend = ttsBackend()): Promise<Buffer> {
  if (backend.provider === "off") {
    throw new Error("Narration is switched off on this server.");
  }
  const voices = backend.provider === "openai" ? await serverVoiceIds(backend) : [];
  // A local server with no default named falls back to the first voice it
  // lists, as the admin form says it will.
  const defaultVoice = backend.defaultVoice || voices[0] || "";
  return requestSpeech(backend, input, effectiveVoice(voice, { ...backend, defaultVoice }, voices), speed);
}

type VoiceCacheEntry = { at: number; ids: string[]; listed: boolean };

declare global {
  var __odmTtsVoices: Map<string, VoiceCacheEntry> | undefined;
}

const VOICE_CACHE_MS = 60_000;

// The voices the server lists, with whether it listed them itself. Kept a
// minute per address: every passage asks on an OpenAI-kind server, and the
// picker asks whenever a settings panel opens.
export async function serverVoices(backend: TtsBackend = ttsBackend(), fresh = false): Promise<{ ids: string[]; listed: boolean }> {
  if (backend.provider === "off") {
    return { ids: [], listed: false };
  }
  const cache = (globalThis.__odmTtsVoices ??= new Map());
  const key = `${backend.provider}|${backend.v1}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < VOICE_CACHE_MS) {
    return { ids: hit.ids, listed: hit.listed };
  }
  let ids: string[] = [];
  let listed = false;
  // OpenAI itself has no such endpoint; asking only spends a round trip.
  if (!isOpenAiHost(backend.v1)) {
    try {
      const response = await fetch(`${backend.v1}/audio/voices`, {
        cache: "no-store",
        headers: backend.apiKey ? { Authorization: `Bearer ${backend.apiKey}` } : {},
        signal: AbortSignal.timeout(4_000),
      });
      if (response.ok) {
        ids = parseVoiceList(await response.json().catch(() => null));
        listed = ids.length > 0;
      }
    } catch {
      // Unreachable or not a server that lists voices: the fallback below.
    }
  }
  if (!listed) {
    ids = fallbackVoices(backend);
  }
  cache.set(key, { at: Date.now(), ids, listed });
  return { ids, listed };
}

async function serverVoiceIds(backend: TtsBackend): Promise<string[]> {
  return (await serverVoices(backend)).ids;
}
