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
