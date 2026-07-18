import { generateComfyImage } from "@/lib/comfyui";
import { setMessageGeneratedImage } from "@/lib/db/messages";
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
      const image = await generateComfyImage({
        url: settings.comfyUrl || undefined,
        checkpoint: settings.comfyCheckpoint || undefined,
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
