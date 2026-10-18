import { configValue, getGlobalConfig } from "@/lib/app-config";
import { comfyModelPicked } from "@/lib/comfyui";
import { openAiImagesConfigured, openAiImagesNeedModel } from "@/lib/openai-images";
import { sttInputs } from "@/lib/stt";
import { pickSttBackend, sttWantsWav, whisperSwitchedOff, type SttBackend } from "@/lib/stt-logic";
import { configuredDefaultStorySettings } from "@/lib/runtime-defaults";
import { endpointKind } from "@/lib/dm/sampling-logic";
import { serverEnv } from "@/lib/server-env";
import { voiceConfig, type VoiceMode } from "@/lib/voice/config";
import { harnessConfig, probeHarness } from "@/lib/harness/status";
import { isHarnessId } from "@/lib/harness/types";
import { harnessImagesReady } from "@/lib/harness/images";
import { soleListedModel } from "@/lib/model-registry/discovery";
import type { StorySettings } from "@/lib/types";
import { isOpenAiHost, narrationModel, ttsBackend, type TtsBackend, type TtsProvider } from "@/lib/tts-backend";

// What this server can actually do, derived from the same resolution the DM
// path uses (configuredDefaultStorySettings, admin settings, env), not from
// env vars alone. /api/capabilities serves this to any logged-in user so the
// campaign creator can stop offering an AI DM that cannot exist.
//
// The decision logic (what counts as configured, cache expiry) lives in the
// exported pure functions below so scripts/test-capabilities.mjs can drive
// them without HTTP. Probe state lives on globalThis to survive dev HMR
// reloads, same pattern as src/lib/login-throttle.ts.

export type Capabilities = {
  // `model` is the storyteller's name for the title screen's status line
  // ("The DM is awake · qwen3.6-35b"); empty when nothing is configured.
  story: { configured: boolean; reachable: boolean; model: string };
  utility: { configured: boolean };
  // openaiPlace: where the OpenAI-kind image backend sends its requests,
  // "local" or the host's name (see `place` below). needsModel: the backend
  // is there (a key, or a ComfyUI that answers) but no model is picked, so
  // nothing is painted until an admin picks one; configured is then false.
  images: { configured: boolean; reachable: boolean; backend: string; openaiPlace: string; needsModel: boolean };
  // provider: the kind of speech server (src/lib/tts-backend.ts). place: where
  // passages are sent, "local" for this machine or its own network, else the
  // host's name, so a table can see whether narration leaves the building.
  // needsModel: an OpenAI-kind server is there, but no model is picked and
  // it does not list exactly one, so nothing is read aloud.
  tts: { configured: boolean; reachable: boolean; provider: TtsProvider; place: string; needsModel: boolean };
  // backend: which engine /api/stt will use; wantsWav: whether the browser
  // must send 16 kHz WAV instead of its own recording (the built-in engine).
  stt: { configured: boolean; backend: SttBackend; wantsWav: boolean };
  // transcribes: whether voice-chat transcription can write anything down
  // (the transcript route's own check, src/lib/stt.ts sttAvailable).
  voice: { enabled: boolean; mode: VoiceMode; transcribes: boolean };
};

export const PROBE_TIMEOUT_MS = 2_500;

// The short name of whatever writes the story: the local tag, the custom
// endpoint's model, or the connected agent's id.
export function storyModelName(
  settings: Pick<StorySettings, "textProvider" | "localTextModel" | "customModel">,
): string {
  const raw =
    settings.textProvider === "local"
      ? settings.localTextModel
      : settings.textProvider === "harness"
        ? settings.textProvider
        : settings.customModel;
  return (raw || "").trim().split("/").pop() || "";
}
// Long enough that a polling UI costs one upstream request per backend per
// half minute, short enough that starting llama-server shows up promptly.
export const PROBE_CACHE_MS = 30_000;

export function probeCacheFresh(probedAt: number, now: number): boolean {
  return now - probedAt < PROBE_CACHE_MS;
}

// "Configured" means the DM path would actually dial something: an explicit
// "none" and a missing URL or model both mean the first turn cannot work.
export function storyConfigured(
  settings: Pick<StorySettings, "textProvider" | "localTextModel" | "customBaseUrl" | "customModel">,
): boolean {
  if (settings.textProvider === "none") {
    return false;
  }
  if (settings.textProvider === "local") {
    return Boolean(settings.localTextModel.trim());
  }
  // The agent program is configured in its own admin section; whether it is
  // installed and signed in is the reachability half (harnessReady).
  if (settings.textProvider === "harness") {
    return true;
  }
  return Boolean(settings.customBaseUrl.trim() && settings.customModel.trim());
}

