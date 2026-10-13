import type { ComfyFile, ComfyModel } from "./types.ts";
import {
  AE,
  CLIP_L,
  FLUX2_VAE,
  QWEN25_VL_7B,
  QWEN3_4B,
  QWEN3_8B,
  QWEN3VL_4B,
  QWEN3VL_8B,
  QWEN_IMAGE_VAE,
  T5XXL,
  diffusionFile,
  loraFile,
} from "./files.ts";
import { MORE_MODELS } from "./catalog-more.ts";

// Every image model ODM can paint with on ComfyUI, from ComfyUI's own
// workflow templates (comfyui-workflow-templates 0.11.78, ComfyUI 0.39.2).
// Each graph is the template's text-to-image path with the prompt rewriting
// and preview nodes left out: ODM's storyteller already writes the prompt.
// What each one costs on real hardware is in verified.json.

const HF = "https://huggingface.co";

const QWEN21_TE: ComfyFile = {
  ...QWEN3VL_8B,
  names: ["qwen3vl_8b_int8_convrot.safetensors", "qwen3vl_8b_bf16.safetensors", "qwen3vl_8b_w4a8.safetensors"],
  url: `${HF}/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/qwen3vl_8b_int8_convrot.safetensors`,
  sizeGb: 9.35,
};

const QWEN21_VAE: ComfyFile = {
  folder: "vae",
  names: ["qwen_image_2.1_vae_bf16.safetensors"],
  family: /qwen[-_ ]?image[-_ ]?2\.1.*vae/i,
  url: `${HF}/Comfy-Org/Qwen-Image-2.1/resolve/main/vae/qwen_image_2.1_vae_bf16.safetensors`,
  sizeGb: 0.68,
  what: "the Qwen Image 2.1 VAE (models/vae)",
};

const FLUX1_CLIPS = { node: "DualCLIPLoader", type: "flux", slots: ["clip_l", "t5"] } as const;

const HIDREAM_FILES = {
  clip_l: { ...CLIP_L, names: ["clip_l_hidream.safetensors"], family: /clip[-_ ]?l[-_ ]?hidream/i, url: `${HF}/Comfy-Org/HiDream-I1_ComfyUI/resolve/main/split_files/text_encoders/clip_l_hidream.safetensors`, what: "HiDream's CLIP-L (models/text_encoders)" },
  clip_g: {
    folder: "text_encoders",
    names: ["clip_g_hidream.safetensors"],
    family: /clip[-_ ]?g[-_ ]?hidream/i,
    url: `${HF}/Comfy-Org/HiDream-I1_ComfyUI/resolve/main/split_files/text_encoders/clip_g_hidream.safetensors`,
    sizeGb: 1.39,
    what: "HiDream's CLIP-G (models/text_encoders)",
  },
  t5: T5XXL,
  llama: {
    folder: "text_encoders",
    names: ["llama_3.1_8b_instruct_fp8_scaled.safetensors"],
    family: /llama[-_ ]?3\.1[-_ ]?8b/i,
    url: `${HF}/Comfy-Org/HiDream-I1_ComfyUI/resolve/main/split_files/text_encoders/llama_3.1_8b_instruct_fp8_scaled.safetensors`,
    sizeGb: 9.08,
    what: "the Llama 3.1 8B text encoder (models/text_encoders)",
  },
  vae: AE,
} satisfies Record<string, ComfyFile>;

const HIDREAM_CLIPS = { node: "QuadrupleCLIPLoader", slots: ["clip_l", "clip_g", "t5", "llama"] } as const;

