import { openAiImagesConfigured } from "@/lib/openai-images";
import { configuredDefaultStorySettings } from "@/lib/runtime-defaults";
import { isDeviceWorld } from "@/lib/server-env";
import { isLocalTextModelId, isTextProvider } from "@/lib/text-models";
import { isImageBackend, isProseSize } from "@/lib/types";
import type { StorySettings } from "@/lib/types";

// Merge stored campaign StorySettings over the env-configured defaults and
// coerce every field back into a valid value. Lived in the retired solo
// module (lib/db.ts) before campaigns took it over.
export function normalizeSettings(settings?: Partial<StorySettings>): StorySettings {
  const defaultSettings = configuredDefaultStorySettings();
  const merged = {
    ...defaultSettings,
    ...settings,
  };

  // Migrate legacy OpenRouter chats into the unified custom provider. Runs
  // before provider validation, since "openrouter" is no longer a valid value.
  const legacy = (settings ?? {}) as Record<string, unknown>;
  if (legacy.textProvider === "openrouter") {
    merged.textProvider = "custom";
    if (!merged.customBaseUrl) merged.customBaseUrl = "https://openrouter.ai/api/v1";
    if (!merged.customModel && typeof legacy.openrouterModel === "string") {
      merged.customModel = legacy.openrouterModel;
    }
    if (!merged.customApiKey && typeof legacy.openrouterApiKey === "string") {
      merged.customApiKey = legacy.openrouterApiKey;
    }
  }

  if (
    merged.aspect !== "square" &&
    merged.aspect !== "portrait" &&
    merged.aspect !== "landscape"
  ) {
    merged.aspect = defaultSettings.aspect;
  }

  if (!isImageBackend(merged.imageBackend)) {
    merged.imageBackend = defaultSettings.imageBackend;
  }

  merged.comfyUrl =
    typeof merged.comfyUrl === "string" ? merged.comfyUrl.trim().slice(0, 500) : "";
  merged.comfyCheckpoint =
    typeof merged.comfyCheckpoint === "string" ? merged.comfyCheckpoint.trim().slice(0, 300) : "";

  if (merged.imageMode !== "fast" && merged.imageMode !== "slow") {
    merged.imageMode = defaultSettings.imageMode;
  }

  if (typeof merged.imageGenerationEnabled !== "boolean") {
    merged.imageGenerationEnabled = defaultSettings.imageGenerationEnabled;
  }

  if (typeof merged.autoImages !== "boolean") {
    merged.autoImages = defaultSettings.autoImages;
  }

  if (!isProseSize(merged.proseSize)) {
    merged.proseSize = defaultSettings.proseSize;
  }

  if (!isTextProvider(merged.textProvider)) {
    merged.textProvider = defaultSettings.textProvider;
  }

  if (!isLocalTextModelId(merged.localTextModel)) {
    merged.localTextModel = defaultSettings.localTextModel;
  }

  merged.customBaseUrl =
    typeof merged.customBaseUrl === "string" ? merged.customBaseUrl.trim().slice(0, 500) : "";
  merged.customModel =
    typeof merged.customModel === "string" ? merged.customModel.trim().slice(0, 200) : "";
  merged.customApiKey =
    typeof merged.customApiKey === "string" ? merged.customApiKey.trim().slice(0, 400) : "";

  // The optional utility model. An empty utilityModel means "off"; since the
  // shipped default is empty, campaigns saved before this field existed keep
  // running everything on the story model.
  if (!isTextProvider(merged.utilityProvider)) {
    merged.utilityProvider = defaultSettings.utilityProvider;
  }
  merged.utilityModel =
    typeof merged.utilityModel === "string" ? merged.utilityModel.trim().slice(0, 200) : "";
  merged.utilityBaseUrl =
    typeof merged.utilityBaseUrl === "string" ? merged.utilityBaseUrl.trim().slice(0, 500) : "";
  merged.utilityApiKey =
    typeof merged.utilityApiKey === "string" ? merged.utilityApiKey.trim().slice(0, 400) : "";

  return isDeviceWorld() ? { ...merged, ...deviceBackend(defaultSettings) } : merged;
}

// On a world an app hosts, who narrates and who paints is chosen once for the
// device (the app's Story AI screen writes it to the admin config), and every
// campaign follows it. A campaign freezes its settings when it is created, so
// without this a key added later would reach new campaigns only, and the
// player would be pasting it into each older one by hand. Applied where
// settings are read rather than copied into each row, so the next change on
// the device reaches every campaign too. The keys stay blank: model-client
// and openai-images attach the device's own at request time.
function deviceBackend(device: StorySettings): Partial<StorySettings> {
  return {
    textProvider: device.textProvider,
    localTextModel: device.localTextModel,
    customBaseUrl: device.customBaseUrl,
    customModel: device.customModel,
    customApiKey: "",
    utilityProvider: device.utilityProvider,
    utilityModel: device.utilityModel,
    utilityBaseUrl: device.utilityBaseUrl,
    utilityApiKey: "",
    imageBackend: device.imageBackend,
    comfyUrl: device.comfyUrl,
    comfyCheckpoint: device.comfyCheckpoint,
  };
}

// The campaign snapshot and the SSE stream deliver StorySettings to every
// member, but the two backend keys were entered by the story authority alone
// and belong to nobody else. Blanked at this boundary rather than in the UI,
// so no future payload can carry them by forgetting to.
export function scrubStorySettings(settings: StorySettings): StorySettings {
  return { ...settings, customApiKey: "", utilityApiKey: "" };
}

export type MaskedStorySettings = Omit<StorySettings, "customApiKey" | "utilityApiKey"> & {
  hasCustomApiKey: boolean;
  hasUtilityApiKey: boolean;
  // Whether THIS campaign's image backend can render, which /api/capabilities
  // cannot answer: that snapshot describes the server's own default backend,
  // and a table on its own OpenAI key is exactly the case the two disagree
  // about. Only meaningful for key-gated backends; a self-hosted one is
  // reported ready and its liveness still comes from the capability probe.
  imagesReady: boolean;
  // True on a world an app hosts, where the backend fields follow the device
  // and the panel shows them instead of editing them.
  deviceManaged: boolean;
};

// What the story authority's settings panel receives: every editable field,
// with the keys reduced to "is one set" booleans. Same contract as the admin
// route's maskedConfig, so a key can be kept or cleared but never re-read.
export function maskStorySettings(settings: StorySettings): MaskedStorySettings {
  const { customApiKey, utilityApiKey, ...rest } = settings;
  return {
    ...rest,
    hasCustomApiKey: customApiKey !== "",
    hasUtilityApiKey: utilityApiKey !== "",
    imagesReady: settings.imageBackend === "openai" ? openAiImagesConfigured(settings) : true,
    deviceManaged: isDeviceWorld(),
  };
}
