import { generateComfyImage } from "@/lib/comfyui";
import { setMessageGeneratedImage } from "@/lib/db/messages";
import { publishPersisted } from "@/lib/events";
import { enqueueMediaJob } from "@/lib/media-queue";
import type { ImageRequest, StorySettings } from "@/lib/types";

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
  return enqueueMediaJob(`image ${messageId}`, async () => {
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
  });
}
