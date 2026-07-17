import { DEFAULT_LOCAL_TEXT_MODEL } from "@/lib/text-models";
import type { StorySettings } from "@/lib/types";

export const DEFAULT_CHAT_TITLE = "Untitled story";

export const DEFAULT_STORY_SETTINGS: StorySettings = {
  world:
    "A grounded interactive fiction scene with sharp dialogue, human stakes, and space for the player to steer the story.",
  style:
    "Classic text-adventure narration: direct second person, vivid but restrained prose, natural dialogue, and no purple exposition.",
  textProvider: "local",
  localTextModel: DEFAULT_LOCAL_TEXT_MODEL,
  customBaseUrl: "",
  customModel: "",
  customApiKey: "",
  imageMode: "fast",
  // This machine (AMD gfx1151) can't run the bundled mflux/sdnq workers, so
  // route images through the local ComfyUI (empty comfyUrl falls back to
  // COMFYUI_URL / http://127.0.0.1:8188). Pin the SDXL checkpoint so adding
  // other models to ComfyUI can't shift the auto-selected checkpoints[0].
  imageBackend: "comfyui",
  comfyUrl: "",
  comfyCheckpoint: "CyberRealisticXLPlay_V6.0.safetensors",
  aspect: "square",
  imageGenerationEnabled: true,
  autoImages: true,
  proseSize: "medium",
};

export function titleFromInput(input: string) {
  const compact = input.replace(/\s+/g, " ").trim();
  if (!compact) {
    return DEFAULT_CHAT_TITLE;
  }

  return compact.length > 58 ? `${compact.slice(0, 55).trim()}...` : compact;
}
