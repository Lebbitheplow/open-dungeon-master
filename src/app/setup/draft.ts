// The guided setup's answers so far, one object the steps read and write.
// Seeded from the saved settings (so running the wizard again starts from
// what the server does now) and from the scan (so a fresh server starts
// from what is running on it). Saving turns each step's slice into an admin
// settings patch (src/lib/setup/patches.ts).
import {
  DEFAULT_LOCAL_MODEL,
  KEY_PROVIDERS,
  normalizeBaseUrl,
  storySourceForUrl,
  type KeyProviderId,
  type ListedModel,
} from "@/lib/setup/discovery-logic";
import type { ScanResult } from "@/lib/setup/discovery";
import type { MaskedConfig } from "@/app/admin/AdminSettingsFields";
import type { HarnessChoiceId } from "@/lib/setup/patches";

export type StoryKind = "local" | "key" | "agent" | "none";

export type ModelList = {
  state: "idle" | "busy" | "ok" | "failed";
  models: ListedModel[];
  recommended: string;
  error: string;
  needsKey: boolean;
};

export const NO_LIST: ModelList = { state: "idle", models: [], recommended: "", error: "", needsKey: false };

export type Draft = {
  serverName: string;
  story: StoryKind | "";
  local: { baseUrl: string; model: string; apiKey: string; list: ModelList; typed: boolean };
  key: { provider: KeyProviderId; baseUrl: string; apiKey: string; model: string; list: ModelList };
  agent: { id: HarnessChoiceId | ""; model: string; utilityModel: string };
  pictures: "comfyui" | "openai" | "agent" | "none" | "";
  comfy: { url: string; checkpoint: string };
  picturesKey: string;
  narration: "kokoro" | "openai" | "off" | "";
  kokoro: { url: string; voice: string };
  narrationKey: string;
  signupMode: "open" | "invite" | "closed";
  publicUrl: string;
};

// Where the saved storyteller points, as one of the wizard's four answers.
export function draftFromConfig(config: MaskedConfig, firstRun: boolean): Draft {
  const text = config.text;
  const base = text.customBaseUrl;
  const source = storySourceForUrl(base);
  const story: Draft["story"] =
    text.provider === "harness"
      ? "agent"
      : text.provider === "none"
        ? "none"
        : text.provider === "local"
          ? "local"
          : text.provider === "custom" && base
            ? source === "local"
              ? "local"
              : "key"
            : // Auto on a fresh server: nothing chosen yet, the scan decides.
              firstRun
              ? ""
              : "local";
  const provider: KeyProviderId = source === "local" ? "openai" : source;
  const images = config.images;
  return {
    serverName: config.serverName,
    story,
    local: {
      baseUrl:
        text.provider === "local"
          ? "http://127.0.0.1:11434/v1"
          : story === "local" && base
            ? normalizeBaseUrl(base)
            : "",
      model: text.provider === "local" ? text.localTextModel : story === "local" ? text.customModel || (base ? "" : DEFAULT_LOCAL_MODEL) : "",
      apiKey: "",
      list: NO_LIST,
      typed: false,
    },
    key: {
      provider,
      baseUrl: story === "key" && provider === "other" ? base : "",
      apiKey: "",
      model: story === "key" ? text.customModel : "",
      list: NO_LIST,
    },
    agent: {
      id: config.harness.id,
      model: config.harness.model,
      utilityModel: config.harness.utilityModel,
    },
    pictures:
      images.defaultBackend === "comfyui" && images.comfyUrl
        ? "comfyui"
        : images.defaultBackend === "openai"
          ? "openai"
          : images.defaultBackend === "harness"
            ? "agent"
            : firstRun
              ? ""
              : "none",
    comfy: { url: images.comfyUrl, checkpoint: images.comfyCheckpoint },
    picturesKey: "",
    narration:
      config.speech.ttsProvider === "kokoro" && config.speech.kokoroUrl
        ? "kokoro"
        : config.speech.ttsProvider === "openai"
          ? "openai"
          : config.speech.ttsProvider === "off"
            ? "off"
            : "",
    kokoro: { url: config.speech.kokoroUrl, voice: config.speech.ttsVoice },
    narrationKey: "",
    signupMode: config.signupMode,
    publicUrl: config.publicUrl,
  };
}

// The scan's findings fill whatever the saved settings left open. Nothing
// the admin already chose (or saved) is overwritten.
export function draftWithScan(draft: Draft, scan: ScanResult, storyIsOpenAi: boolean): Draft {
  const next = { ...draft };
  const firstText = scan.text.find((found) => !found.needsKey && found.models.length) ?? scan.text[0];
  if (!next.story && firstText) {
    next.story = "local";
  }
  if (next.story === "local" && !next.local.baseUrl && firstText) {
    next.local = {
      ...next.local,
      baseUrl: firstText.baseUrl,
      model: firstText.recommended,
      list: { state: "ok", models: firstText.models, recommended: firstText.recommended, error: "", needsKey: firstText.needsKey },
    };
  }
  if (next.story === "local" && next.local.baseUrl) {
    // The saved server answered the scan: its model list comes with it.
    const same = scan.text.find((found) => found.baseUrl === normalizeBaseUrl(next.local.baseUrl));
    if (same && next.local.list.state === "idle") {
      next.local = {
        ...next.local,
        model: next.local.model || same.recommended,
        list: { state: same.needsKey ? "failed" : "ok", models: same.models, recommended: same.recommended, error: "", needsKey: same.needsKey },
      };
    }
  }
  if (!next.pictures) {
    next.pictures = scan.comfyui ? "comfyui" : storyIsOpenAi ? "openai" : "none";
  }
  if (next.pictures === "comfyui" && !next.comfy.url && scan.comfyui) {
    next.comfy = { url: scan.comfyui.url, checkpoint: next.comfy.checkpoint || scan.comfyui.checkpoints[0] || "" };
  }
  if (!next.narration) {
    // Narration reads every passage, so a paid voice is never switched on
    // by a guess; a Kokoro on this machine is free.
    next.narration = scan.kokoro ? "kokoro" : "off";
  }
  if (next.narration === "kokoro" && !next.kokoro.url && scan.kokoro) {
    next.kokoro = { url: scan.kokoro.url, voice: next.kokoro.voice || (scan.kokoro.voices.includes("af_heart") ? "af_heart" : scan.kokoro.voices[0] ?? "") };
  }
  return next;
}

export function keyProviderLabel(id: KeyProviderId): string {
  return KEY_PROVIDERS.find((provider) => provider.id === id)?.label ?? "Another provider";
}

// The storyteller in this draft is OpenAI on a key: its one key can then
// also paint, narrate and take dictation.
export function draftStoryIsOpenAi(draft: Draft): boolean {
  return draft.story === "key" && draft.key.provider === "openai";
}
