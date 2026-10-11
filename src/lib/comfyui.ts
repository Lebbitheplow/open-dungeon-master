import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { configValue, getGlobalConfig } from "@/lib/app-config";
import { sniffImage } from "@/lib/image-format";
import { scheduleImageVariants } from "@/lib/image-variants";
import {
  Z_IMAGE_SLOTS,
  pickZImageFiles,
  readComfyFiles,
  zImageMissing,
  type ZImageFiles,
  type ZImageSlot,
} from "@/lib/setup/discovery-logic";
import type { AspectPreset, GeneratedImage, ImageMode } from "@/lib/types";

// First-party ComfyUI backend: the app submits a plain text-to-image workflow
// over ComfyUI's HTTP API and saves the result exactly like the FLUX worker
// does. Any running ComfyUI instance works: the admin picks a checkpoint, or
// Z-Image Turbo, whose three files are found in that ComfyUI's own lists.

const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";
const STATUS_TIMEOUT_MS = 4_000;
const GENERATE_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 750;
const STEPS = 25;
const CFG = 6.0;
const NEGATIVE_PROMPT =
  "text, watermark, signature, low quality, jpeg artifacts, deformed hands, extra fingers";
// Checkpoint-friendly ceiling: SDXL models train at 1024 and degrade past
// ~1.5K on the long side, unlike the FLUX backends' 2048 slow mode.
const LONG_SIDE = { fast: 1024, slow: 1344 } as const;
// Ceilings on what the server reads back. A 1344px PNG is a few MB; the
// JSON answers (status, checkpoint list, history) are kilobytes.
export const MAX_COMFY_IMAGE_BYTES = 32 * 1024 * 1024;
export const MAX_COMFY_JSON_BYTES = 4 * 1024 * 1024;

export function resolveComfyUrl(raw: string | undefined): string {
  return (
    (raw || "").trim().replace(/\/+$/, "") ||
    configValue(getGlobalConfig().images.comfyUrl, "COMFYUI_URL", DEFAULT_COMFY_URL).replace(
      /\/+$/,
      "",
    )
  );
}

function timeoutSignal(ms: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(id) };
}

// SECURITY: the ComfyUI URL can be a campaign's own setting, so whatever
// answers there is not trusted. Its answers are never followed elsewhere,
// never read past a ceiling, and never published unless they are a picture:
// otherwise a server that speaks just enough of the protocol could redirect
// the final download to an internal address and have the response saved
// under /generated for anyone to read.
class ComfyRefusal extends Error {}

// ComfyUI's API never redirects, so a redirect means whatever is at this
// URL is steering the server's request somewhere else; it is refused rather
// than followed.
async function comfyFetch(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    throw new ComfyRefusal("ComfyUI answered with a redirect, which ComfyUI never sends. Check the URL.");
  }
  return response;
}

// The body, refused once it passes `max` bytes, whether declared up front
// or discovered while streaming.
async function readCapped(response: Response, max: number): Promise<Buffer> {
  const tooLarge = () => new ComfyRefusal(`ComfyUI sent more than ${Math.round(max / 1024 / 1024)}MB, which is not a ComfyUI answer.`);
  if (Number(response.headers.get("content-length")) > max) {
    await response.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!response.body) {
    return Buffer.alloc(0);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function readJson<T>(response: Response): Promise<T> {
  return JSON.parse((await readCapped(response, MAX_COMFY_JSON_BYTES)).toString("utf8")) as T;
}

export type ComfyStatus = {
  ok: boolean;
  error?: string;
  checkpoints: string[];
  // The Z-Image Turbo files this ComfyUI has, "" for each one it lacks.
  zImage: ZImageFiles;
};

const NO_Z_IMAGE: ZImageFiles = { unet: "", clip: "", vae: "" };

// A loader's file list, or none when ComfyUI does not know the node or its
// answer is not JSON. A redirect or a flood still refuses the whole check.
async function readFileList(response: Response, node: string, input: string): Promise<string[]> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return [];
  }
  try {
    return readComfyFiles(await readJson<unknown>(response), node, input);
  } catch (error) {
    if (error instanceof ComfyRefusal) {
      throw error;
    }
    return [];
  }
}

