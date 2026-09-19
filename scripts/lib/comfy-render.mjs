// The ComfyUI client the art scripts share: submit a text-to-image (or
// image-to-image) workflow, wait for it, fetch the PNG, and re-encode a kept
// original to the WebP the app ships. Pulled out of generate-placeholders.mjs
// so the world pack renderer, the tile set and the object set all drive the
// same instance the same way.
//
// Two models, chosen per job with `model`:
//   "sdxl" (default): the checkpoint src/lib/defaults.ts pins for the app.
//   "flux":           Flux schnell, four steps, no negative prompt. Painted,
//                     stylised and consistent, which is what the map art needs;
//                     the SDXL checkpoint paints photographs.

import { execFileSync } from "node:child_process";

export const DEFAULT_COMFY_URL = (process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");

// The same SDXL checkpoint src/lib/defaults.ts pins for the app, so art made
// here matches what the table paints later.
export const DEFAULT_CHECKPOINT = "CyberRealisticXLPlay_V6.0.safetensors";

export const FLUX = {
  unet: "flux1-schnell.safetensors",
  clip1: "t5xxl_fp8_e4m3fn.safetensors",
  clip2: "clip_l.safetensors",
  vae: "ae.safetensors",
  steps: 4,
};

const JOB_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_MS = 700;
// A request that never answers is treated like a dead server: every fetch
// carries a deadline, and a job that outlives JOB_TIMEOUT_MS is interrupted.
const REQUEST_TIMEOUT_MS = 60 * 1000;
const withDeadline = (ms) => ({ signal: AbortSignal.timeout(ms) });

// A stable seed per key: rerunning one slice reproduces the picture that was
// already reviewed instead of rolling a different one.
export function seedFor(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2147483647;
}

export async function comfyReachable(comfyUrl = DEFAULT_COMFY_URL) {
  const status = await fetch(`${comfyUrl}/system_stats`, { cache: "no-store", ...withDeadline(10000) }).catch(() => null);
  return Boolean(status?.ok);
}

// The node classes a job may need, so a missing custom node fails with the
// repository to install rather than a ComfyUI validation error.
const NODE_SOURCES = {
  SeamlessTile: "spinagon/ComfyUI-seamless-tiling",
  CircularVAEDecode: "spinagon/ComfyUI-seamless-tiling",
  "easy imageRemBg": "yolain/ComfyUI-Easy-Use",
};

export async function requireNodes(names, comfyUrl = DEFAULT_COMFY_URL) {
  const info = await fetch(`${comfyUrl}/object_info`, { cache: "no-store" }).then((r) => r.json());
  const missing = names.filter((name) => !info[name]);
  if (missing.length) {
    throw new Error(
      `ComfyUI is missing ${missing.map((n) => `${n} (${NODE_SOURCES[n] || "core"})`).join(", ")}; ` +
        "install the custom node into ~/ComfyUI/custom_nodes and restart the comfyui service.",
    );
  }
}

function seamlessNodes(modelNode) {
  // `tiling` asks the model itself for a texture that wraps, by patching every
  // convolution in the UNet to pad circularly (SeamlessTile) and doing the same
  // in the decoder (CircularVAEDecode). Both are needed: patch only the sampler
  // and the VAE puts an edge back on a texture that was careful not to have one.
  //
  // This replaced a post-processing mirror blend, which achieved matching edges
  // by reflecting the texture into them and so printed a butterfly of symmetry
  // across any tiled floor. Faking a seam is worse than not having one.
  //
  // Flux has no convolutions to patch, so on its own it wraps one axis and not
  // the other. A Flux surface therefore starts from an SDXL seamless base and
  // is repainted at partial denoise (`initImage` + `denoise`); the circular
  // decode still applies, and measured that way the wrap holds.
  return {
    class_type: "SeamlessTile",
    inputs: { model: [modelNode, 0], tiling: "enable", copy_model: "Make a copy" },
  };
}

function buildSdxl(o) {
  const seamless = Boolean(o.tiling);
  const modelNode = seamless ? "1b" : "1";
  const workflow = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: o.checkpoint } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: o.prompt, clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: o.negative || "", clip: ["1", 1] } },
    "5": {
      class_type: "KSampler",
      inputs: {
        model: [modelNode, 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: o.initImage ? ["4b", 0] : ["4", 0],
        seed: o.seed,
        steps: o.steps ?? 26,
        cfg: o.cfg ?? 7.0,
        sampler_name: o.sampler || "dpmpp_2m",
        scheduler: o.scheduler || "karras",
        denoise: o.initImage ? (o.denoise ?? 0.6) : 1,
      },
    },
    "6": seamless
      ? { class_type: "CircularVAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2], tiling: "enable" } }
      : { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
  };
  if (o.initImage) {
    workflow["4a"] = { class_type: "LoadImage", inputs: { image: o.initImage } };
    workflow["4b"] = { class_type: "VAEEncode", inputs: { pixels: ["4a", 0], vae: ["1", 2] } };
  } else {
    workflow["4"] = { class_type: "EmptyLatentImage", inputs: { width: o.width, height: o.height, batch_size: 1 } };
  }
  if (seamless) {
    workflow["1b"] = seamlessNodes("1");
  }
  return { workflow, image: ["6", 0], vae: ["1", 2] };
}

function buildFlux(o) {
  const seamless = Boolean(o.tiling);
  const modelNode = seamless ? "1b" : "1";
  const workflow = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: FLUX.unet, weight_dtype: "default" } },
    "2": { class_type: "DualCLIPLoader", inputs: { clip_name1: FLUX.clip1, clip_name2: FLUX.clip2, type: "flux" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: FLUX.vae } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: o.prompt, clip: ["2", 0] } },
    // Flux schnell takes no negative prompt; the conditioning is zeroed.
    "5": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["4", 0] } },
    "7": {
      class_type: "KSampler",
      inputs: {
        model: [modelNode, 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: o.initImage ? ["6b", 0] : ["6", 0],
        seed: o.seed,
        steps: o.steps ?? FLUX.steps,
        cfg: 1,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: o.initImage ? (o.denoise ?? 0.55) : 1,
      },
    },
    "8": seamless
      ? { class_type: "CircularVAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0], tiling: "enable" } }
      : { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
  };
  if (o.initImage) {
    workflow["6a"] = { class_type: "LoadImage", inputs: { image: o.initImage } };
    workflow["6b"] = { class_type: "VAEEncode", inputs: { pixels: ["6a", 0], vae: ["3", 0] } };
  } else {
    workflow["6"] = { class_type: "EmptySD3LatentImage", inputs: { width: o.width, height: o.height, batch_size: 1 } };
  }
  if (seamless) {
    workflow["1b"] = seamlessNodes("1");
  }
  return { workflow, image: ["8", 0], vae: ["3", 0] };
}

function buildWorkflow(o) {
  const built = o.model === "flux" ? buildFlux(o) : buildSdxl(o);
  const { workflow, image } = built;
  workflow["90"] = { class_type: "SaveImage", inputs: { images: image, filename_prefix: o.prefix } };
  if (o.cutout) {
    // Background removal for an object on a plain backdrop. BEN2 returns a soft
    // matte; the caller turns it into the alpha channel (see generate-props.mjs).
    workflow["91"] = {
      class_type: "easy imageRemBg",
      inputs: { images: image, rem_mode: "BEN2", image_output: "Hide", save_prefix: `${o.prefix}-cut` },
    };
    workflow["92"] = { class_type: "MaskToImage", inputs: { mask: ["91", 1] } };
    workflow["93"] = { class_type: "SaveImage", inputs: { images: ["92", 0], filename_prefix: `${o.prefix}-mask` } };
  }
  return workflow;
}

// Puts a PNG into ComfyUI's input folder so a LoadImage node can read it.
export async function uploadImage(png, name, comfyUrl = DEFAULT_COMFY_URL) {
  const form = new FormData();
  form.append("image", new Blob([png], { type: "image/png" }), name);
  form.append("overwrite", "true");
  const response = await fetch(`${comfyUrl}/upload/image`, { method: "POST", body: form });
  if (!response.ok) {
    throw new Error(`ComfyUI refused the upload (${response.status}): ${await response.text()}`);
  }
  return (await response.json()).name;
}

// ComfyUI can die under memory pressure (a large model loading beside the
// ones already resident) and systemd restarts it. A long run must not lose
// hours to that: wait for it to come back, up to fifteen minutes, then submit
// the same job again. Two attempts, then the caller records the failure.
const RESTART_WAIT_MS = 15 * 60 * 1000;

async function waitForComfy(comfyUrl) {
  const deadline = Date.now() + RESTART_WAIT_MS;
  while (Date.now() < deadline) {
    if (await comfyReachable(comfyUrl)) return true;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return false;
}

async function submitAndCollect(workflow, comfyUrl) {
  try {
    return await submitOnce(workflow, comfyUrl);
  } catch (error) {
    const transient = /fetch failed|ECONNREFUSED|ECONNRESET|socket hang up|502|503|aborted|timeout|did not finish/i.test(String(error.message) + String(error.name));
    if (!transient) throw error;
    console.warn(`ComfyUI went away (${error.message}); waiting for it to come back`);
    if (!(await waitForComfy(comfyUrl))) throw error;
    return submitOnce(workflow, comfyUrl);
  }
}

async function submitOnce(workflow, comfyUrl) {
  const submitted = await fetch(`${comfyUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
    ...withDeadline(REQUEST_TIMEOUT_MS),
  });
  if (!submitted.ok) {
    throw new Error(`ComfyUI rejected the job (${submitted.status}): ${await submitted.text()}`);
  }
  const { prompt_id: promptId } = await submitted.json();

  const deadline = Date.now() + JOB_TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) {
      // Cancel it, or every later job queues behind a hang.
      await fetch(`${comfyUrl}/interrupt`, { method: "POST", ...withDeadline(10000) }).catch(() => null);
      throw new Error(`ComfyUI job ${promptId} did not finish in ${JOB_TIMEOUT_MS / 1000}s`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const history = await fetch(`${comfyUrl}/history/${promptId}`, { cache: "no-store", ...withDeadline(REQUEST_TIMEOUT_MS) });
    const entry = (await history.json())[promptId];
    if (!entry) {
      continue;
    }
    if (entry.status?.status_str === "error") {
      throw new Error(`ComfyUI failed: ${JSON.stringify(entry.status.messages).slice(0, 500)}`);
    }
    if (!entry.status?.completed) {
      continue;
    }
    const byNode = {};
    for (const [node, output] of Object.entries(entry.outputs ?? {})) {
      for (const image of output.images ?? []) {
        const query = new URLSearchParams({
          filename: image.filename,
          subfolder: image.subfolder ?? "",
          type: image.type ?? "output",
        });
        const file = await fetch(`${comfyUrl}/view?${query}`, withDeadline(5 * 60 * 1000));
        byNode[node] = Buffer.from(await file.arrayBuffer());
      }
    }
    if (!byNode["90"]) {
      throw new Error(`ComfyUI job ${promptId} produced no image`);
    }
    return byNode;
  }
}

function withDefaults(options) {
  return {
    model: "sdxl",
    checkpoint: options.checkpoint || DEFAULT_CHECKPOINT,
    prefix: "odm-art",
    width: 1024,
    height: 1024,
    ...options,
  };
}

// Renders one image and returns the PNG bytes.
//
// options: { model, prompt, negative, width, height, seed, steps, cfg, sampler,
//            scheduler, prefix, tiling, initImage (an uploaded name), denoise }
export async function renderImage(options) {
  const comfyUrl = options.comfyUrl || DEFAULT_COMFY_URL;
  const outputs = await submitAndCollect(buildWorkflow(withDefaults(options)), comfyUrl);
  return outputs["90"];
}

// Renders an object on a plain backdrop and returns { image, mask }: the raw
// render and BEN2's matte as a greyscale PNG.
export async function renderCutout(options) {
  const comfyUrl = options.comfyUrl || DEFAULT_COMFY_URL;
  const outputs = await submitAndCollect(buildWorkflow(withDefaults({ ...options, cutout: true })), comfyUrl);
  if (!outputs["93"]) {
    throw new Error("ComfyUI produced no matte for the cutout");
  }
  return { image: outputs["90"], mask: outputs["93"] };
}

// ImageMagick rather than a new dependency: the repo has no image library, and
// these scripts are the only thing that would ever pull one in. Cover-fits the
// original to `size`, cropping from the centre.
export function encodeWebp(sourcePath, targetPath, size, quality) {
  execFileSync("magick", [
    sourcePath,
    "-resize", `${size.width}x${size.height}^`,
    "-gravity", "center",
    "-extent", `${size.width}x${size.height}`,
    "-strip",
    "-quality", String(quality),
    "-define", "webp:method=6",
    "-define", "webp:sharp-yuv=1",
    targetPath,
  ]);
}
