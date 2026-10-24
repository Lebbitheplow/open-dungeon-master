import type { StorySettings } from "@/lib/types";

export const DEFAULT_STORY_SETTINGS: StorySettings = {
  world:
    "A grounded interactive fiction scene with sharp dialogue, human stakes, and space for the player to steer the story.",
  style:
    "Classic text-adventure narration: direct second person, vivid but restrained prose, natural dialogue, and no purple exposition.",
  // The shipped backend is a llama-server on :8001 (docs/text-backends.md),
  // reached through its OpenAI-compatible /v1 endpoint. No model is named
  // here: the admin picks one from what the server lists (the guided setup
  // or Admin > Text model defaults), and a server that lists exactly one
  // chat model runs that one unasked (src/lib/model-registry). The legacy
  // Ollama-native "local" provider stays selectable. Any API key comes from
  // .env.server, never code; llama-server ignores auth headers.
  textProvider: "custom",
  localTextModel: "",
  customBaseUrl: "http://127.0.0.1:8001/v1",
  customModel: "",
  customApiKey: "",
  // OFF by default: a second model is a hardware luxury, so the shipped
  // default keeps everything on the story model. Set utilityModel in the
  // campaign's model settings to split the mechanical work off. Named alone,
  // it runs on the storyteller's own llama.cpp (or other OpenAI-compatible)
  // server; an address of its own puts it on another machine, and Ollama is
  // there for a table that runs one.
  utilityProvider: "custom",
  utilityModel: "",
  utilityBaseUrl: "",
  utilityApiKey: "",
  imageMode: "fast",
  // Pictures go through the local ComfyUI (empty comfyUrl falls back to
  // COMFYUI_URL / http://127.0.0.1:8188). The checkpoint is the admin's pick
  // from what that ComfyUI has installed (Admin > Images): none is named
  // here, and none is guessed from its list.
  imageBackend: "comfyui",
  comfyUrl: "",
  comfyCheckpoint: "",
  aspect: "square",
  imageGenerationEnabled: true,
  autoImages: true,
  // The genre's or world pack's own look, which is what every campaign made
  // before the choice existed already had.
  artStyle: "setting",
  artStyleMap: "",
  artStyleScene: "",
  proseSize: "medium",
};