// An empty utilityModel means "off" by design (everything runs on the story
// model), so the model name is the whole configuration signal.
export function utilityConfigured(settings: Pick<StorySettings, "utilityModel">): boolean {
  return Boolean(settings.utilityModel.trim());
}

// Images follow the same rule as speech: the key-gated OpenAI backend needs
// its key and its model (openAiReady, src/lib/openai-images.ts), and a
// self-hosted backend counts when the admin or env named a URL for it or
// when something answers at the shipped default. A bare default with
// nothing listening is the "no image AI on this server" case that every
// upload-or-paint control needs to know about, so that it can offer the
// upload alone instead of a paint button that fails. ComfyUI also needs a
// model or checkpoint picked (comfyPicked): none is named in code, so
// without one it paints nothing however well it answers.
export function imagesConfigured(
  backend: string,
  openAiReady: boolean,
  explicitUrl: string,
  defaultReachable: boolean,
  comfyPicked = true,
): boolean {
  if (backend === "openai") {
    return openAiReady;
  }
  // The agent program's own pictures: ready means seen working here.
  if (backend === "harness") {
    return harnessImagesReady();
  }
  const there = Boolean(explicitUrl.trim()) || defaultReachable;
  return backend === "comfyui" ? there && comfyPicked : there;
}

// Where a cheap liveness GET goes for the image backend. ComfyUI exposes
// /system_stats; the bundled FLUX workers share one /health. OpenAI is
// key-gated and never probed.
export function imagesProbeUrl(backend: string, comfyBaseUrl: string, fluxWorkerUrl: string): string {
  if (backend === "comfyui") {
    return `${comfyBaseUrl.replace(/\/+$/, "")}/system_stats`;
  }
  if (backend === "mflux-hs" || backend === "sdnq-hs") {
    return `${fluxWorkerUrl.replace(/\/+$/, "")}/health`;
  }
  return "";
}

// TTS counts as configured when the admin or env named a Kokoro URL, or when
// something answers at the shipped default; a bare default with nothing
// listening is the "no AI on this server" case the creator needs to know.
export function speechConfigured(explicitUrl: string, defaultReachable: boolean): boolean {
  return Boolean(explicitUrl.trim()) || defaultReachable;
}

