import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ADDON_API_VERSION } from "@/lib/addons/manifest";
import {
  importerResultSchema,
  MAX_INLINE_BUNDLE_BYTES,
  normalizeOptionValues,
  toolPayload,
  type ImporterArguments,
} from "@/lib/addons/contracts";
import { hostFacts, readyAddon } from "@/lib/addons/installed";
import { resolveInside } from "@/lib/addons/paths";
import { callAddonTool } from "@/lib/addons/runtime";
import { createTask, finishTask, inputDir, outputDir, reportProgress, type AddonTask } from "@/lib/addons/tasks";
import { claimUpload, type PendingUpload } from "@/lib/addons/uploads";
import { withManifestDefaults } from "@/lib/addons/import-defaults";
import { sniffImage } from "@/lib/addons/sniff";
import { bundleCounts, encodeBundleImage, readBundle } from "@/lib/workshop/bundle";
import { MAX_ADDON_BUNDLE_BYTES, MAX_BUNDLE_BYTES, MAX_BUNDLE_IMAGE_BYTES } from "@/lib/workshop/bundle-schema";

// A workshop importer run: the DM's file goes to the addon, a workshop
// bundle comes back, and the bundle waits beside the task until the DM has
// seen the preview and pressed Import, which goes through the same route and
// the same checks as a bundle opened from a file (/api/workshops/import).
// Nothing is written into any workshop by the addon itself.

export const BUNDLE_FILE = "bundle.json";

// Fields a picture goes in, which an importer may fill with "file:<name>",
// a file it wrote to outputDir, instead of a data URL; and the files a map
// keeps for an addon's board view (a .glb model and its pictures).
const PICTURE_FIELDS = new Set(["image", "portrait", "backdrop"]);
const VIEW_FILE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
};

async function fileAsDataUrl(dir: string, ref: string, picture: boolean): Promise<string> {
  const name = ref.slice("file:".length);
  const file = resolveInside(dir, name);
  if (!file) throw new Error(`${ref} names a file outside outputDir.`);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new Error(`The bundle names ${ref}, which the addon did not write.`);
  const limit = picture ? MAX_BUNDLE_IMAGE_BYTES : MAX_BUNDLE_BYTES;
  if (info.size > limit) throw new Error(`${name} is ${Math.round(info.size / 1024 / 1024)} MB; ${picture ? "a picture" : "a map's file"} may be ${limit / 1024 / 1024} MB.`);
  const bytes = await readFile(file);
  if (picture) {
    const encoded = encodeBundleImage(file, bytes);
    if (!encoded) throw new Error(`${name} is not a PNG, JPEG or WebP picture.`);
    return encoded;
  }
  const type = VIEW_FILE_TYPES[path.extname(file).toLowerCase()];
  if (!type) throw new Error(`${name} is not a .glb model or a picture.`);
  // Held to its bytes here, as a map generator's files are (run-map.ts):
  // the import checks them again and would drop a bad one without a word.
  if (type === "model/gltf-binary") {
    if (bytes.subarray(0, 4).toString("latin1") !== "glTF") throw new Error(`${name} is not a binary glTF file.`);
    return `data:${type};base64,${bytes.toString("base64")}`;
  }
  const sniffed = sniffImage(bytes);
  if (!sniffed) throw new Error(`${name} is not a PNG, JPEG or WebP picture.`);
  return `data:${sniffed};base64,${bytes.toString("base64")}`;
}

// Swaps every "file:<name>" in a picture field (and in a map's board view
// files) for the file's contents, so the bundle that is checked and kept is
// whole. The rest of the bundle is left exactly as the addon wrote it.
export async function inlineBundleFiles(value: unknown, dir: string, inView = false): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((entry) => inlineBundleFiles(entry, dir, inView)));
  }
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string" && entry.startsWith("file:") && (PICTURE_FIELDS.has(key) || (inView && key === "data"))) {
      out[key] = await fileAsDataUrl(dir, entry, PICTURE_FIELDS.has(key));
    } else {
      out[key] = await inlineBundleFiles(entry, dir, inView || key === "addonView");
    }
  }
  return out;
}

function matchesAccept(upload: Pick<PendingUpload, "name" | "mime">, accepts: string[]): boolean {
  const extension = path.extname(upload.name).toLowerCase();
  return accepts.some((entry) => (entry.startsWith(".") ? entry.toLowerCase() === extension : entry.toLowerCase() === upload.mime.toLowerCase()));
}

