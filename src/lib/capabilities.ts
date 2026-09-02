import { configValue, getGlobalConfig } from "@/lib/app-config";
import { configuredDefaultStorySettings } from "@/lib/runtime-defaults";
import { serverEnv } from "@/lib/server-env";
import { voiceConfig, type VoiceMode } from "@/lib/voice/config";
import type { StorySettings } from "@/lib/types";

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
  story: { configured: boolean; reachable: boolean };
  utility: { configured: boolean };
  images: { configured: boolean; reachable: boolean; backend: string };
  tts: { configured: boolean; reachable: boolean };
  stt: { configured: boolean };
  voice: { enabled: boolean; mode: VoiceMode };
};

export const PROBE_TIMEOUT_MS = 2_500;
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
  return Boolean(settings.customBaseUrl.trim() && settings.customModel.trim());
}

// An empty utilityModel means "off" by design (everything runs on the story
// model), so the model name is the whole configuration signal.
export function utilityConfigured(settings: Pick<StorySettings, "utilityModel">): boolean {
  return Boolean(settings.utilityModel.trim());
}

// Images follow the same rule as speech: the key-gated OpenAI backend needs
// its key, and a self-hosted backend counts when the admin or env named a
// URL for it or when something answers at the shipped default. A bare
// default with nothing listening is the "no image AI on this server" case
// that every upload-or-paint control needs to know about, so that it can
// offer the upload alone instead of a paint button that fails.
export function imagesConfigured(
  backend: string,
  hasOpenaiKey: boolean,
  explicitUrl: string,
  defaultReachable: boolean,
): boolean {
  if (backend === "openai") {
    return hasOpenaiKey;
  }
  return Boolean(explicitUrl.trim()) || defaultReachable;
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
  if (settings.textProvider === "none") {
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

export function ttsProbeUrl(kokoroBaseUrl: string): string {
  return `${kokoroBaseUrl.replace(/\/+$/, "")}/health`;
}

type ProbeEntry = { probedAt: number; reachable: boolean };

declare global {
  var __odmCapabilityProbes: Map<string, ProbeEntry> | undefined;
}

function probeStore(): Map<string, ProbeEntry> {
  if (!globalThis.__odmCapabilityProbes) {
    globalThis.__odmCapabilityProbes = new Map();
  }
  return globalThis.__odmCapabilityProbes;
}

// A failed probe is an answer, never an error: the UI polls this, and a dead
// backend must cost one timeout per cache window, not one per poll.
export async function probeReachable(url: string, now = Date.now()): Promise<boolean> {
  if (!url) {
    return false;
  }
  const cached = probeStore().get(url);
  if (cached && probeCacheFresh(cached.probedAt, now)) {
    return cached.reachable;
  }
  let reachable = false;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    reachable = response.ok;
  } catch {
    reachable = false;
  }
  probeStore().set(url, { probedAt: now, reachable });
  return reachable;
}

// The producer-side question every portrait and map enqueue asks before it
// promises a picture: is there an image backend on this server at all? Cached
// through the same probe window as the endpoint, so a burst of character
// creations costs one probe, not one per character.
export async function imagesAvailable(): Promise<boolean> {
  try {
    return (await capabilitiesSnapshot()).images.configured;
  } catch {
    // A failed snapshot must not turn into a lost render on a host that has
    // an image backend; the old unconditional behavior is the fallback.
    return true;
  }
}

export async function capabilitiesSnapshot(): Promise<Capabilities> {
  const settings = configuredDefaultStorySettings();
  const cfg = getGlobalConfig();
  const configured = storyConfigured(settings);
  const ollamaBase = serverEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434");
  const kokoroBase = configValue(cfg.speech.kokoroUrl, "KOKORO_URL", "http://127.0.0.1:8880");
  const comfyBase = configValue(cfg.images.comfyUrl, "COMFYUI_URL", "http://127.0.0.1:8188");
  const fluxBase = serverEnv("FLUX_WORKER_URL", "http://127.0.0.1:7869");
  const [storyReachable, ttsReachable, imagesReachable] = await Promise.all([
    configured ? probeReachable(storyProbeUrl(settings, ollamaBase)) : Promise.resolve(false),
    probeReachable(ttsProbeUrl(kokoroBase)),
    probeReachable(imagesProbeUrl(settings.imageBackend, comfyBase, fluxBase)),
  ]);
  const voice = voiceConfig();
  const hasOpenaiImageKey = Boolean(
    cfg.images.openaiApiKey || serverEnv("OPENAI_IMAGE_API_KEY") || serverEnv("OPENAI_API_KEY"),
  );
  const explicitImageUrl =
    settings.imageBackend === "comfyui"
      ? configValue(cfg.images.comfyUrl, "COMFYUI_URL")
      : serverEnv("FLUX_WORKER_URL");

  return {
    story: { configured, reachable: storyReachable },
    utility: { configured: utilityConfigured(settings) },
    images: {
      configured: imagesConfigured(
        settings.imageBackend,
        hasOpenaiImageKey,
        explicitImageUrl,
        imagesReachable,
      ),
      reachable: settings.imageBackend === "openai" ? hasOpenaiImageKey : imagesReachable,
      backend: settings.imageBackend,
    },
    tts: {
      configured: speechConfigured(configValue(cfg.speech.kokoroUrl, "KOKORO_URL"), ttsReachable),
      reachable: ttsReachable,
    },
    // No probe for Whisper: nothing depends on it at creation time, so an
    // explicit URL (admin panel or env) is the only signal reported.
    stt: { configured: Boolean(configValue(cfg.speech.sttUrl, "STT_URL")) },
    voice: { enabled: voice.enabled, mode: voice.mode },
  };
}
