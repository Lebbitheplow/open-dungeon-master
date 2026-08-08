import {
  requestCustomMessage,
  requestLocalMessage,
  type ChatMessage,
  type ChatRequestOptions,
  type UpstreamResult,
} from "@/lib/model-client";
import type { StorySettings } from "@/lib/types";

// Routes a DM-side model call through the campaign's configured provider.
export function requestDmMessage(
  settings: StorySettings,
  messages: ChatMessage[],
  options: ChatRequestOptions,
): Promise<UpstreamResult> {
  if (settings.textProvider === "local") {
    return requestLocalMessage(settings.localTextModel, messages, options);
  }
  return requestCustomMessage(
    settings.customBaseUrl,
    settings.customModel,
    settings.customApiKey,
    messages,
    options,
  );
}

// Mechanical, non-narration work: history compaction, chapter summaries and
// fact extraction, world-arc ticks, lore checks, Ask answers. None of it is
// read as prose, so it runs happily on a small model while the story model
// keeps its weights and prompt cache resident.
//
// Entirely optional. With no utilityModel configured this IS requestDmMessage,
// and a configured-but-unreachable utility model falls back to the story model
// rather than failing the job: a wrong model name in settings must never cost
// a table its chapter summary.
export async function requestUtilityMessage(
  settings: StorySettings,
  messages: ChatMessage[],
  options: ChatRequestOptions,
): Promise<UpstreamResult> {
  const model = (settings.utilityModel ?? "").trim();
  if (!model) {
    return requestDmMessage(settings, messages, options);
  }

  const result =
    settings.utilityProvider === "local"
      ? await requestLocalMessage(model, messages, options)
      : await requestCustomMessage(
          settings.utilityBaseUrl,
          model,
          settings.utilityApiKey,
          messages,
          options,
        );
  if (!result.error) {
    return result;
  }
  console.error(`[model] utility model "${model}" failed; retrying on the story model`, result.error);
  return requestDmMessage(settings, messages, options);
}
