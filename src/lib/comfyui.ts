import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { configValue, getGlobalConfig } from "@/lib/app-config";
import type { AspectPreset, GeneratedImage, ImageMode } from "@/lib/types";

// First-party ComfyUI backend: the app submits a plain text-to-image workflow
// over ComfyUI's HTTP API and saves the result exactly like the FLUX worker
// does. Any running ComfyUI instance works — the user picks the checkpoint.

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

export type ComfyStatus = {
  ok: boolean;
  error?: string;
  checkpoints: string[];
};

// One call powers the Images panel: reachability plus the checkpoint list
// from CheckpointLoaderSimple's declared inputs.
export async function comfyStatus(rawUrl: string | undefined): Promise<ComfyStatus> {
  const url = resolveComfyUrl(rawUrl);
  const timeout = timeoutSignal(STATUS_TIMEOUT_MS);

  try {
    const [stats, objectInfo] = await Promise.all([
      fetch(`${url}/system_stats`, { cache: "no-store", signal: timeout.signal }),
      fetch(`${url}/object_info/CheckpointLoaderSimple`, {
        cache: "no-store",
        signal: timeout.signal,
      }),
    ]);

    if (!stats.ok) {
      return { ok: false, error: `ComfyUI answered ${stats.status}.`, checkpoints: [] };
    }

    let checkpoints: string[] = [];
    if (objectInfo.ok) {
      const info = (await objectInfo.json()) as {
        CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: unknown[] } } };
      };
      const names = info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
      if (Array.isArray(names)) {
        checkpoints = names.filter((name): name is string => typeof name === "string");
      }
    }

    return { ok: true, checkpoints };
  } catch {
    return {
      ok: false,
      error: `Could not reach ComfyUI at ${url}. Start ComfyUI and check the URL.`,
      checkpoints: [],
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

function buildWorkflow(options: {
  checkpoint: string;
  prompt: string;
  width: number;
  height: number;
  seed: number;
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
      inputs: { text: NEGATIVE_PROMPT, clip: ["1", 1] },
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
}): Promise<GeneratedImage> {
  const url = resolveComfyUrl(options.url);
  const startedAt = Date.now();
  const deadline = startedAt + GENERATE_TIMEOUT_MS;

  let checkpoint = (options.checkpoint || "").trim();
  if (!checkpoint) {
    const status = await comfyStatus(url);
    if (!status.ok) {
      throw new Error(status.error || `Could not reach ComfyUI at ${url}.`);
    }
    checkpoint = status.checkpoints[0] || "";
    if (!checkpoint) {
      throw new Error(
        "ComfyUI has no checkpoints installed. Put a model in ComfyUI/models/checkpoints and refresh.",
      );
    }
  }

  const seed = options.seed ?? Math.floor(Math.random() * 2_147_483_647);
  const { width, height } = comfyDimensions(options.mode, options.aspect);
  const workflow = buildWorkflow({ checkpoint, prompt: options.prompt, width, height, seed });

  const submitTimeout = timeoutSignal(STATUS_TIMEOUT_MS * 2);
  let promptId = "";
  try {
    const submitted = await fetch(`${url}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: crypto.randomUUID() }),
      signal: submitTimeout.signal,
    });
    if (!submitted.ok) {
      const detail = (await submitted.text()).slice(0, 500);
      throw new Error(`ComfyUI rejected the workflow (${submitted.status}): ${detail}`);
    }
    const payload = (await submitted.json()) as { prompt_id?: string };
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
      const history = await fetch(`${url}/history/${promptId}`, {
        cache: "no-store",
        signal: historyTimeout.signal,
      });
      if (!history.ok) {
        continue;
      }
      const payload = (await history.json()) as Record<string, HistoryEntry>;
      entry = payload[promptId];
    } catch {
      continue;
    } finally {
      historyTimeout.clear();
    }

    if (!entry) {
      continue;
    }
    if (entry.status?.status_str === "error") {
      throw new Error(
        "ComfyUI failed to run the workflow. Check the ComfyUI console — usually a missing checkpoint or out-of-memory.",
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
  let bytes: ArrayBuffer;
  try {
    const view = await fetch(
      `${url}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder || "")}&type=${encodeURIComponent(image.type || "output")}`,
      { cache: "no-store", signal: viewTimeout.signal },
    );
    if (!view.ok) {
      throw new Error(`ComfyUI would not return the finished image (${view.status}).`);
    }
    bytes = await view.arrayBuffer();
  } finally {
    viewTimeout.clear();
  }

  const generatedDir = path.join(process.cwd(), "public", "generated");
  mkdirSync(generatedDir, { recursive: true });
  const filename = `${Date.now()}-${seed}-comfyui-${promptSlug(options.prompt)}.png`;
  writeFileSync(path.join(generatedDir, filename), Buffer.from(bytes));

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