// Where a cheap liveness GET goes for the story backend. Ollama has no
// OpenAI-style /models, so the local provider probes its native tag list.
export function storyProbeUrl(
  settings: Pick<StorySettings, "textProvider" | "customBaseUrl">,
  ollamaBaseUrl: string,
): string {
  if (settings.textProvider === "none" || settings.textProvider === "harness") {
    return "";
  }
  if (settings.textProvider === "local") {
    return `${ollamaBaseUrl.replace(/\/+$/, "")}/api/tags`;
  }
  const base = settings.customBaseUrl.trim().replace(/\/+$/, "");
  if (!base) {
    return "";
  }
  // Same URL forgiveness as customChatEndpoint: a bare host, a /v1 base, or
  // anything in between all land on the models listing.
  return /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`;
}

// The bearer the story probe sends. Key-gated servers (llama.cpp with --api-key,
// OpenRouter, any proxy) answer /models with 401 to an anonymous GET, which
// used to read as "backend down" in the creator while turns worked fine. Same
// precedence as the request-time fallback in model-client.ts, and only ever
// for the server's own configured backend, so the key goes nowhere else.
export function storyProbeHeaders(
  settings: Pick<StorySettings, "textProvider" | "customBaseUrl">,
  keys: { configured: string; openaiCompat: string; openRouter: string },
): Record<string, string> {
  if (settings.textProvider === "none" || settings.textProvider === "local" || settings.textProvider === "harness") {
    return {};
  }
  const isOpenRouter = endpointKind(settings.customBaseUrl) === "openrouter";
  const key = (keys.configured || (isOpenRouter ? keys.openRouter : keys.openaiCompat) || "").trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

export function ttsProbeUrl(kokoroBaseUrl: string): string {
  return `${kokoroBaseUrl.replace(/\/+$/, "")}/health`;
}

// Where a liveness GET goes for the narration backend. Kokoro-FastAPI has
// /health beside its /v1; an OpenAI-kind server is asked for its model list,
// which every one of them serves. OpenAI itself is key-gated and not probed.
export function speechProbeUrl(backend: Pick<TtsBackend, "provider" | "v1">): string {
  if (backend.provider === "off" || isOpenAiHost(backend.v1)) {
    return "";
  }
  return backend.provider === "kokoro" ? ttsProbeUrl(backend.v1.replace(/\/v\d+$/, "")) : `${backend.v1}/models`;
}

// "local" for this machine and private networks, else the host's name.
export function backendPlace(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return "local";
  }
  const privateV4 = /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  const privateV6 = host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host);
  const localName = host === "localhost" || !host.includes(".") || /\.(local|lan|internal|home|localdomain)$/.test(host);
  return privateV4 || privateV6 || localName ? "local" : host;
}

function sttCapability(backend: SttBackend): Capabilities["stt"] {
  return { configured: backend !== "none", backend, wantsWav: sttWantsWav(backend) };
}

// The Whisper service is OpenAI-shaped and answers a model list.
export function sttProbeUrl(sttBaseUrl: string): string {
  return `${sttBaseUrl.replace(/\/+$/, "")}/v1/models`;
}

type ProbeEntry = { probedAt: number; reachable: boolean };

declare global {
  var __odmCapabilityProbes: Map<string, ProbeEntry> | undefined;
  var __odmCapabilityProbesInFlight: Map<string, Promise<boolean>> | undefined;
}

// Addresses come from the admin panel and the environment, so the set is
// small, but each edit adds one; past this many the oldest are forgotten.
const PROBE_STORE_MAX = 64;

function probeStore(): Map<string, ProbeEntry> {
  if (!globalThis.__odmCapabilityProbes) {
    globalThis.__odmCapabilityProbes = new Map();
  }
  return globalThis.__odmCapabilityProbes;
}

function probesInFlight(): Map<string, Promise<boolean>> {
  return (globalThis.__odmCapabilityProbesInFlight ??= new Map());
}

function rememberProbe(url: string, entry: ProbeEntry) {
  const store = probeStore();
  store.delete(url);
  store.set(url, entry);
  while (store.size > PROBE_STORE_MAX) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

// A failed probe is an answer, never an error: the UI polls this, and a dead
// backend must cost one timeout per cache window, not one per poll. Callers
// that arrive while the same address is already being asked share that one
// request instead of each dialling a cold backend (several tabs opening the
// admin panel at once).
export async function probeReachable(
  url: string,
  now = Date.now(),
  headers: Record<string, string> = {},
): Promise<boolean> {
  if (!url) {
    return false;
  }
  const cached = probeStore().get(url);
  if (cached && probeCacheFresh(cached.probedAt, now)) {
    return cached.reachable;
  }
  const pending = probesInFlight().get(url);
  if (pending) {
    return pending;
  }
  const probe = (async () => {
    let reachable = false;
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      reachable = response.ok;
      // Only the status matters; the body is not left to the collector.
      await response.body?.cancel().catch(() => undefined);
    } catch {
      reachable = false;
    }
    rememberProbe(url, { probedAt: now, reachable });
    return reachable;
  })().finally(() => {
    probesInFlight().delete(url);
  });
  probesInFlight().set(url, probe);
  return probe;
}

// The producer-side question every portrait and map enqueue asks before it
// promises a picture: can this campaign's backend paint right now? Without
// settings it is asked of the server's default (portraits, covers). Only the
// image backend is probed, never the whole capabilities snapshot: a DM turn
// asks this before handling its location calls, and the story, speech and
// dictation probes it has no use for could hold the turn for seconds. The
// probe is cached for the same window as the endpoint, so a burst of
// character creations costs one probe, not one per character.
export async function imagesAvailable(
  settings?: Pick<StorySettings, "imageBackend" | "customBaseUrl" | "customApiKey"> &
    Partial<Pick<StorySettings, "comfyUrl" | "comfyCheckpoint">>,
): Promise<boolean> {
  const campaign = settings ?? configuredDefaultStorySettings();
  // The OpenAI backend is key-gated: a campaign holding its own key, or
  // lending its OpenAI text model's, answers for itself, and with neither
  // (or no model picked) it cannot paint whatever the server's default is.
  if (campaign.imageBackend === "openai") {
    return openAiImagesConfigured(campaign);
  }
  // The agent program's pictures: its readiness is the agent's own
  // (installed, switched on, a test picture seen here).
  if (campaign.imageBackend === "harness") {
    return harnessImagesReady();
  }
  const cfg = getGlobalConfig();
  if (campaign.imageBackend === "comfyui") {
    // A ComfyUI campaign paints with its own checkpoint (or the catalog
    // model chosen for every campaign); with neither, nothing is painted
    // wherever ComfyUI runs.
    if (!comfyModelPicked(campaign.comfyCheckpoint)) {
      return false;
    }
    // It paints at its own address (generateStoryImage), which is the
    // admin's, copied in when the campaign was made. An address the admin or
    // env still names asked for pictures by name (imagesConfigured): its
    // failures are worth showing, so it is not second-guessed. Any other
    // address, the shipped default or one the admin has since changed or
    // cleared, counts only if something answers there.
    const named = trimSlashes(configValue(cfg.images.comfyUrl, "COMFYUI_URL"));
    const own = trimSlashes(campaign.comfyUrl ?? "") || named || "http://127.0.0.1:8188";
    if (named && own === named) {
      return true;
    }
    return probeReachable(imagesProbeUrl("comfyui", own, ""));
  }
  if (campaign.imageBackend === "mflux-hs" || campaign.imageBackend === "sdnq-hs") {
    const named = serverEnv("FLUX_WORKER_URL").trim();
    return Boolean(named) || probeReachable(imagesProbeUrl(campaign.imageBackend, "", "http://127.0.0.1:7869"));
  }
  return false;
}

function trimSlashes(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

// Whether a new table's narration switch starts on: the server has a speech
// engine switched on and, for a server of its own, named or answering (the
// new-campaign dialog's rule, from /api/capabilities). The API's bare create
// and Quick start took the schema default instead, so a text-only server's
// first table opened saying "Narration on" over a note that the server had
// none (issue 275). Off is known without a probe.
export async function narrationAvailable(): Promise<boolean> {
  if (ttsBackend().provider === "off") {
    return false;
  }
  try {
    return (await capabilitiesSnapshot()).tts.configured;
  } catch {
    return true;
  }
}

// Whether the chosen agent program is installed, allowed to run here and
// signed in. Uses the cached probe (five minutes), so a polling UI never
// starts the program itself.
export async function harnessReady(): Promise<boolean> {
  const config = harnessConfig();
  if (!isHarnessId(config.id)) {
    return false;
  }
  try {
    const status = await probeHarness(config.id);
    return status.installed && status.availability === "ok" && status.auth.state !== "signed-out";
  } catch {
    return false;
  }
}

// Whether a table may be handed to the AI at all: the storyteller the DM
// path would dial is configured (the same answer the creator reads from
// /api/capabilities, so the two never disagree). A storyteller that is down
// still counts: an outage is not a missing setup. A snapshot that fails for
// its own reasons answers yes, so a broken probe never stops a table from
// being made; it is the positive "nothing is set up" that refuses.
export const NO_STORYTELLER_MESSAGE =
  "This server has no AI storyteller set up, so the AI cannot run this table. Choose a human Dungeon Master, or set up a text model in Admin first.";

export async function storytellerConfigured(): Promise<boolean> {
  try {
    return (await capabilitiesSnapshot()).story.configured;
  } catch {
    return true;
  }
}

export async function capabilitiesSnapshot(): Promise<Capabilities> {
  const settings = configuredDefaultStorySettings();
  const cfg = getGlobalConfig();
  const configured = storyConfigured(settings);
  // A storyteller with its address and no model runs the one chat model its
  // server lists (soleListedModel, src/lib/model-registry/discovery.ts), so
  // it is probed as well, and counts as configured once that server answers
  // with exactly one.
  const blankModel =
    !configured &&
    ((settings.textProvider === "custom" && settings.customBaseUrl.trim() !== "") || settings.textProvider === "local");
  const storyHeaders = storyProbeHeaders(settings, {
    configured: cfg.text.customApiKey,
    openaiCompat: serverEnv("OPENAI_COMPAT_API_KEY"),
    openRouter: serverEnv("OPENROUTER_API_KEY"),
  });
  const ollamaBase = serverEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434");
  const speech = ttsBackend();
  const comfyBase = configValue(cfg.images.comfyUrl, "COMFYUI_URL", "http://127.0.0.1:8188");
  const fluxBase = serverEnv("FLUX_WORKER_URL", "http://127.0.0.1:7869");
  const sttBase = configValue(cfg.speech.sttUrl, "STT_URL", "http://127.0.0.1:8870");
  const [storyReachable, ttsReachable, imagesReachable, sttReachable] = await Promise.all([
    settings.textProvider === "harness"
      ? harnessReady()
      : configured || blankModel
      ? probeReachable(storyProbeUrl(settings, ollamaBase), Date.now(), storyHeaders)
      : Promise.resolve(false),
    probeReachable(speechProbeUrl(speech), Date.now(), speech.apiKey ? { Authorization: `Bearer ${speech.apiKey}` } : {}),
    probeReachable(imagesProbeUrl(settings.imageBackend, comfyBase, fluxBase)),
    whisperSwitchedOff(sttBase) ? Promise.resolve(false) : probeReachable(sttProbeUrl(sttBase)),
  ]);
  const soleStoryModel =
    blankModel && storyReachable
      ? await soleListedModel(
          settings.textProvider === "local"
            ? { provider: "local", baseUrl: ollamaBase }
            : { provider: "custom", baseUrl: settings.customBaseUrl.trim(), apiKey: (storyHeaders.Authorization ?? "").replace(/^Bearer /, "") },
        )
      : "";
  const storyReady = configured || Boolean(soleStoryModel);
  const voice = voiceConfig();
  // Asked of the backend's own resolver rather than re-listed here, so the
  // key a table lends from its OpenAI text model counts the same way at the
  // creator as it does at render time (src/lib/openai-images.ts).
  const openAiImagesReady = openAiImagesConfigured();
  const explicitImageUrl =
    settings.imageBackend === "comfyui"
      ? configValue(cfg.images.comfyUrl, "COMFYUI_URL")
      : serverEnv("FLUX_WORKER_URL");
  const comfyPicked = comfyModelPicked(settings.comfyCheckpoint);
  const comfyThere = settings.imageBackend === "comfyui" && (Boolean(explicitImageUrl.trim()) || imagesReachable);
  // An OpenAI-kind narration server's model: picked, TTS_MODEL, or the only
  // one a server of the host's own lists. Asked of such a server only while
  // its probe (the same model list) answers, so one that is down costs
  // nothing here.
  const speechModel =
    speech.provider === "openai" && (isOpenAiHost(speech.v1) || ttsReachable) ? await narrationModel(speech) : speech.model;
  const narrationNeedsModel =
    speech.provider === "openai" && !speechModel && (isOpenAiHost(speech.v1) ? speech.apiKey !== "" : ttsReachable);

  const dictation = await sttInputs(async () => sttReachable);

  return {
    story: {
      configured: storyReady,
      reachable: storyReachable,
      model: storyReady ? storyModelName(configured ? settings : { ...settings, customModel: soleStoryModel, localTextModel: soleStoryModel }) : "",
    },
    utility: { configured: utilityConfigured(settings) },
    images: {
      configured: imagesConfigured(
        settings.imageBackend,
        openAiImagesReady,
        explicitImageUrl,
        imagesReachable,
        comfyPicked,
      ),
      reachable:
        settings.imageBackend === "openai"
          ? openAiImagesReady
          : settings.imageBackend === "harness"
            ? harnessImagesReady()
            : imagesReachable,
      backend: settings.imageBackend,
      openaiPlace: backendPlace(configValue(cfg.images.openaiBaseUrl, "OPENAI_IMAGE_BASE_URL", "https://api.openai.com/v1")),
      needsModel: settings.imageBackend === "openai" ? openAiImagesNeedModel() : comfyThere && !comfyPicked,
    },
    tts: {
      // Off is off. An OpenAI-kind server with no model it can be asked for
      // reads nothing aloud. OpenAI itself is ready when it has a key, like
      // the image backend; a server with an address counts as configured
      // when the admin or env named it, or when the default one answers.
      configured:
        speech.provider === "off" || (speech.provider === "openai" && !speechModel)
          ? false
          : isOpenAiHost(speech.v1)
            ? speech.apiKey !== ""
            : speechConfigured(
                speech.provider === "openai"
                  ? configValue(cfg.speech.ttsBaseUrl, "TTS_BASE_URL")
                  : configValue(cfg.speech.kokoroUrl, "KOKORO_URL"),
                ttsReachable,
              ),
      reachable: speech.provider !== "off" && (isOpenAiHost(speech.v1) ? speech.apiKey !== "" : ttsReachable),
      provider: speech.provider,
      place: backendPlace(speech.v1),
      needsModel: narrationNeedsModel,
    },
    // Whisper (an explicit URL, or the default address answering) with its
    // model, then the built-in engine, then an OpenAI key with its model:
    // see src/lib/stt-logic.ts. The probe above is the one sttInputs asks.
    stt: sttCapability(pickSttBackend(dictation)),
    // The voice-chat transcript writes only to a Whisper service the admin
    // or STT_URL named, with its model (src/lib/stt.ts sttAvailable), read
    // from the same probe-gated inputs, so a named box that does not answer
    // costs nothing here.
    voice: { enabled: voice.enabled, mode: voice.mode, transcribes: Boolean(dictation.explicitWhisperUrl && dictation.whisperModel) },
  };
}