// One call powers the Images panel: reachability, the checkpoint list from
// CheckpointLoaderSimple's declared inputs, and the Z-Image Turbo files from
// the three loaders that workflow uses.
export async function comfyStatus(rawUrl: string | undefined): Promise<ComfyStatus> {
  const url = resolveComfyUrl(rawUrl);
  const timeout = timeoutSignal(STATUS_TIMEOUT_MS);
  const slots = Object.keys(Z_IMAGE_SLOTS) as ZImageSlot[];

  try {
    const [stats, objectInfo, ...loaders] = await Promise.all([
      comfyFetch(`${url}/system_stats`, { cache: "no-store", signal: timeout.signal }),
      ...["CheckpointLoaderSimple", ...slots.map((slot) => Z_IMAGE_SLOTS[slot].node)].map((node) =>
        comfyFetch(`${url}/object_info/${node}`, { cache: "no-store", signal: timeout.signal }),
      ),
    ]);

    if (!stats.ok) {
      await Promise.all([objectInfo, ...loaders].map((response) => response.body?.cancel().catch(() => {})));
      return { ok: false, error: `ComfyUI answered ${stats.status}.`, checkpoints: [], zImage: NO_Z_IMAGE };
    }

    const [checkpoints, unet, clip, vae] = await Promise.all([
      readFileList(objectInfo, "CheckpointLoaderSimple", "ckpt_name"),
      ...slots.map((slot, index) => readFileList(loaders[index], Z_IMAGE_SLOTS[slot].node, Z_IMAGE_SLOTS[slot].input)),
    ]);
    const zImage = pickZImageFiles({ unet, clip, vae });

    return { ok: true, checkpoints, zImage };
  } catch (error) {
    if (error instanceof ComfyRefusal) {
      return { ok: false, error: error.message, checkpoints: [], zImage: NO_Z_IMAGE };
    }
    return {
      ok: false,
      error: `Could not reach ComfyUI at ${url}. Start ComfyUI and check the URL.`,
      checkpoints: [],
      zImage: NO_Z_IMAGE,
    };
  } finally {
    timeout.clear();
  }
}

function comfyDimensions(mode: ImageMode, aspect: AspectPreset) {
  const longSide = LONG_SIDE[mode];
  const shortSide = Math.round((longSide * 0.75) / 8) * 8;

  if (aspect === "portrait") {
    return { width: shortSide, height: longSide };
  }
  if (aspect === "landscape") {
    return { width: longSide, height: shortSide };
  }
  return { width: longSide, height: longSide };
}

export function buildCheckpointWorkflow(options: {
  checkpoint: string;
  prompt: string;
  width: number;
  height: number;
  seed: number;
  // Extra negatives from the table's boundary (safety-logic.ts).
  negative?: string;
}) {
  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: options.checkpoint },
    },
    "2": {
      class_type: "CLIPTextEncode",
      inputs: { text: options.prompt, clip: ["1", 1] },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: { text: options.negative ? `${NEGATIVE_PROMPT}, ${options.negative}` : NEGATIVE_PROMPT, clip: ["1", 1] },
    },
    "4": {
      class_type: "EmptyLatentImage",
      inputs: { width: options.width, height: options.height, batch_size: 1 },
    },
    "5": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
        seed: options.seed,
        steps: STEPS,
        cfg: CFG,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
      },
    },
    "6": {
      class_type: "VAEDecode",
      inputs: { samples: ["5", 0], vae: ["1", 2] },
    },
    "7": {
      class_type: "SaveImage",
      inputs: { images: ["6", 0], filename_prefix: "open-dungeon" },
    },
  };
}

