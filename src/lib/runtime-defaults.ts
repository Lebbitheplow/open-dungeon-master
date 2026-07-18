import { getGlobalConfig } from "@/lib/db/app-settings";
import { DEFAULT_STORY_SETTINGS } from "@/lib/defaults";
import { serverEnv } from "@/lib/server-env";
import {
  isLocalTextModelId,
  isTextProvider,
} from "@/lib/text-models";
import type { StorySettings } from "@/lib/types";

function clean(value: string) {
  return value.trim();
}

// Default story settings for new campaigns. Resolution order for each field:
// admin panel (app_settings) > env var > DEFAULT_STORY_SETTINGS.
export function configuredDefaultStorySettings(): StorySettings {
  const cfg = getGlobalConfig();
  const customBaseUrl = cfg.text.customBaseUrl || clean(serverEnv("OPENAI_COMPAT_BASE_URL"));
  const openRouterDefaultModel = /(^|\.)openrouter\.ai/i.test(customBaseUrl)
    ? clean(serverEnv("OPENROUTER_MODEL", "google/gemini-3.5-flash"))
    : "";
  const customModel =
    cfg.text.customModel || clean(serverEnv("OPENAI_COMPAT_MODEL")) || openRouterDefaultModel;
  const requestedProvider = cfg.text.provider || clean(serverEnv("DEFAULT_TEXT_PROVIDER"));
  const textProvider = isTextProvider(requestedProvider)
    ? requestedProvider
    : customBaseUrl
      ? "custom"
      : DEFAULT_STORY_SETTINGS.textProvider;
  const requestedLocalModel = cfg.text.localTextModel || clean(serverEnv("LOCAL_TEXT_MODEL"));
  const localTextModel = isLocalTextModelId(requestedLocalModel)
    ? requestedLocalModel
    : DEFAULT_STORY_SETTINGS.localTextModel;

  return {
    ...DEFAULT_STORY_SETTINGS,
    textProvider,
    localTextModel,
    customBaseUrl: customBaseUrl || DEFAULT_STORY_SETTINGS.customBaseUrl,
    customModel: customModel || DEFAULT_STORY_SETTINGS.customModel,
    // The global API key never lands in per-campaign settings; it is applied
    // at request time in model-client so it can't leak to campaign members.
    customApiKey: "",
    comfyUrl: cfg.images.comfyUrl || DEFAULT_STORY_SETTINGS.comfyUrl,
    comfyCheckpoint: cfg.images.comfyCheckpoint || DEFAULT_STORY_SETTINGS.comfyCheckpoint,
  };
}
