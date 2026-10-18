import type { LocalTextModelId, TextProvider } from "@/lib/text-models";

export type AspectPreset = "square" | "portrait" | "landscape";

export type ImageMode = "fast" | "slow";

// "harness" paints with the server's agent program's own image tool (Codex,
// Grok Build), once the admin has seen it make a test picture
// (src/lib/harness/images.ts).
export type ImageBackend = "mflux-hs" | "sdnq-hs" | "comfyui" | "openai" | "harness";

export const IMAGE_BACKENDS = ["mflux-hs", "sdnq-hs", "comfyui", "openai", "harness"] as const;

export function isImageBackend(value: unknown): value is ImageBackend {
  return typeof value === "string" && (IMAGE_BACKENDS as readonly string[]).includes(value);
}

export const PROSE_SIZE_VALUES = [
  "tiny",
  "xsmall",
  "small",
  "medium",
  "large",
  "xlarge",
  "xxlarge",
  "huge",
  "giant",
] as const;

export type ProseSize = (typeof PROSE_SIZE_VALUES)[number];

export function isProseSize(value: unknown): value is ProseSize {
  return typeof value === "string" && PROSE_SIZE_VALUES.includes(value as ProseSize);
}

// The look of a campaign's generated maps and scene pictures
// (src/lib/art-direction.ts). "setting" follows the genre or world pack.
export const ART_STYLES = ["setting", "painted", "ink", "realistic", "comic", "custom"] as const;

export type ArtStyle = (typeof ART_STYLES)[number];

export function isArtStyle(value: unknown): value is ArtStyle {
  return typeof value === "string" && (ART_STYLES as readonly string[]).includes(value);
}

// A custom style's words go first in every prompt, and the CLIP encoders
// most local models use read only about 77 tokens, so a long style would
// push the place or the scene out of what the model sees.
export const ART_STYLE_TEXT_MAX = 200;

export type ImageRequest = {
  needed: boolean;
  prompt?: string;
  mode?: ImageMode;
  backend?: ImageBackend;
  aspect?: AspectPreset;
  reason?: string;
  characterIds?: string[];
  // Why the picture could not be made, once it could not (needed is then
  // false). The failure itself is only an ephemeral media_status, so this is
  // what a reload or a late joiner reads instead of a placeholder that spins.
  failed?: string;
};

export type GeneratedImage = {
  id: string;
  url: string;
  prompt: string;
  mode: ImageMode;
  backend?: ImageBackend;
  aspect: AspectPreset;
  width: number;
  height: number;
  elapsedSeconds?: number;
  seed?: number;
  warnings?: string[];
};

export type StorySettings = {
  world: string;
  style: string;
  textProvider: TextProvider;
  localTextModel: LocalTextModelId;
  // Any OpenAI-compatible backend (llama.cpp, LM Studio, vLLM, OpenRouter, a
  // remote Ollama). Set in-app. The key is optional and stored locally; most
  // local servers need none, and it falls back to env when blank.
  customBaseUrl: string;
  customModel: string;
  customApiKey: string;
  // OPTIONAL second model for mechanical work: history compaction, chapter
  // summaries and fact extraction, world-arc ticks, lore checks, and Ask
  // answers. None of it is narration, so a small fast model does it well
  // while the story model keeps its weights and prompt cache resident.
  //
  // Leave utilityModel empty to disable. Every one of those calls then falls
  // back to the story model and the app behaves exactly as it did before, so
  // a machine that can only hold one model loses nothing.
  utilityProvider: TextProvider;
  utilityModel: string;
  utilityBaseUrl: string;
  utilityApiKey: string;
  imageMode: ImageMode;
  imageBackend: ImageBackend;
  // ComfyUI backend: server URL and checkpoint filename. Both optional —
  // URL falls back to COMFYUI_URL env then http://127.0.0.1:8188, and an
  // empty checkpoint uses the first one ComfyUI reports.
  comfyUrl: string;
  comfyCheckpoint: string;
  aspect: AspectPreset;
  imageGenerationEnabled: boolean;
  autoImages: boolean;
  // How the maps and scene pictures look. "custom" reads the two texts; an
  // empty one keeps the setting's style for that kind of picture.
  artStyle: ArtStyle;
  artStyleMap: string;
  artStyleScene: string;
  proseSize: ProseSize;
};