// The Z-Image Turbo graph from the supplied ComfyUI API workflow. Only the
// positive text, latent dimensions, and seed vary between generations, and
// the three file names, which come from this ComfyUI's own lists (comfyStatus).
//
// It runs at CFG 1 with a zeroed negative, so a table boundary's picture
// negatives have nowhere to go. They are not folded into the prompt either:
// "Leave out: blood, wounds" in a positive prompt paints blood and wounds.
export function buildZTurboWorkflow(options: {
  prompt: string;
  width: number;
  height: number;
  seed: number;
  files: ZImageFiles;
}) {
  return {
    "9": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "z-image-turbo", images: ["57:8", 0] },
      _meta: { title: "Save Image" },
    },
    "57:30": {
      class_type: "CLIPLoader",
      inputs: { clip_name: options.files.clip, type: "lumina2", device: "default" },
      _meta: { title: "Load CLIP" },
    },
    "57:29": {
      class_type: "VAELoader",
      inputs: { vae_name: options.files.vae },
      _meta: { title: "Load VAE" },
    },
    "57:33": {
      class_type: "ConditioningZeroOut",
      inputs: { conditioning: ["57:27", 0] },
      _meta: { title: "Conditioning Zero Out" },
    },
    "57:8": {
      class_type: "VAEDecode",
      inputs: { samples: ["57:3", 0], vae: ["57:29", 0] },
      _meta: { title: "VAE Decode" },
    },
    "57:28": {
      class_type: "UNETLoader",
      inputs: { unet_name: options.files.unet, weight_dtype: "default" },
      _meta: { title: "Load Diffusion Model" },
    },
    "57:27": {
      class_type: "CLIPTextEncode",
      inputs: { text: options.prompt, clip: ["57:30", 0] },
      _meta: { title: "CLIP Text Encode (Prompt)" },
    },
    "57:13": {
      class_type: "EmptySD3LatentImage",
      inputs: { width: options.width, height: options.height, batch_size: 1 },
      _meta: { title: "EmptySD3LatentImage" },
    },
    "57:11": {
      class_type: "ModelSamplingAuraFlow",
      inputs: { shift: 3, sampling: "flow", model: ["57:28", 0] },
      _meta: { title: "ModelSamplingAuraFlow" },
    },
    "57:3": {
      class_type: "KSampler",
      inputs: {
        seed: options.seed,
        steps: 8,
        cfg: 1,
        sampler_name: "res_multistep",
        scheduler: "beta",
        denoise: 1,
        model: ["57:11", 0],
        positive: ["57:27", 0],
        negative: ["57:33", 0],
        latent_image: ["57:13", 0],
      },
      _meta: { title: "KSampler" },
    },
  };
}

type HistoryEntry = {
  status?: { completed?: boolean; status_str?: string; messages?: unknown[] };
  outputs?: Record<string, { images?: Array<{ filename?: string; subfolder?: string; type?: string }> }>;
};

function promptSlug(prompt: string) {
  return (
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "image"
  );
}

