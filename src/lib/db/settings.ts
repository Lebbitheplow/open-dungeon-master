import { configuredDefaultStorySettings } from "@/lib/runtime-defaults";
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

  return merged;
}
