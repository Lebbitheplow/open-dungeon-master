import { COMFY_MODELS } from "./catalog.ts";
import type { ComfyFile, ComfyFolder, ComfyModel, ModelFiles } from "./types.ts";

// Which catalog models a ComfyUI can run, which ones its hardware was seen
// running (verified.json), and in what order to offer them. Pure, so the
// tests drive it without a ComfyUI.

// Each loader's file list, as ComfyUI declares it (readComfyFiles).
export type ComfyLists = Partial<Record<ComfyFolder, readonly string[]>>;

const fileName = (name: string) => name.split(/[\\/]/).pop() ?? name;

// The file a ComfyUI has for one catalog slot: an official name first, in
// the catalog's order of preference, then any other precision or rename of
// the same weights, first in ComfyUI's list. "" = not found.
export function pickFile(file: ComfyFile, names: readonly string[]): string {
  for (const wanted of file.names) {
    const hit = names.find((name) => fileName(name).toLowerCase() === wanted.toLowerCase());
    if (hit) return hit;
  }
  return (file.family && names.find((name) => file.family!.test(fileName(name)))) || "";
}

export function pickModelFiles(model: ComfyModel, lists: ComfyLists): ModelFiles {
  return Object.fromEntries(
    Object.entries(model.files).map(([slot, file]) => [slot, pickFile(file, lists[file.folder] ?? [])]),
  );
}

export function missingFiles(model: ComfyModel, files: ModelFiles): ComfyFile[] {
  return Object.entries(model.files)
    .filter(([slot]) => !files[slot])
    .map(([, file]) => file);
}

// What a ComfyUI still needs before it can paint with a model, worded for
// the admin; empty once every file is there.
export function modelMissing(model: ComfyModel, files: ModelFiles): string[] {
  return missingFiles(model, files).map((file) => file.what);
}

// Checkpoints that are not picture models: video and audio models,
// upscalers and refiners all sit in models/checkpoints too, and a picture
// asked of one fails in ComfyUI.
const NOT_A_PICTURE =
  /(ltx|ltxv|upscaler|refiner|svd|stable[-_ ]?video|hunyuan[-_ ]?video|wan[-_ ]?2|mochi|cosmos.*(video|2b|14b)|stable[-_ ]?audio|ace[-_ ]?step|vace)/i;

export function isPictureCheckpoint(name: string): boolean {
  return !NOT_A_PICTURE.test(fileName(name));
}

// The catalog model a checkpoint file is, for its settings: SD 3.5 wants
// other steps and sampler than SDXL. Null = an unknown checkpoint.
export function checkpointModel(checkpoint: string): ComfyModel | null {
  if (!checkpoint) return null;
  for (const model of COMFY_MODELS) {
    if ("checkpoint" in model.graph.load && pickFile(model.files[model.graph.load.checkpoint], [checkpoint])) {
      return model;
    }
  }
  return null;
}

// Hardware a measurement was taken on. A row in verified.json names one of
// these; the picker shows a model's row for the hardware it is talking to.
export type HardwareProfile = { id: string; label: string; match: RegExp };

export const HARDWARE_PROFILES: readonly HardwareProfile[] = [
  {
    id: "strix-halo",
    label: "AMD Strix Halo",
    match: /Radeon(\s*\(TM\))?\s*80[4-6]0S|gfx1151|Ryzen\s*AI\s*Max/i,
  },
];

// What ComfyUI's GET /system_stats says about the machine it runs on.
export type ComfyDevice = {
  name: string;
  // Memory the GPU can use: its VRAM, or on a unified-memory machine the
  // share of system memory the driver lets it map.
  memoryGb: number;
  ramGb: number;
  torch: string;
  comfyui: string;
};

const gb = (bytes: unknown) => (typeof bytes === "number" && bytes > 0 ? Math.round((bytes / 1024 ** 3) * 10) / 10 : 0);

export function readComfyDevice(json: unknown): ComfyDevice | null {
  const stats = json as {
    system?: { ram_total?: unknown; pytorch_version?: unknown; comfyui_version?: unknown };
    devices?: Array<{ name?: unknown; vram_total?: unknown }>;
  } | null;
  const device = stats?.devices?.[0];
  if (!device || typeof device.name !== "string") return null;
  return {
    // "cuda:0 AMD Radeon 8060S Graphics : native"
    name: device.name.replace(/^\w+:\d+\s+/, "").replace(/\s*:\s*\w+$/, "").trim(),
    memoryGb: gb(device.vram_total),
    ramGb: gb(stats?.system?.ram_total),
    torch: typeof stats?.system?.pytorch_version === "string" ? stats.system.pytorch_version : "",
    comfyui: typeof stats?.system?.comfyui_version === "string" ? stats.system.comfyui_version : "",
  };
}