export async function generateComfyImage(options: {
  url?: string;
  checkpoint?: string;
  prompt: string;
  mode: ImageMode;
  aspect: AspectPreset;
  seed?: number;
  hasReferences?: boolean;
  negative?: string;
}): Promise<GeneratedImage> {
  const url = resolveComfyUrl(options.url);
  const startedAt = Date.now();
  const deadline = startedAt + GENERATE_TIMEOUT_MS;

  const preset = getGlobalConfig().images.comfyWorkflowPreset;
  let checkpoint = (options.checkpoint || "").trim();
  let zImage = NO_Z_IMAGE;
  if (preset === "z_turbo" || !checkpoint) {
    const status = await comfyStatus(url);
    if (!status.ok) {
      throw new Error(status.error || `Could not reach ComfyUI at ${url}.`);
    }
    if (preset === "z_turbo") {
      // The files this ComfyUI has, whatever precision it downloaded; a
      // missing one is named here rather than in ComfyUI's validation error.
      const missing = zImageMissing(status.zImage);
      if (missing.length) {
        throw new Error(`ComfyUI is missing ${missing.join(", ")} for Z-Image Turbo. Add it, or pick a checkpoint in Admin > Images.`);
      }
      zImage = status.zImage;
    } else {
      checkpoint = status.checkpoints[0] || "";
      if (!checkpoint) {
        throw new Error(
          "ComfyUI has no checkpoints installed. Put a model in ComfyUI/models/checkpoints and refresh.",
        );
      }
    }
  }

  const seed = options.seed ?? Math.floor(Math.random() * 2_147_483_647);
  const { width, height } = comfyDimensions(options.mode, options.aspect);
  const workflow = preset === "z_turbo"
    ? buildZTurboWorkflow({ prompt: options.prompt, width, height, seed, files: zImage })
    : buildCheckpointWorkflow({ checkpoint, prompt: options.prompt, width, height, seed, negative: options.negative });

  const submitTimeout = timeoutSignal(STATUS_TIMEOUT_MS * 2);
  let promptId = "";
  try {
    const submitted = await comfyFetch(`${url}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: crypto.randomUUID() }),
      signal: submitTimeout.signal,
    });
    if (!submitted.ok) {
      const detail = (await readCapped(submitted, MAX_COMFY_JSON_BYTES)).toString("utf8").slice(0, 500);
      throw new Error(`ComfyUI rejected the workflow (${submitted.status}): ${detail}`);
    }
    const payload = await readJson<{ prompt_id?: string }>(submitted);
    promptId = payload.prompt_id || "";
  } catch (error) {
    if (error instanceof Error && !error.message.startsWith("ComfyUI")) {
      throw new Error(`Could not reach ComfyUI at ${url}. Start ComfyUI and check the URL.`);
    }
    throw error;
  } finally {
    submitTimeout.clear();
  }

  if (!promptId) {
    throw new Error("ComfyUI did not return a prompt id.");
  }

  // Poll history until the job finishes; ComfyUI queues serially, so this can
  // legitimately wait behind other generations.
  let entry: HistoryEntry | undefined;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error("ComfyUI generation timed out. Check the ComfyUI queue and try again.");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const historyTimeout = timeoutSignal(STATUS_TIMEOUT_MS);
    try {
      const history = await comfyFetch(`${url}/history/${promptId}`, {
        cache: "no-store",
        signal: historyTimeout.signal,
      });
      if (!history.ok) {
        await history.body?.cancel().catch(() => {});
        continue;
      }
      const payload = await readJson<Record<string, HistoryEntry>>(history);
      entry = payload[promptId];
    } catch (error) {
      // A slow or briefly unreachable ComfyUI is polled again; one that
      // redirects or floods is not going to start behaving.
      if (error instanceof ComfyRefusal) {
        throw error;
      }
      continue;
    } finally {
      historyTimeout.clear();
    }

    if (!entry) {
      continue;
    }
    if (entry.status?.status_str === "error") {
      throw new Error(
        "ComfyUI failed to run the workflow. Check the ComfyUI console: it is usually a missing model file or out-of-memory.",
      );
    }
    const images = Object.values(entry.outputs || {}).flatMap((output) => output.images || []);
    if (images.length) {
      break;
    }
    if (entry.status?.completed) {
      throw new Error("ComfyUI finished without producing an image.");
    }
  }

  const image = Object.values(entry!.outputs || {})
    .flatMap((output) => output.images || [])
    .find((candidate) => candidate.filename);
  if (!image?.filename) {
    throw new Error("ComfyUI finished without producing an image.");
  }

  const viewTimeout = timeoutSignal(STATUS_TIMEOUT_MS * 4);
  let bytes: Buffer;
  try {
    const view = await comfyFetch(
      `${url}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder || "")}&type=${encodeURIComponent(image.type || "output")}`,
      { cache: "no-store", signal: viewTimeout.signal },
    );
    if (!view.ok) {
      await view.body?.cancel().catch(() => {});
      throw new Error(`ComfyUI would not return the finished image (${view.status}).`);
    }
    bytes = await readCapped(view, MAX_COMFY_IMAGE_BYTES);
  } finally {
    viewTimeout.clear();
  }
  // Only a picture is published, and under the name of what it really is.
  const kind = sniffImage(bytes);
  if (!kind) {
    throw new Error("ComfyUI returned something that is not a PNG, JPEG or WebP image.");
  }

  const generatedDir = path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "generated");
  mkdirSync(generatedDir, { recursive: true });
  const filename = `${Date.now()}-${seed}-comfyui-${promptSlug(options.prompt)}.${kind.ext}`;
  const saved = path.join(/*turbopackIgnore: true*/ generatedDir, filename);
  writeFileSync(saved, bytes);
  // The smaller WebP copies the table draws, written after the fact; the
  // original is what the campaign stores and what a client without them gets.
  scheduleImageVariants(saved);

  return {
    id: crypto.randomUUID(),
    url: `/generated/${filename}`,
    prompt: options.prompt,
    mode: options.mode,
    backend: "comfyui",
    aspect: options.aspect,
    width,
    height,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
    seed,
    warnings: options.hasReferences
      ? ["Character reference images are not used by the ComfyUI backend."]
      : undefined,
  };
}
