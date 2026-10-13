import type { ComfyModel, GraphPatch, GraphValue, GuiderSpec, ModelFiles, SigmasSpec } from "./types.ts";

// One catalog model's ComfyUI API graph for one picture. The server
// (src/lib/comfyui.ts) and scripts/bench-image-models.mjs both build through
// here, so a measured time is the time of the graph ODM really sends.

// Kept out of every picture whose model honours a negative prompt; a
// table's boundary adds its own words after these.
export const DEFAULT_NEGATIVE =
  "text, watermark, signature, low quality, jpeg artifacts, deformed hands, extra fingers";

// The long side of ODM's two picture modes, for models without their own.
// Checkpoint-era models train at 1024 and degrade past ~1.5K.
export const DEFAULT_LONG_SIDE = { fast: 1024, slow: 1344 } as const;

export type PictureMode = keyof typeof DEFAULT_LONG_SIDE;
export type PictureAspect = "square" | "portrait" | "landscape";

export function modelDimensions(model: ComfyModel | null, mode: PictureMode, aspect: PictureAspect) {
  const longSide = model?.graph.longSide?.[mode] ?? DEFAULT_LONG_SIDE[mode];
  const multiple = model?.graph.multiple ?? 8;
  const shortSide = Math.max(multiple, Math.round((longSide * 0.75) / multiple) * multiple);
  if (aspect === "portrait") return { width: shortSide, height: longSide };
  if (aspect === "landscape") return { width: longSide, height: shortSide };
  return { width: longSide, height: longSide };
}

// Whether a table's boundary can keep anything out of this model's
// pictures: only through a negative prompt the sampler actually weighs.
export function honoursNegative(model: ComfyModel): boolean {
  if (model.graph.negative !== "text") return false;
  const sampler = model.graph.sampler;
  if (sampler.kind === "ksampler" || sampler.kind === "custom") return sampler.cfg > 1;
  const guider = sampler.guider;
  return guider.node === "CFGGuider" ? guider.cfg > 1 : guider.node === "DualCFGGuider";
}

export function modelSteps(model: ComfyModel): number {
  const sampler = model.graph.sampler;
  return sampler.kind === "ksampler" ? sampler.steps : sampler.sigmas.steps;
}

export type WorkflowRequest = {
  prompt: string;
  // The table's boundary negatives (safety-logic.ts).
  negative?: string;
  width: number;
  height: number;
  seed: number;
  // The file this ComfyUI has for each of the model's slots.
  files: ModelFiles;
  // A benchmark trying other settings than the catalog's.
  steps?: number;
  cfg?: number;
};

// "4:3" for 1024x768.
function aspectRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

type Ref = [string, number];
type Node = { class_type: string; inputs: Record<string, unknown> };

