import { generateComfyImage } from "@/lib/comfyui";
import { generateOpenAiImage, openAiImagesConfigured } from "@/lib/openai-images";
import type { AspectPreset, GeneratedImage, ImageMode, StorySettings } from "@/lib/types";

// The one producer-side door for story images, so every enqueue site
// (narration images, location maps, portraits) honors the campaign's backend
// the same way instead of each hardcoding ComfyUI.
//
// Only ComfyUI and OpenAI have a producer here. The FLUX backends (mflux-hs,
// sdnq-hs) are driven by their own worker process; for them a request is
// recorded and the placeholder tells the table a picture is coming, exactly
// as before.
//
// Takes the campaign's settings rather than the backend alone, because the
// OpenAI backend can run on the key the table already gave its OpenAI text
// model (src/lib/openai-images.ts).
export function imageProducerReady(
  settings: Pick<StorySettings, "imageBackend" | "customBaseUrl" | "customApiKey">,
): boolean {
  if (settings.imageBackend === "comfyui") {
    return true;
  }
  if (settings.imageBackend === "openai") {
    return openAiImagesConfigured(settings);
  }
  return false;
}

export function generateStoryImage(
  settings: StorySettings,
  options: {
    prompt: string;
    mode: ImageMode;
    aspect: AspectPreset;
    seed?: number;
    hasReferences?: boolean;
    // What the picture must leave out, from the table's boundary.
    negative?: string;
  },
): Promise<GeneratedImage> {
  if (settings.imageBackend === "openai") {
    return generateOpenAiImage(options, settings);
  }
  // Everything else lands on ComfyUI, which was the previous behavior for
  // every producer-side call regardless of the selected backend.
  return generateComfyImage({
    url: settings.comfyUrl || undefined,
    checkpoint: settings.comfyCheckpoint || undefined,
    ...options,
  });
}
