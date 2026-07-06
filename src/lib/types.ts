import type { LocalTextModelId, TextProvider } from "@/lib/text-models";

export type StoryRole = "user" | "assistant";

export type AspectPreset = "square" | "portrait" | "landscape";

export type ImageMode = "fast" | "slow";

export type ImageBackend = "mflux-hs" | "sdnq-hs" | "comfyui";

export const IMAGE_BACKENDS = ["mflux-hs", "sdnq-hs", "comfyui"] as const;

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

export type Attachment = {
  id: string;
  name: string;
  type: string;
  url: string;
  dataUrl?: string;
};

export type ImageRequest = {
  needed: boolean;
  prompt?: string;
  mode?: ImageMode;
  backend?: ImageBackend;
  aspect?: AspectPreset;
  reason?: string;
  characterIds?: string[];
};

export type StoryMessage = {
  id: string;
  role: StoryRole;
  content: string;
  createdAt: string;
  attachments?: Attachment[];
  imageRequest?: ImageRequest;
  generatedImage?: GeneratedImage;
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
  proseSize: ProseSize;
};

export type StoryChatSummary = {
  id: string;
  title: string;
  settings: StorySettings;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview?: string;
};

export type StoryChat = StoryChatSummary & {
  messages: StoryMessage[];
  characters: StoryCharacter[];
};

export type StoryCharacter = {
  id: string;
  chatId: string;
  name: string;
  details: string;
  inventory: string;
  skills: string;
  spells: string;
  portrait?: Attachment;
  createdAt: string;
  updatedAt: string;
};