export function buildModelWorkflow(model: ComfyModel, request: WorkflowRequest): Record<string, Node> {
  const graph: Record<string, Node> = {};
  let next = 1;
  const add = (class_type: string, inputs: Record<string, unknown>): string => {
    const id = String(next++);
    graph[id] = { class_type, inputs };
    return id;
  };
  const { width, height, seed, files } = request;
  const value = (raw: GraphValue) => (raw === "$width" ? width : raw === "$height" ? height : raw);
  const patchInputs = (patch: GraphPatch) =>
    Object.fromEntries(Object.entries(patch.inputs).map(([key, raw]) => [key, value(raw)]));
  const recipe = model.graph;

  let diffusion: Ref;
  let clip: Ref;
  let vae: Ref;
  if ("checkpoint" in recipe.load) {
    const loader = add("CheckpointLoaderSimple", { ckpt_name: files[recipe.load.checkpoint] });
    diffusion = [loader, 0];
    clip = [loader, 1];
    vae = [loader, 2];
  } else {
    diffusion = [add("UNETLoader", { unet_name: files[recipe.load.unet], weight_dtype: "default" }), 0];
    const spec = recipe.load.clip;
    const names = spec.slots.map((slot) => files[slot]);
    clip = [
      spec.node === "CLIPLoader"
        ? add("CLIPLoader", { clip_name: names[0], type: spec.type, device: "default" })
        : spec.node === "DualCLIPLoader"
          ? add("DualCLIPLoader", { clip_name1: names[0], clip_name2: names[1], type: spec.type, device: "default" })
          : add("QuadrupleCLIPLoader", { clip_name1: names[0], clip_name2: names[1], clip_name3: names[2], clip_name4: names[3] }),
      0,
    ];
    vae = [add("VAELoader", { vae_name: recipe.load.vae === "pixel_space" ? "pixel_space" : files[recipe.load.vae] }), 0];
  }

  for (const lora of recipe.loras ?? []) {
    diffusion = [add("LoraLoaderModelOnly", { model: diffusion, lora_name: files[lora.slot], strength_model: lora.strength }), 0];
  }
  for (const patch of recipe.clipPatches ?? []) {
    clip = [add(patch.node, { ...patchInputs(patch), clip }), 0];
  }
  for (const patch of recipe.modelPatches ?? []) {
    diffusion = [add(patch.node, { ...patchInputs(patch), model: diffusion }), 0];
  }

  const text =
    recipe.promptFormat === "ideogram4-json"
      ? JSON.stringify({ aspect_ratio: aspectRatio(width, height), high_level_description: request.prompt })
      : `${recipe.prefix ?? ""}${request.prompt}`;
  const negativeText =
    recipe.negative === "text" ? [DEFAULT_NEGATIVE, request.negative?.trim()].filter(Boolean).join(", ") : "";
  let positive: Ref;
  let negative: Ref;
  let latent: Ref | null = null;
  if (recipe.encode === "qwen-image-21") {
    const encoded = add("TextEncodeQwenImage21", { clip, prompt: text, negative_prompt: negativeText, resolution: 1024, vae });
    positive = [encoded, 0];
    negative = [encoded, 1];
  } else if (recipe.encode === "mage-flow") {
    const encoded = add("TextEncodeMageFlowEdit", {
      clip,
      prompt: text,
      negative_prompt: negativeText,
      width,
      height,
      batch_size: 1,
      vae,
    });
    positive = [encoded, 0];
    negative = [encoded, 1];
    latent = [encoded, 2];
  } else {
    positive = [add("CLIPTextEncode", { text, clip }), 0];
    negative =
      recipe.negative === "text"
        ? [add("CLIPTextEncode", { text: negativeText, clip }), 0]
        : [add("ConditioningZeroOut", { conditioning: positive }), 0];
  }
  if (recipe.guidance !== undefined) {
    positive = [add("FluxGuidance", { conditioning: positive, guidance: recipe.guidance }), 0];
    if (recipe.guidanceOnNegative) {
      negative = [add("FluxGuidance", { conditioning: negative, guidance: recipe.guidance }), 0];
    }
  }

  latent ??= [
    add(
      recipe.latent,
      recipe.latent === "EmptyHunyuanVideo15Latent"
        ? { width, height, length: 1, batch_size: 1 }
        : { width, height, batch_size: 1 },
    ),
    0,
  ];

  const sampler = recipe.sampler;
  const steps = request.steps;
  const sigmas = (spec: SigmasSpec): Ref => {
    const count = steps ?? spec.steps;
    if (spec.node === "Flux2Scheduler") return [add("Flux2Scheduler", { steps: count, width, height }), 0];
    if (spec.node === "BasicScheduler") return [add("BasicScheduler", { model: diffusion, scheduler: spec.scheduler, steps: count, denoise: 1 }), 0];
    if (spec.node === "BetaSamplingScheduler") {
      return [add("BetaSamplingScheduler", { model: diffusion, steps: count, alpha: spec.alpha, beta: spec.beta }), 0];
    }
    return [add("Ideogram4Scheduler", { steps: count, width, height, mu: spec.mu, std: spec.std }), 0];
  };
  const samplerNode = (spec: string | GraphPatch): Ref =>
    typeof spec === "string" ? [add("KSamplerSelect", { sampler_name: spec }), 0] : [add(spec.node, patchInputs(spec)), 0];
  const guider = (spec: GuiderSpec): Ref => {
    if (spec.node === "CFGGuider") return [add("CFGGuider", { model: diffusion, positive, negative, cfg: request.cfg ?? spec.cfg }), 0];
    if (spec.node === "BasicGuider") return [add("BasicGuider", { model: diffusion, conditioning: positive }), 0];
    if (spec.node === "DualCFGGuider") {
      return [
        add("DualCFGGuider", {
          model: diffusion,
          cond1: positive,
          cond2: negative,
          negative,
          cfg_conds: request.cfg ?? spec.cfgConds,
          cfg_cond2_negative: spec.cfgCond2Negative,
          style: "regular",
        }),
        0,
      ];
    }
    const unconditional = add("UNETLoader", { unet_name: files[spec.negativeUnet], weight_dtype: "default" });
    return [
      add("DualModelGuider", { model: diffusion, positive, cfg: request.cfg ?? spec.cfg, model_negative: [unconditional, 0], negative }),
      0,
    ];
  };

  let samples: Ref;
  if (sampler.kind === "ksampler") {
    samples = [
      add("KSampler", {
        model: diffusion,
        seed,
        steps: steps ?? sampler.steps,
        cfg: request.cfg ?? sampler.cfg,
        sampler_name: sampler.sampler,
        scheduler: sampler.scheduler,
        positive,
        negative,
        latent_image: latent,
        denoise: 1,
      }),
      0,
    ];
  } else if (sampler.kind === "advanced") {
    samples = [
      add("SamplerCustomAdvanced", {
        noise: [add("RandomNoise", { noise_seed: seed }), 0],
        guider: guider(sampler.guider),
        sampler: samplerNode(sampler.sampler),
        sigmas: sigmas(sampler.sigmas),
        latent_image: latent,
      }),
      0,
    ];
  } else {
    samples = [
      add("SamplerCustom", {
        model: diffusion,
        add_noise: true,
        noise_seed: seed,
        cfg: request.cfg ?? sampler.cfg,
        positive,
        negative,
        sampler: samplerNode(sampler.sampler),
        sigmas: sigmas(sampler.sigmas),
        latent_image: latent,
      }),
      0,
    ];
  }

  const decoded = add("VAEDecode", { samples, vae });
  add("SaveImage", { images: [decoded, 0], filename_prefix: "open-dungeon" });
  return graph;
}