function hidream(variant: "fast" | "dev" | "full", steps: number, cfg: number, sampler: string, scheduler: string, shift: number, blurb: string): ComfyModel {
  const name = variant[0].toUpperCase() + variant.slice(1);
  return {
    id: `hidream_i1_${variant}`,
    label: `HiDream-I1 ${name}`,
    family: "HiDream",
    maker: "HiDream.ai",
    license: "MIT",
    released: "2025-04",
    blurb,
    files: {
      unet: diffusionFile(
        [`hidream_i1_${variant}_fp8.safetensors`, `hidream_i1_${variant}_bf16.safetensors`],
        new RegExp(`hidream[-_ ]?i1[-_ ]?${variant}`, "i"),
        `${HF}/Comfy-Org/HiDream-I1_ComfyUI/resolve/main/split_files/diffusion_models/hidream_i1_${variant}_fp8.safetensors`,
        17.11,
        `the HiDream-I1 ${name} model`,
      ),
      ...HIDREAM_FILES,
    },
    graph: {
      load: { unet: "unet", clip: HIDREAM_CLIPS, vae: "vae" },
      modelPatches: [{ node: "ModelSamplingSD3", inputs: { shift } }],
      negative: "text",
      latent: "EmptySD3LatentImage",
      sampler: { kind: "ksampler", steps, cfg, sampler, scheduler },
    },
  };
}

