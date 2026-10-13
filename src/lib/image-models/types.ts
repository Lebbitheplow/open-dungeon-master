// The ComfyUI image models ODM knows how to paint with: the files each one
// needs, where they download from, and the graph it runs. Pure data, so the
// server (src/lib/comfyui.ts), the setup wizard and
// scripts/bench-image-models.mjs build the very same workflow.

// The ComfyUI models/ folders a catalog file lives in.
export type ComfyFolder = "checkpoints" | "diffusion_models" | "text_encoders" | "vae" | "loras";

// The loader node whose declared input lists each folder's files. UNETLoader
// also lists models/unet, and CLIPLoader models/clip.
export const FOLDER_LOADER: Record<ComfyFolder, { node: string; input: string }> = {
  checkpoints: { node: "CheckpointLoaderSimple", input: "ckpt_name" },
  diffusion_models: { node: "UNETLoader", input: "unet_name" },
  text_encoders: { node: "CLIPLoader", input: "clip_name" },
  vae: { node: "VAELoader", input: "vae_name" },
  loras: { node: "LoraLoaderModelOnly", input: "lora_name" },
};

export type ComfyFile = {
  folder: ComfyFolder;
  // Accepted file names, the official download first. Matched on the file
  // name alone, so a copy kept in a subfolder counts.
  names: readonly string[];
  // Other precisions or renames of the same weights (fp8, int8, a fine-tune).
  family?: RegExp;
  // Where names[0] downloads from, and its size.
  url: string;
  sizeGb: number;
  // Worded for the admin: "the Z-Image Turbo model".
  what: string;
};

// A node input's value. "$width" and "$height" become the picture's size.
export type GraphValue = string | number | boolean;

// A node that takes `model` (or `clip`) and returns one, applied in order.
export type GraphPatch = { node: string; inputs: Record<string, GraphValue> };

export type ClipLoad =
  | { node: "CLIPLoader"; type: string; slots: readonly [string] }
  | { node: "DualCLIPLoader"; type: string; slots: readonly [string, string] }
  | { node: "QuadrupleCLIPLoader"; slots: readonly [string, string, string, string] };

export type GraphLoad =
  // CheckpointLoaderSimple: model, text encoder and VAE in one file.
  | { checkpoint: string }
  // UNETLoader + a CLIP loader + VAELoader ("pixel_space" for models that
  // paint pixels directly).
  | { unet: string; clip: ClipLoad; vae: string | "pixel_space" };

export type LatentNode =
  | "EmptyLatentImage"
  | "EmptySD3LatentImage"
  | "EmptyFlux2LatentImage"
  | "EmptyChromaRadianceLatentImage"
  | "EmptyHunyuanImageLatent"
  | "EmptyHunyuanVideo15Latent"
  | "EmptyHiDreamO1LatentImage";

export type SigmasSpec =
  | { node: "Flux2Scheduler"; steps: number }
  | { node: "BasicScheduler"; scheduler: string; steps: number }
  | { node: "BetaSamplingScheduler"; steps: number; alpha: number; beta: number }
  | { node: "Ideogram4Scheduler"; steps: number; mu: number; std: number };

export type GuiderSpec =
  | { node: "CFGGuider"; cfg: number }
  | { node: "BasicGuider" }
  | { node: "DualCFGGuider"; cfgConds: number; cfgCond2Negative: number }
  // A second diffusion model scores the unconditional pass (Ideogram 4).
  | { node: "DualModelGuider"; cfg: number; negativeUnet: string };

export type SamplerSpec =
  | { kind: "ksampler"; steps: number; cfg: number; sampler: string; scheduler: string }
  // SamplerCustomAdvanced: noise + guider + sampler + sigmas.
  | { kind: "advanced"; guider: GuiderSpec; sampler: string | GraphPatch; sigmas: SigmasSpec }
  // SamplerCustom: one cfg, positive and negative, sampler + sigmas.
  | { kind: "custom"; cfg: number; sampler: string | GraphPatch; sigmas: SigmasSpec };

export type GraphRecipe = {
  load: GraphLoad;
  loras?: ReadonlyArray<{ slot: string; strength: number }>;
  // Applied to the text encoder (CLIPSetLastLayer, T5TokenizerOptions).
  clipPatches?: readonly GraphPatch[];
  // Applied to the diffusion model before sampling (ModelSamplingAuraFlow,
  // CFGNorm, a cache).
  modelPatches?: readonly GraphPatch[];
  // How the prompt becomes conditioning. "text" is CLIPTextEncode; the others
  // are a model's own encoder node, which also takes the negative.
  encode?: "text" | "qwen-image-21" | "mage-flow";
  // Words some models need ahead of every prompt (Lumina's system prompt,
  // Pony's score tags).
  prefix?: string;
  // A model trained on structured captions gets the prompt wrapped in one:
  // Ideogram 4's safety filter blocks most plain-text prompts.
  promptFormat?: "ideogram4-json";
  // "text" encodes ODM's negative prompt; "zero" zeroes the positive, for
  // models distilled to run without one.
  negative: "text" | "zero";
  // FluxGuidance on the positive (and the negative, when both is set).
  guidance?: number;
  guidanceOnNegative?: boolean;
  latent: LatentNode;
  sampler: SamplerSpec;
  // The long side ODM asks for, when the model wants other than 1024/1344,
  // and the multiple both sides round to.
  longSide?: { fast: number; slow: number };
  multiple?: number;
};

export type ComfyModel = {
  // Stored as images.comfyWorkflowPreset when the admin picks it.
  id: string;
  label: string;
  family: string;
  maker: string;
  license: string;
  // YYYY-MM the weights came out.
  released: string;
  // One line for the picker: what it is good at, what it costs.
  blurb: string;
  // A specialist look; anime models paint anime whatever the genre asks.
  style?: "anime";
  files: Record<string, ComfyFile>;
  graph: GraphRecipe;
};

// The files a ComfyUI has for one model, keyed like ComfyModel.files; ""
// for each one it lacks.
export type ModelFiles = Record<string, string>;