async function readResultBundle(task: AddonTask, result: { bundleFile?: string; bundle?: Record<string, unknown> }): Promise<unknown> {
  if (result.bundle) {
    if (JSON.stringify(result.bundle).length > MAX_INLINE_BUNDLE_BYTES) {
      throw new Error("An inline bundle may be 8 MB; write a larger one to outputDir and return bundleFile.");
    }
    return result.bundle;
  }
  const file = resolveInside(outputDir(task), result.bundleFile ?? "");
  if (!file) throw new Error("bundleFile names a file outside outputDir.");
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new Error(`The addon named ${result.bundleFile}, which it did not write.`);
  if (info.size >= MAX_ADDON_BUNDLE_BYTES) {
    throw new Error(`The bundle is ${Math.round(info.size / 1024 / 1024)} MB; a workshop bundle from an addon may be ${MAX_ADDON_BUNDLE_BYTES / 1024 / 1024} MB.`);
  }
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(`${result.bundleFile} is not JSON.`);
  }
}

async function run(task: AddonTask, tool: string, args: ImporterArguments, addonName: string) {
  try {
    const raw = await callAddonTool(task.addonId, tool, args as unknown as Record<string, unknown>, {
      signal: task.controller.signal,
      onProgress: (update) => reportProgress(task, update),
      sampling: { scope: { userId: task.userId } },
      task,
    });
    const payload = toolPayload(raw);
    if (!payload.ok) throw new Error(payload.error);
    const parsed = importerResultSchema.safeParse(payload.value);
    if (!parsed.success) {
      throw new Error(`The addon's result does not match the importer contract: ${parsed.error.issues[0]?.message ?? "unknown problem"}.`);
    }
    reportProgress(task, { progress: 0, message: "Checking what it found" });
    const made = await inlineBundleFiles(await readResultBundle(task, parsed.data), outputDir(task));
    const bundle = withManifestDefaults(made, args.input.name, addonName);
    const text = JSON.stringify(bundle);
    // The same reader a bundle file goes through, so what the addon made is
    // held to every rule a stranger's bundle is (with room for its art).
    const read = readBundle(text, { maxBytes: MAX_ADDON_BUNDLE_BYTES });
    if ("error" in read) throw new Error(`The bundle the addon made does not read: ${read.error}`);
    await writeFile(path.join(task.dir, BUNDLE_FILE), text, "utf8");
    finishTask(task, {
      result: { name: read.bundle.manifest.name, counts: bundleCounts(read.bundle) },
      notes: parsed.data.notes,
    });
  } catch (error) {
    finishTask(task, { error: error instanceof Error ? error.message : String(error) });
  }
}

export type StartImport = {
  user: { id: string };
  addonId: string;
  importerId: string;
  upload: PendingUpload;
  options: unknown;
};

export async function startImport(input: StartImport): Promise<{ ok: true; task: AddonTask } | { ok: false; status: number; error: string }> {
  const ready = readyAddon(input.addonId);
  if (!ready.ok) return { ok: false, status: 409, error: ready.error };
  const { manifest } = ready.addon;
  const importer = manifest.contributes.workshopImporters.find((entry) => entry.id === input.importerId);
  if (!importer) return { ok: false, status: 404, error: `${manifest.name} has no importer called ${input.importerId}.` };
  if (!matchesAccept(input.upload, importer.accepts)) {
    return { ok: false, status: 400, error: `${importer.title} reads ${importer.accepts.join(", ")} files.` };
  }
  if (input.upload.size > importer.maxInputMB * 1024 * 1024) {
    return { ok: false, status: 413, error: `${importer.title} takes files up to ${importer.maxInputMB} MB.` };
  }
  const created = await createTask({
    kind: "workshop-import",
    addonId: manifest.id,
    addonName: manifest.name,
    contributionId: importer.id,
    title: `${importer.title}: ${input.upload.name}`,
    userId: input.user.id,
    campaignId: "",
  });
  if (!created.ok) return { ok: false, status: 429, error: created.error };
  const task = created.task;
  const claimed = await claimUpload(input.upload, inputDir(task));
  if (!claimed.ok) {
    finishTask(task, { error: claimed.error });
    return { ok: false, status: 400, error: claimed.error };
  }
  const facts = hostFacts();
  const args: ImporterArguments = {
    input: { path: claimed.path, name: input.upload.name, mime: input.upload.mime, bytes: input.upload.size },
    outputDir: outputDir(task),
    options: normalizeOptionValues(importer.options, input.options),
    host: { serverVersion: facts.serverVersion, apiVersion: ADDON_API_VERSION, platform: facts.platform },
  };
  void run(task, importer.tool, args, manifest.name);
  return { ok: true, task };
}

// The bundle a finished import left, for /api/workshops/import.
export async function importedBundleText(task: AddonTask): Promise<string | null> {
  if (task.kind !== "workshop-import" || task.status !== "done") return null;
  return readFile(path.join(task.dir, BUNDLE_FILE), "utf8").catch(() => null);
}