export const COMFY_MODELS: readonly ComfyModel[] = [
  {
    id: "z_turbo",
    label: "Z-Image Turbo",
    family: "Z-Image",
    maker: "Alibaba Tongyi-MAI",
    license: "Apache-2.0",
    released: "2025-11",
    blurb: "6B, distilled to 8 steps. Quick, sharp, photographic; writes legible text.",
    files: {
      unet: diffusionFile(
        ["z_image_turbo_bf16.safetensors", "z_image_turbo_int8_convrot.safetensors"],
        /z[-_ ]?image[-_ ]?turbo/i,
        `${HF}/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors`,
        12.31,
        "the Z-Image Turbo model",
      ),
      clip: QWEN3_4B,
      vae: AE,
    },
    graph: {
      load: { unet: "unet", clip: { node: "CLIPLoader", type: "lumina2", slots: ["clip"] }, vae: "vae" },
      modelPatches: [{ node: "ModelSamplingAuraFlow", inputs: { shift: 3, sampling: "flow" } }],
      negative: "zero",
      latent: "EmptySD3LatentImage",
      sampler: { kind: "ksampler", steps: 8, cfg: 1, sampler: "res_multistep", scheduler: "beta" },
    },
  },
  {
    id: "z_image",
    label: "Z-Image",
    family: "Z-Image",
    maker: "Alibaba Tongyi-MAI",
    license: "Apache-2.0",
    released: "2026-01",
    blurb: "The undistilled 6B base: 25 steps with a real negative prompt.",
    files: {
      unet: diffusionFile(
        ["z_image_int8_convrot.safetensors", "z_image_bf16.safetensors"],
        /z[-_ ]?image(?![-_ ]?(turbo|edit|omni))/i,
        `${HF}/Comfy-Org/z_image/resolve/main/split_files/diffusion_models/z_image_int8_convrot.safetensors`,
        6.2,
        "the Z-Image model",
      ),
      clip: QWEN3_4B,
      vae: AE,
    },
    graph: {
      load: { unet: "unet", clip: { node: "CLIPLoader", type: "lumina2", slots: ["clip"] }, vae: "vae" },
      modelPatches: [{ node: "ModelSamplingAuraFlow", inputs: { shift: 3 } }],
      negative: "text",
      latent: "EmptySD3LatentImage",
      sampler: { kind: "ksampler", steps: 25, cfg: 4, sampler: "res_multistep", scheduler: "simple" },
    },
  },
  {
    id: "qwen_image_21",
    label: "Qwen Image 2.1",
    family: "Qwen Image",
    maker: "Alibaba Qwen",
    license: "Qwen Research License",
    released: "2026-09",
    blurb: "Qwen's 2026 model in int8: strong composition and prompt following, 25 steps.",
    files: {
      unet: diffusionFile(
        ["qwen_image_2.1_int8_convrot.safetensors", "qwen_image_2.1_bf16.safetensors"],
        /qwen[-_ ]?image[-_ ]?2\.1(?![-_ ]?turbo)(?!.*(controlnet|vae))/i,
        `${HF}/Comfy-Org/Qwen-Image-2.1/resolve/main/diffusion_models/qwen_image_2.1_int8_convrot.safetensors`,
        7.26,
        "the Qwen Image 2.1 model",
      ),
      clip: QWEN21_TE,
      vae: QWEN21_VAE,
    },
    graph: {
      load: { unet: "unet", clip: { node: "CLIPLoader", type: "qwen_image", slots: ["clip"] }, vae: "vae" },
      modelPatches: [{ node: "QwenImage21Cache", inputs: { device: "auto", dtype: "default" } }],
      encode: "qwen-image-21",
      negative: "zero",
      latent: "EmptyLatentImage",
      sampler: { kind: "ksampler", steps: 25, cfg: 1, sampler: "euler", scheduler: "simple" },
    },
  },
  {
    id: "qwen_image_21_turbo",
    label: "Qwen Image 2.1 Turbo",
    family: "Qwen Image",
    maker: "Alibaba Qwen",
    license: "Qwen Research License",
    released: "2026-09",
    blurb: "Qwen Image 2.1 distilled to 8 steps: the same encoder at a third of the time.",
    files: {
      unet: diffusionFile(
        ["qwen_image_2.1_turbo_int8_convrot.safetensors", "qwen_image_2.1_turbo_bf16.safetensors"],
        /qwen[-_ ]?image[-_ ]?2\.1[-_ ]?turbo(?!.*lora)/i,
        `${HF}/Comfy-Org/Qwen-Image-2.1/resolve/main/diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors`,
        7.26,
        "the Qwen Image 2.1 Turbo model",
      ),
      clip: QWEN21_TE,
      vae: QWEN21_VAE,
    },
    graph: {
      load: { unet: "unet", clip: { node: "CLIPLoader", type: "qwen_image", slots: ["clip"] }, vae: "vae" },
      modelPatches: [{ node: "QwenImage21Cache", inputs: { device: "auto", dtype: "default" } }],
      encode: "qwen-image-21",
      negative: "zero",
      latent: "EmptyLatentImage",
      sampler: { kind: "ksampler", steps: 8, cfg: 1, sampler: "euler", scheduler: "simple" },
    },
  },
  {
    id: "qwen_image",
    label: "Qwen-Image 2512",
    family: "Qwen Image",
    maker: "Alibaba Qwen",
    license: "Apache-2.0",
    released: "2025-12",
    blurb: "The 20B Qwen-Image, December 2025 weights, with a real negative prompt.",
    files: {
      unet: diffusionFile(
        ["qwen_image_2512_fp8_e4m3fn.safetensors", "qwen_image_2512_bf16.safetensors", "qwen_image_fp8_e4m3fn.safetensors"],
        /qwen[-_ ]?image(?![-_ ]?(2\.1|edit|layered|vae|distill))/i,
        `${HF}/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors`,
        20.43,
        "the Qwen-Image model",
      ),
      clip: QWEN25_VL_7B,
      vae: QWEN_IMAGE_VAE,
    },
    graph: {
      load: { unet: "unet", clip: { node: "CLIPLoader", type: "qwen_image", slots: ["clip"] }, vae: "vae" },
      modelPatches: [{ node: "ModelSamplingAuraFlow", inputs: { shift: 3.1 } }],
      negative: "text",
      latent: "EmptySD3LatentImage",
      sampler: { kind: "ksampler", steps: 20, cfg: 2.5, sampler: "euler", scheduler: "simple" },
    },
  },
  {
    id: "qwen_image_lightning",
    label: "Qwen-Image 2512 Lightning",
    family: "Qwen Image",
    maker: "Alibaba Qwen, lightx2v",
    license: "Apache-2.0",
    released: "2025-12",
    blurb: "Qwen-Image 2512 with the 4-step Lightning LoRA: the 20B model at turbo speed.",
    files: {
      unet: diffusionFile(
        ["qwen_image_2512_fp8_e4m3fn.safetensors", "qwen_image_2512_bf16.safetensors"],
        /qwen[-_ ]?image[-_ ]?2512/i,
        `${HF}/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors`,
        20.43,
        "the Qwen-Image 2512 model",
      ),
      clip: QWEN25_VL_7B,
      vae: QWEN_IMAGE_VAE,
      lora: loraFile(
        ["Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors", "Qwen-Image-2512-Lightning-4steps-V1.0-bf16.safetensors"],
        `${HF}/lightx2v/Qwen-Image-2512-Lightning/resolve/main/Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors`,
        1.7,
        "the Qwen-Image 2512 Lightning 4-step LoRA",
      ),
    },
    graph: {
      load: { unet: "unet", clip: { node: "CLIPLoader", type: "qwen_image", slots: ["clip"] }, vae: "vae" },
      loras: [{ slot: "lora", strength: 1 }],
      modelPatches: [{ node: "ModelSamplingAuraFlow", inputs: { shift: 3.1 } }],
      negative: "zero",
      latent: "EmptySD3LatentImage",
      sampler: { kind: "ksampler", steps: 4, cfg: 1, sampler: "euler", scheduler: "simple" },
    },
  },
  {
    id: "krea2_turbo",
    label: "Krea-2 Turbo",
    family: "Krea",
    maker: "Krea",
    license: "Krea-2 Community License",
    released: "2026-06",
    blurb: "Krea's 2026 model distilled to 8 steps: painterly, strong on style.",
    files: {
      unet: diffusionFile(
        ["krea2_turbo_int8_convrot.safetensors", "krea2_turbo_fp8_scaled.safetensors", "krea2_turbo_bf16.safetensors"],
        /krea[-_ ]?2[-_ ]?turbo(?!.*lora)/i,
        `${HF}/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_turbo_int8_convrot.safetensors`,
        13.49,
        "the Krea-2 Turbo model",
      ),
      clip: QWEN3VL_4B,
      vae: QWEN_IMAGE_VAE,
    },
    graph: {
      load: { unet: "unet", clip: { node: "CLIPLoader", type: "krea2", slots: ["clip"] }, vae: "vae" },
      negative: "zero",
      latent: "EmptyLatentImage",
      sampler: { kind: "ksampler", steps: 8, cfg: 1, sampler: "euler", scheduler: "simple" },
    },
  },
  {
    id: "flux1_schnell",
    label: "FLUX.1 schnell",
    family: "FLUX.1",
    maker: "Black Forest Labs",
    license: "Apache-2.0",
    released: "2024-08",
    blurb: "12B, 4 steps. The painter behind ODM's own map and token art.",
    files: {
      unet: diffusionFile(
        ["flux1-schnell.safetensors", "flux1-schnell-fp8.safetensors"],
        /flux[-_ ]?1?[-_ ]?schnell/i,
        `${HF}/Comfy-Org/flux1-schnell/resolve/main/flux1-schnell.safetensors`,
        23.78,
        "the FLUX.1 schnell model",
      ),
      clip_l: CLIP_L,
      t5: T5XXL,
      vae: AE,
    },
    graph: {
      load: { unet: "unet", clip: FLUX1_CLIPS, vae: "vae" },
      negative: "zero",
      latent: "EmptySD3LatentImage",
      sampler: { kind: "ksampler", steps: 4, cfg: 1, sampler: "euler", scheduler: "simple" },
    },
  },
  {
    id: "flux1_dev",
    label: "FLUX.1 dev",
    family: "FLUX.1",
    maker: "Black Forest Labs",
    license: "FLUX.1 [dev] Non-Commercial License",
    released: "2024-08",
    blurb: "12B guidance-distilled, 20 steps. Detailed; non-commercial weights.",
    files: {
      unet: diffusionFile(
        ["flux1-dev.safetensors", "flux1-dev-fp8.safetensors"],
        /flux[-_ ]?1?[-_ ]?dev(?!.*(fill|canny|depth|kontext|krea|redux))/i,
        `${HF}/Comfy-Org/flux1-dev/resolve/main/flux1-dev.safetensors`,
        23.8,
        "the FLUX.1 dev model",
      ),
      clip_l: CLIP_L,
      t5: T5XXL,
      vae: AE,
    },
    graph: {
      load: { unet: "unet", clip: FLUX1_CLIPS, vae: "vae" },
      negative: "zero",
      guidance: 3.5,
      latent: "EmptySD3LatentImage",
      sampler: { kind: "ksampler", steps: 20, cfg: 1, sampler: "euler", scheduler: "simple" },
    },
  },
  {
    id: "flux1_krea_dev",
    label: "FLUX.1 Krea dev",
    family: "FLUX.1",
    maker: "Black Forest Labs, Krea",
    license: "FLUX.1 [dev] Non-Commercial License",
    released: "2025-07",
    blurb: "FLUX.1 dev retrained by Krea for natural, less glossy pictures.",
    files: {
      unet: diffusionFile(
        ["flux1-krea-dev_fp8_scaled.safetensors", "flux1-krea-dev.safetensors"],
        /flux[-_ ]?1?[-_ ]?krea/i,
        `${HF}/Comfy-Org/FLUX.1-Krea-dev_ComfyUI/resolve/main/split_files/diffusion_models/flux1-krea-dev_fp8_scaled.safetensors`,
        11.9,
        "the FLUX.1 Krea dev model",
      ),
      clip_l: CLIP_L,
      t5: T5XXL,
      vae: AE,
    },
    graph: {
      load: { unet: "unet", clip: FLUX1_CLIPS, vae: "vae" },
      negative: "zero",
      guidance: 3.5,
      latent: "EmptySD3LatentImage",
      sampler: { kind: "ksampler", steps: 20, cfg: 1, sampler: "euler", scheduler: "simple" },
    },
  },
  {
    id: "flux2_dev",
    label: "FLUX.2 dev",
    family: "FLUX.2",
    maker: "Black Forest Labs",
    license: "FLUX [dev] Non-Commercial License",
    released: "2025-11",
    blurb: "32B with a 24B Mistral encoder, 20 steps. The heaviest model here.",
    files: {
      unet: diffusionFile(
        ["flux2_dev_fp8mixed.safetensors"],
        /flux[-_ ]?2[-_ ]?dev/i,
        `${HF}/Comfy-Org/flux2-dev/resolve/main/split_files/diffusion_models/flux2_dev_fp8mixed.safetensors`,
        35.46,
        "the FLUX.2 dev model",
      ),
      clip: {
        folder: "text_encoders",
        names: ["mistral_3_small_flux2_fp8.safetensors", "mistral_3_small_flux2_bf16.safetensors", "mistral_3_small_flux2_fp4_mixed.safetensors"],
        family: /mistral[-_ ]?3[-_ ]?small[-_ ]?flux2/i,
        url: `${HF}/Comfy-Org/flux2-dev/resolve/main/split_files/text_encoders/mistral_3_small_flux2_fp8.safetensors`,
        sizeGb: 18.03,
        what: "the Mistral Small 3 text encoder (models/text_encoders)",
      },
      vae: FLUX2_VAE,
    },
    graph: {
      load: { unet: "unet", clip: { node: "CLIPLoader", type: "flux2", slots: ["clip"] }, vae: "vae" },
      negative: "zero",
      guidance: 4,
      latent: "EmptyFlux2LatentImage",
      sampler: { kind: "advanced", guider: { node: "BasicGuider" }, sampler: "euler", sigmas: { node: "Flux2Scheduler", steps: 20 } },
    },
  },
  {
    id: "flux2_klein_4b",
    label: "FLUX.2 [klein] 4B",
    family: "FLUX.2",
    maker: "Black Forest Labs",
    license: "Apache-2.0",
    released: "2026-01",
    blurb: "4B distilled to 4 steps, on the same Qwen 3 4B encoder as Z-Image.",
    files: {
      unet: diffusionFile(
        ["flux-2-klein-4b.safetensors", "flux-2-klein-4b-fp8.safetensors"],
        /flux[-_ ]?2[-_ ]?klein[-_ ]?4b(?!.*base)/i,
        `${HF}/Comfy-Org/flux2-klein/resolve/main/split_files/diffusion_models/flux-2-klein-4b.safetensors`,
        7.75,
        "the FLUX.2 klein 4B model",
      ),
      clip: QWEN3_4B,
      vae: FLUX2_VAE,
    },
    graph: {
      load: { unet: "unet", clip: { node: "CLIPLoader", type: "flux2", slots: ["clip"] }, vae: "vae" },
      negative: "zero",
      latent: "EmptyFlux2LatentImage",
      sampler: { kind: "advanced", guider: { node: "CFGGuider", cfg: 1 }, sampler: "euler", sigmas: { node: "Flux2Scheduler", steps: 4 } },
    },
  },
  {
    id: "flux2_klein_4b_base",
    label: "FLUX.2 [klein] 4B Base",
    family: "FLUX.2",
    maker: "Black Forest Labs",
    license: "Apache-2.0",
    released: "2026-01",
    blurb: "The undistilled klein 4B: 20 steps with a real negative prompt.",
    files: {
      unet: diffusionFile(
        ["flux-2-klein-base-4b.safetensors", "flux-2-klein-base-4b-fp8.safetensors"],
        /flux[-_ ]?2[-_ ]?klein[-_ ]?base[-_ ]?4b/i,
        `${HF}/Comfy-Org/flux2-klein/resolve/main/split_files/diffusion_models/flux-2-klein-base-4b.safetensors`,
        7.75,
        "the FLUX.2 klein base 4B model",
      ),
      clip: QWEN3_4B,
      vae: FLUX2_VAE,
    },
    graph: {
      load: { unet: "unet", clip: { node: "CLIPLoader", type: "flux2", slots: ["clip"] }, vae: "vae" },
      negative: "text",
      latent: "EmptyFlux2LatentImage",
      sampler: { kind: "advanced", guider: { node: "CFGGuider", cfg: 5 }, sampler: "euler", sigmas: { node: "Flux2Scheduler", steps: 20 } },
    },
  },
  {
    id: "flux2_klein_9b",
    label: "FLUX.2 [klein] 9B",
    family: "FLUX.2",
    maker: "Black Forest Labs",
    license: "FLUX Non-Commercial License",
    released: "2026-01",
    blurb: "9B distilled to 4 steps on a Qwen 3 8B encoder; non-commercial weights.",
    files: {
      unet: diffusionFile(
        ["flux-2-klein-9b-fp8.safetensors", "flux-2-klein-9b.safetensors"],
        /flux[-_ ]?2[-_ ]?klein[-_ ]?9b(?!.*base)/i,
        `${HF}/black-forest-labs/FLUX.2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors`,
        9.43,
        "the FLUX.2 klein 9B model",
      ),
      clip: QWEN3_8B,
      vae: FLUX2_VAE,
    },
    graph: {
      load: { unet: "unet", clip: { node: "CLIPLoader", type: "flux2", slots: ["clip"] }, vae: "vae" },
      negative: "zero",
      latent: "EmptyFlux2LatentImage",
      sampler: { kind: "advanced", guider: { node: "CFGGuider", cfg: 1 }, sampler: "euler", sigmas: { node: "Flux2Scheduler", steps: 4 } },
    },
  },
  {
    id: "chroma1_hd",
    label: "Chroma1-HD",
    family: "Chroma",
    maker: "Lodestone Rock",
    license: "Apache-2.0",
    released: "2025-08",
    blurb: "8.9B FLUX.1 schnell derivative, uncensored, 26 steps with a real negative.",
    files: {
      unet: diffusionFile(
        ["Chroma1-HD-fp8mixed.safetensors", "Chroma1-HD.safetensors"],
        /chroma1?[-_ ]?hd/i,
        `${HF}/Comfy-Org/Chroma1-HD_repackaged/resolve/main/split_files/diffusion_models/Chroma1-HD-fp8mixed.safetensors`,
        9.19,
        "the Chroma1-HD model",
      ),
      t5: T5XXL,
      vae: AE,
    },
    graph: {
      load: { unet: "unet", clip: { node: "CLIPLoader", type: "chroma", slots: ["t5"] }, vae: "vae" },
      clipPatches: [{ node: "T5TokenizerOptions", inputs: { min_padding: 0, min_length: 0 } }],
      modelPatches: [{ node: "ModelSamplingAuraFlow", inputs: { shift: 1 } }],
      negative: "text",
      latent: "EmptySD3LatentImage",
      sampler: { kind: "advanced", guider: { node: "CFGGuider", cfg: 3.5 }, sampler: "euler", sigmas: { node: "BasicScheduler", scheduler: "beta", steps: 26 } },
    },
  },
  {
    id: "chroma1_radiance",
    label: "Chroma1-Radiance",
    family: "Chroma",
    maker: "Lodestone Rock",
    license: "Apache-2.0",
    released: "2025-09",
    blurb: "Chroma painting pixels directly, no VAE: 30 steps.",
    files: {
      unet: diffusionFile(
        ["chroma-radiance-x0.safetensors"],
        /chroma.*radiance/i,
        `${HF}/Comfy-Org/Chroma1-Radiance_Repackaged/resolve/main/split_files/diffusion_models/chroma-radiance-x0.safetensors`,
        19.01,
        "the Chroma1-Radiance model",
      ),
      t5: T5XXL,
    },
    graph: {
      load: { unet: "unet", clip: { node: "CLIPLoader", type: "chroma", slots: ["t5"] }, vae: "pixel_space" },
      clipPatches: [{ node: "T5TokenizerOptions", inputs: { min_padding: 0, min_length: 0 } }],
      modelPatches: [
        { node: "ChromaRadianceOptions", inputs: { preserve_wrapper: true, start_sigma: 1, end_sigma: 0, nerf_tile_size: -1, force_sequential_txt_ids: false } },
        { node: "ModelSamplingAuraFlow", inputs: { shift: 1 } },
      ],
      negative: "text",
      latent: "EmptyChromaRadianceLatentImage",
      sampler: {
        kind: "advanced",
        guider: { node: "CFGGuider", cfg: 3.5 },
        sampler: "euler",
        sigmas: { node: "BetaSamplingScheduler", steps: 30, alpha: 0.4, beta: 0.4 },
      },
    },
  },
  hidream("fast", 16, 1, "lcm", "normal", 3, "17B with four encoders (Llama 3.1 8B among them), 16 steps."),
  hidream("dev", 28, 1, "lcm", "normal", 6, "HiDream-I1 at 28 steps: more detail than Fast at nearly twice the time."),
  hidream("full", 50, 5, "uni_pc", "simple", 3, "The undistilled HiDream-I1: 50 steps with a real negative prompt."),
  ...MORE_MODELS,
];

export function comfyModel(id: string): ComfyModel | undefined {
  return COMFY_MODELS.find((model) => model.id === id);
}

// images.comfyWorkflowPreset: "checkpoint" paints with each campaign's
// checkpoint; any catalog id paints every campaign's pictures with that model.
export const CHECKPOINT_PRESET = "checkpoint";

export function isComfyPreset(value: string): boolean {
  return value === CHECKPOINT_PRESET || COMFY_MODELS.some((model) => model.id === value);
}

// A checkpoint the catalog does not know: the settings ODM always used.
export const ANY_CHECKPOINT: ComfyModel = {
  id: CHECKPOINT_PRESET,
  label: "Checkpoint",
  family: "Checkpoint",
  maker: "",
  license: "",
  released: "",
  blurb: "Any checkpoint ComfyUI lists, with SDXL-era settings.",
  files: {
    ckpt: { folder: "checkpoints", names: [], url: "", sizeGb: 0, what: "a checkpoint (models/checkpoints)" },
  },
  graph: {
    load: { checkpoint: "ckpt" },
    negative: "text",
    latent: "EmptyLatentImage",
    sampler: { kind: "ksampler", steps: 25, cfg: 6, sampler: "euler", scheduler: "normal" },
  },
};
