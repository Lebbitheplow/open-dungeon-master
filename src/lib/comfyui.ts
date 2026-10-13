import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { configValue, getGlobalConfig } from "@/lib/app-config";
import { sniffImage } from "@/lib/image-format";
import { scheduleImageVariants } from "@/lib/image-variants";
import { ANY_CHECKPOINT, CHECKPOINT_PRESET, comfyModel } from "@/lib/image-models/catalog";
import {
  checkpointModel,
  curateModels,
  hardwareProfile,
  isPictureCheckpoint,
  readComfyDevice,
  type ComfyDevice,
  type ComfyLists,
  type VerifiedRow,
} from "@/lib/image-models/curate";
import { FOLDER_LOADER, type ComfyFolder, type ComfyModel, type ModelFiles } from "@/lib/image-models/types";
import { VERIFIED_ROWS } from "@/lib/image-models/verified";
import { buildModelWorkflow, modelDimensions } from "@/lib/image-models/workflow";
import { readComfyFiles } from "@/lib/setup/discovery-logic";
import type { AspectPreset, GeneratedImage, ImageMode } from "@/lib/types";
import { recordMediaFile } from "@/lib/media-access";

// First-party ComfyUI backend: the app submits a text-to-image workflow over
// ComfyUI's HTTP API and saves the result exactly like the FLUX worker does.
// Any running ComfyUI instance works: the admin picks a checkpoint, or one of
// the catalog's models (src/lib/image-models), whose files are found in that
// ComfyUI's own lists and whose graph and settings come from the catalog.

const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";
const STATUS_TIMEOUT_MS = 4_000;
const GENERATE_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 750;
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

// A catalog model as one ComfyUI sees it, in the curated order: the files it
// has, what it still lacks and where those download from, and what this
// hardware made of the model when it was measured.
export type ComfyModelReport = {
  id: string;
  files: ModelFiles;
  missing: Array<{ what: string; name: string; folder: ComfyFolder; url: string; sizeGb: number }>;
  downloadGb: number;
  verified: VerifiedRow | null;
  needGb: number | null;
  fits: boolean | null;
};

export type ComfyStatus = {
  ok: boolean;
  error?: string;
  // The picture checkpoints; video models and upscalers are left out.
  checkpoints: string[];
  models: ComfyModelReport[];
  device: ComfyDevice | null;
  hardware: { id: string; label: string } | null;
};

const unreachable = (error: string): ComfyStatus => ({ ok: false, error, checkpoints: [], models: [], device: null, hardware: null });

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

const FOLDERS = Object.keys(FOLDER_LOADER) as ComfyFolder[];
const fileName = (name: string) => name.split(/[\\/]/).pop() ?? name;

// One call powers the Images panel and the setup wizard: reachability, the
// machine ComfyUI runs on, every loader's file list, and from those the
// catalog curated for this ComfyUI and its hardware.
export async function comfyStatus(rawUrl: string | undefined): Promise<ComfyStatus> {
  const url = resolveComfyUrl(rawUrl);
  const timeout = timeoutSignal(STATUS_TIMEOUT_MS);

  try {
    const [stats, ...loaders] = await Promise.all([
      comfyFetch(`${url}/system_stats`, { cache: "no-store", signal: timeout.signal }),
      ...FOLDERS.map((folder) =>
        comfyFetch(`${url}/object_info/${FOLDER_LOADER[folder].node}`, { cache: "no-store", signal: timeout.signal }),
      ),
    ]);

    if (!stats.ok) {
      await Promise.all(loaders.map((response) => response.body?.cancel().catch(() => {})));
      return unreachable(`ComfyUI answered ${stats.status}.`);
    }

    const [device, ...found] = await Promise.all([
      readJson<unknown>(stats).then(readComfyDevice).catch((error) => {
        if (error instanceof ComfyRefusal) throw error;
        return null;
      }),
      ...FOLDERS.map((folder, index) => readFileList(loaders[index], FOLDER_LOADER[folder].node, FOLDER_LOADER[folder].input)),
    ]);
    const lists: ComfyLists = Object.fromEntries(FOLDERS.map((folder, index) => [folder, found[index]]));
    const hardware = hardwareProfile(device);
    const models = curateModels({ lists, device, rows: VERIFIED_ROWS }).map(
      (entry): ComfyModelReport => ({
        id: entry.model.id,
        files: entry.files,
        missing: entry.missing.map((file) => ({ what: file.what, name: file.names[0], folder: file.folder, url: file.url, sizeGb: file.sizeGb })),
        downloadGb: entry.downloadGb,
        verified: entry.verified,
        needGb: entry.needGb,
        fits: entry.fits,
      }),
    );

    // A "checkpoint" also listed as a diffusion model is a bare model linked
    // into models/checkpoints: it has no text encoder or VAE to load.
    const bare = new Set((lists.diffusion_models ?? []).map(fileName));
    return {
      ok: true,
      checkpoints: (lists.checkpoints ?? []).filter((name) => isPictureCheckpoint(name) && !bare.has(fileName(name))),
      models,
      device,
      hardware: hardware && { id: hardware.id, label: hardware.label },
    };
  } catch (error) {
    if (error instanceof ComfyRefusal) {
      return unreachable(error.message);
    }
    return unreachable(`Could not reach ComfyUI at ${url}. Start ComfyUI and check the URL.`);
  } finally {
    timeout.clear();
  }
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

  // A catalog model paints every campaign's pictures; otherwise each
  // campaign's checkpoint does, with the catalog's settings for it when the
  // catalog knows that checkpoint.
  const preset = getGlobalConfig().images.comfyWorkflowPreset;
  const presetModel = preset === CHECKPOINT_PRESET ? undefined : comfyModel(preset);
  let checkpoint = (options.checkpoint || "").trim();
  let model: ComfyModel = ANY_CHECKPOINT;
  let files: ModelFiles = {};
  if (presetModel || !checkpoint) {
    const status = await comfyStatus(url);
    if (!status.ok) {
      throw new Error(status.error || `Could not reach ComfyUI at ${url}.`);
    }
    if (presetModel) {
      // The files this ComfyUI has, whatever precision it downloaded; a
      // missing one is named here rather than in ComfyUI's validation error.
      const report = status.models.find((entry) => entry.id === presetModel.id);
      if (!report || report.missing.length) {
        const missing = report?.missing.map((file) => file.what) ?? [];
        throw new Error(`ComfyUI is missing ${missing.join(", ")} for ${presetModel.label}. Add it, or pick another model in Admin > Images.`);
      }
      model = presetModel;
      files = report.files;
    } else {
      checkpoint = status.checkpoints[0] || "";
      if (!checkpoint) {
        throw new Error(
          "ComfyUI has no checkpoints installed. Put a model in ComfyUI/models/checkpoints and refresh.",
        );
      }
    }
  }
  if (!presetModel) {
    model = checkpointModel(checkpoint) ?? ANY_CHECKPOINT;
    files = { [(model.graph.load as { checkpoint: string }).checkpoint]: checkpoint };
  }

  const seed = options.seed ?? Math.floor(Math.random() * 2_147_483_647);
  const { width, height } = modelDimensions(model, options.mode, options.aspect);
  // A model that runs without a negative prompt has nowhere to put a table
  // boundary's picture negatives, and they are not folded into the prompt:
  // "Leave out: blood, wounds" in a positive prompt paints blood and wounds.
  const workflow = buildModelWorkflow(model, { prompt: options.prompt, negative: options.negative, width, height, seed, files });

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

  recordMediaFile(`/generated/${filename}`);
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