export function hardwareProfile(device: Pick<ComfyDevice, "name"> | null): HardwareProfile | null {
  return (device && HARDWARE_PROFILES.find((profile) => profile.match.test(device.name))) || null;
}

// One measurement: a catalog model on one kind of hardware
// (scripts/bench-image-models.mjs --write).
export type VerifiedRow = {
  model: string;
  hardware: string;
  device: string;
  memoryGb: number;
  comfyui: string;
  torch: string;
  date: string;
  files: Record<string, string>;
  steps: number;
  // Seconds per picture once the model is loaded, at ODM's fast sizes.
  seconds: { square: number; landscape: number };
  // The first picture, loading the files from disk.
  coldSeconds: number;
  // Peak GPU memory while painting, in GB.
  peakGb: number;
  // "recommended": fit for a table's portraits and scenes. "works": runs,
  // with a weakness the note names. "poor": runs, but its pictures are not
  // fit for a table. "fails": does not run on this hardware.
  verdict: "recommended" | "works" | "poor" | "fails";
  notes?: string;
};

export type CuratedModel = {
  model: ComfyModel;
  files: ModelFiles;
  missing: ComfyFile[];
  // GB still to download, each shared file counted once.
  downloadGb: number;
  // This hardware's measurement, when it has one.
  verified: VerifiedRow | null;
  // The least GPU memory any hardware peaked at with it (a unified-memory
  // machine keeps every file resident, so this is an upper bound for a card
  // ComfyUI can offload to), and whether this GPU has that much. Null when
  // nothing has measured it.
  needGb: number | null;
  fits: boolean | null;
};

const VERDICT_RANK: Record<VerifiedRow["verdict"] | "unverified", number> = { recommended: 0, works: 1, unverified: 2, poor: 3, fails: 4 };

// The hardware profiles a model ran on: the catalog's "supported hardware".
export function supportedHardware(modelId: string, rows: readonly VerifiedRow[]): string[] {
  return rows.filter((row) => row.model === modelId && row.verdict !== "fails").map((row) => row.hardware);
}

// Every catalog model for one ComfyUI: installed ones first, then by what
// its hardware made of each, then by speed.
export function curateModels(input: {
  lists: ComfyLists;
  device: ComfyDevice | null;
  rows: readonly VerifiedRow[];
  models?: readonly ComfyModel[];
}): CuratedModel[] {
  const hardware = hardwareProfile(input.device);
  const curated = (input.models ?? COMFY_MODELS).map((model): CuratedModel => {
    const files = pickModelFiles(model, input.lists);
    const missing = missingFiles(model, files);
    const urls = new Set<string>();
    const downloadGb = missing.reduce((sum, file) => (urls.has(file.url) ? sum : (urls.add(file.url), sum + file.sizeGb)), 0);
    const verified = (hardware && input.rows.find((row) => row.model === model.id && row.hardware === hardware.id)) || null;
    const peaks = input.rows.filter((row) => row.model === model.id && row.verdict !== "fails" && row.peakGb > 0).map((row) => row.peakGb);
    const needGb = peaks.length ? Math.min(...peaks) : null;
    return {
      model,
      files,
      missing,
      downloadGb: Math.round(downloadGb * 10) / 10,
      verified,
      needGb,
      fits: needGb === null || !input.device?.memoryGb ? null : needGb <= input.device.memoryGb,
    };
  });
  const rank = (entry: CuratedModel) => VERDICT_RANK[entry.verified?.verdict ?? "unverified"];
  const seconds = (entry: CuratedModel) => entry.verified?.seconds.square || Number.MAX_SAFE_INTEGER;
  return curated.sort(
    (a, b) =>
      Number(a.missing.length > 0) - Number(b.missing.length > 0) ||
      rank(a) - rank(b) ||
      Number(a.fits === false) - Number(b.fits === false) ||
      seconds(a) - seconds(b),
  );
}
