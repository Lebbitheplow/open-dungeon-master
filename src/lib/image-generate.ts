import { generateComfyImage } from "@/lib/comfyui";
import { generateOpenAiImage, openAiImagesConfigured, openAiImagesPaid } from "@/lib/openai-images";
import { generateHarnessImage, harnessImagesReady } from "@/lib/harness/images";
import { PaidAiRefusedError, paidAiAllowedNow } from "@/lib/shared-host";
import { recordUsage } from "@/lib/usage/ledger";
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
  if (settings.imageBackend === "harness") {
    return harnessImagesReady();
  }
  return false;
}

export async function generateStoryImage(
  settings: StorySettings,
  options: {
    prompt: string;
    mode: ImageMode;
    aspect: AspectPreset;
    seed?: number;
    hasReferences?: boolean;
    // What the picture must leave out, from the table's boundary.
    negative?: string;
    // The admin's test picture (src/lib/harness/picture-test.ts): the agent
    // may paint before its pictures are switched on for the tables.
    verifying?: boolean;
  },
): Promise<GeneratedImage> {
  const { verifying, ...request } = options;
  // OpenAI pictures run on the host's key and the agent program on the
  // admin's plan: the shared-host policy answers for both before anything
  // is painted (src/lib/shared-host.ts). ComfyUI is the host's own GPU.
  const paid =
    settings.imageBackend === "harness" || (settings.imageBackend === "openai" && openAiImagesPaid(settings));
  if (paid && !paidAiAllowedNow()) {
    throw new PaidAiRefusedError("images");
  }
  const started = Date.now();
  const image = await (settings.imageBackend === "openai"
    ? generateOpenAiImage(request, settings)
    : settings.imageBackend === "harness"
      ? generateHarnessImage({ ...request, force: Boolean(verifying) })
      : // Everything else lands on ComfyUI, which was the previous behavior
        // for every producer-side call regardless of the selected backend.
        generateComfyImage({
          url: settings.comfyUrl || undefined,
          checkpoint: settings.comfyCheckpoint || undefined,
          ...request,
        }));
  recordUsage({
    kind: "image",
    role: request.mode,
    backend: settings.imageBackend === "openai" || settings.imageBackend === "harness" ? settings.imageBackend : "comfyui",
    model: settings.imageBackend === "comfyui" ? settings.comfyCheckpoint : "",
    paid,
    units: 1,
    durationMs: Date.now() - started,
  });
  return image;
}
