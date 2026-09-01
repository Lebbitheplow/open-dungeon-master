import { generateStoryImage, imageProducerReady } from "@/lib/image-generate";
import {
  getCampaignMessage,
  getLatestDmMessage,
  setMessageGeneratedImage,
  setMessageImageRequest,
} from "@/lib/db/messages";
import type { Campaign } from "@/lib/db/campaigns";
import { imageToolArgsSchema, type ImageToolArgs } from "@/lib/image-tool";
import { publishEphemeral, publishPersisted } from "@/lib/events";
import { enqueueMediaJob } from "@/lib/media-queue";
import type { ImageRequest, StorySettings } from "@/lib/types";

// Ephemeral progress refinements for the pending-media placeholders. The
// durable truth stays derivable (a message with imageRequest and no
// generatedImage IS pending), so reloads never lose the placeholder.
export function publishMediaStatus(
  campaignId: string,
  kind: "image" | "map" | "tts",
  targetId: string,
  state: "queued" | "generating" | "failed",
) {
  publishEphemeral(campaignId, "media_status", {
    kind,
    targetId,
    state,
    startedAt: new Date().toISOString(),
  });
}

// Fulfill a DM message's image request on the serial media queue. Called
// fire-and-forget after the DM turn persists, so narration never waits on
// the GPU. The client already renders message.generatedImage and handles
// the image_ready event; this is the missing producer side.
export function fulfillMessageImage(
  campaignId: string,
  messageId: string,
  request: ImageRequest,
  settings: StorySettings,
) {
  const prompt = request.prompt;
  if (!prompt) {
    return Promise.resolve();
  }
  publishMediaStatus(campaignId, "image", messageId, "queued");
  return enqueueMediaJob(`image ${messageId}`, async () => {
    publishMediaStatus(campaignId, "image", messageId, "generating");
    try {
      const image = await generateStoryImage(settings, {
        prompt,
        mode: request.mode ?? settings.imageMode,
        aspect: request.aspect ?? settings.aspect,
      });
      if (!setMessageGeneratedImage(messageId, image)) {
        return;
      }
      publishPersisted(campaignId, "image_ready", { messageId, image });
    } catch (error) {
      publishMediaStatus(campaignId, "image", messageId, "failed");
      throw error;
    }
  });
}

// generate_image, as an adjudication a person can invoke.
//
// The AI attaches its picture to the narration it wrote in the same turn. A
// human DM narrates first and decides to illustrate after, so this hangs the
// request on their latest passage: the picture belongs under the words it
// illustrates, and inventing a caption-only message to carry it would put a
// second DM passage in the transcript that nobody wrote.
export function handleGenerateImage(
  campaign: Campaign,
  rawArguments: string,
): Record<string, unknown> {
  if (!campaign.settings.imageGenerationEnabled) {
    return { error: "Image generation is off for this campaign." };
  }
  let args: ImageToolArgs;
  try {
    args = imageToolArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: illustrating needs a prompt." };
  }
  const message = getLatestDmMessage(campaign.id);
  if (!message) {
    return { error: "Narrate something first; the picture hangs under the passage it draws." };
  }
  const request: ImageRequest = {
    needed: true,
    prompt: args.prompt,
    mode: campaign.settings.imageMode,
    backend: campaign.settings.imageBackend,
    aspect: campaign.settings.aspect,
    reason: args.reason,
    characterIds: [],
  };
  if (!setMessageImageRequest(message.id, request)) {
    return { error: "That passage is no longer there." };
  }
  const updated = getCampaignMessage(message.id);
  if (updated) {
    publishPersisted(campaign.id, "message_updated", { message: updated });
  }
  // Backends without a producer side record the request and the existing
  // placeholder tells the table a picture is coming.
  if (imageProducerReady(campaign.settings.imageBackend)) {
    void fulfillMessageImage(campaign.id, message.id, request, campaign.settings);
  }
  return { ok: true, illustrating: message.id };
}
