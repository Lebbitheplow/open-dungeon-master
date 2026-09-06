// The ComfyUI client the art scripts share: submit a plain text-to-image
// workflow, wait for it, fetch the PNG, and re-encode a kept original to the
// WebP the app ships. Pulled out of generate-placeholders.mjs so the world
// pack renderer drives the same instance the same way.

import { execFileSync } from "node:child_process";

export const DEFAULT_COMFY_URL = (process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");

// The same SDXL checkpoint src/lib/defaults.ts pins for the app, so art made
// here matches what the table paints later.
export const DEFAULT_CHECKPOINT = "CyberRealisticXLPlay_V6.0.safetensors";

const JOB_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_MS = 700;

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
  const status = await fetch(`${comfyUrl}/system_stats`, { cache: "no-store" }).catch(() => null);
  return Boolean(status?.ok);
}

function buildWorkflow({ checkpoint, prompt, negative, width, height, seed, steps, cfg, sampler, scheduler, prefix }) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: negative, clip: ["1", 1] } },
    "4": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "5": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
        seed,
        steps,
        cfg,
        sampler_name: sampler,
        scheduler,
        denoise: 1,
      },
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: prefix } },
  };
}

// Renders one image and returns the PNG bytes.
export async function renderImage(options) {
  const comfyUrl = options.comfyUrl || DEFAULT_COMFY_URL;
  const workflow = buildWorkflow({
    checkpoint: options.checkpoint || DEFAULT_CHECKPOINT,
    steps: options.steps ?? 26,
    cfg: options.cfg ?? 7.0,
    sampler: options.sampler || "dpmpp_2m",
    scheduler: options.scheduler || "karras",
    prefix: options.prefix || "odm-art",
    ...options,
  });
  const submitted = await fetch(`${comfyUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!submitted.ok) {
    throw new Error(`ComfyUI rejected the job (${submitted.status}): ${await submitted.text()}`);
  }
  const { prompt_id: promptId } = await submitted.json();

  const deadline = Date.now() + JOB_TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`ComfyUI job ${promptId} did not finish in ${JOB_TIMEOUT_MS / 1000}s`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const history = await fetch(`${comfyUrl}/history/${promptId}`, { cache: "no-store" });
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
    for (const output of Object.values(entry.outputs ?? {})) {
      for (const image of output.images ?? []) {
        const query = new URLSearchParams({
          filename: image.filename,
          subfolder: image.subfolder ?? "",
          type: image.type ?? "output",
        });
        const file = await fetch(`${comfyUrl}/view?${query}`);
        return Buffer.from(await file.arrayBuffer());
      }
    }
    throw new Error(`ComfyUI job ${promptId} produced no image`);
  }
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
