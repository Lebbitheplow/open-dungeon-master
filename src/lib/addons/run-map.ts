import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ADDON_API_VERSION } from "@/lib/addons/manifest";
import {
  MAX_BACKDROP_BYTES,
  MAX_VIEW_FILE_BYTES,
  mapResultSchema,
  normalizeOptionValues,
  toolPayload,
  viewFileType,
  type MapGeneratorArguments,
  type MapRequest,
  type MapResult,
} from "@/lib/addons/contracts";
import { hostFacts, readyAddon } from "@/lib/addons/installed";
import type { MapAddonFile, MapAddonView } from "@/lib/addons/map-view";
import { resolveInside } from "@/lib/addons/paths";
import { callAddonTool } from "@/lib/addons/runtime";
import { createTask, finishTask, outputDir, reportProgress, type AddonTask } from "@/lib/addons/tasks";
import type { MapTheme } from "@/lib/battlemap/generate";
import type { Campaign } from "@/lib/db/campaigns";
import { createPreparedMap } from "@/lib/db/prepared-maps";
import { recordMediaFile } from "@/lib/media-access";
import { writeUploadedImage } from "@/lib/uploads-store";
import { sniffImage } from "@/lib/addons/sniff";
import { runInUsageScope } from "@/lib/usage/scope";

// A map generator run: the DM's request goes to the addon, a map comes back,
// and it lands in the campaign's (or workshop's) map library as a new
// prepared map. From there it is a map like any other: edited in the map
// editor, put on the table with Deploy, carried into a campaign by the
// workshop import. The addon never touches the library itself.

function isGlb(bytes: Uint8Array): boolean {
  return bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "glTF";
}

async function readOutput(task: AddonTask, name: string, limit: number): Promise<Buffer> {
  const file = resolveInside(outputDir(task), name);
  if (!file) throw new Error(`${name} is outside outputDir.`);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new Error(`The addon named ${name}, which it did not write.`);
  if (info.size > limit) throw new Error(`${name} is ${Math.round(info.size / 1024 / 1024)} MB; the most is ${Math.round(limit / 1024 / 1024)} MB.`);
  return readFile(file);
}

// A model goes into public/uploads under a fresh name, the same shape and
// the same access rule as every picture there (src/lib/media-access.ts).
async function writeModel(bytes: Buffer): Promise<string> {
  const dir = path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  const name = `${crypto.randomUUID()}.glb`;
  await writeFile(path.join(/*turbopackIgnore: true*/ dir, name), bytes);
  const url = `/uploads/${name}`;
  recordMediaFile(url);
  return url;
}

// The data's size was held to the cap by the contract (mapResultSchema).
async function landView(task: AddonTask, view: NonNullable<MapResult["view"]>): Promise<MapAddonView> {
  const data: unknown = view.data ?? null;
  const files: MapAddonFile[] = [];
  for (const name of view.files) {
    const type = viewFileType(name) ?? "";
    const bytes = await readOutput(task, name, type === "model/gltf-binary" ? MAX_VIEW_FILE_BYTES : MAX_BACKDROP_BYTES);
    if (type === "model/gltf-binary") {
      if (!isGlb(bytes)) throw new Error(`${name} is not a binary glTF file.`);
      files.push({ name, path: await writeModel(bytes), type, bytes: bytes.length });
      continue;
    }
    const sniffed = sniffImage(bytes);
    if (!sniffed) throw new Error(`${name} is not a PNG, JPEG or WebP picture.`);
    files.push({ name, path: (await writeUploadedImage(bytes, sniffed)).url, type: sniffed, bytes: bytes.length });
  }
  return { addonId: task.addonId, data, files };
}

async function run(task: AddonTask, campaign: Campaign, tool: string, args: MapGeneratorArguments) {
  try {
    const raw = await callAddonTool(task.addonId, tool, args as unknown as Record<string, unknown>, {
      signal: task.controller.signal,
      onProgress: (update) => reportProgress(task, update),
      sampling: { scope: { userId: task.userId, campaignId: campaign.id }, settings: campaign.settings },
      task,
    });
    const payload = toolPayload(raw);
    if (!payload.ok) throw new Error(payload.error);
    const parsed = mapResultSchema.safeParse(payload.value);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `The addon's map does not match the generator contract: ${issue ? `${issue.path.join(".")} ${issue.message}` : "unknown problem"}`,
      );
    }
    const result = parsed.data;
    reportProgress(task, { progress: 0, message: "Saving the map" });
    // Files land as the people who asked for them, in their campaign, so the
    // map's members may open them.
    const map = await runInUsageScope({ userId: task.userId, campaignId: campaign.id }, async () => {
      let backdrop: { path: string; transform: { offsetX: number; offsetY: number; scale: number; opacity: number } } | null = null;
      if (result.backdrop) {
        const bytes = await readOutput(task, result.backdrop.file, MAX_BACKDROP_BYTES);
        const type = sniffImage(bytes);
        if (!type) throw new Error(`${result.backdrop.file} is not a PNG, JPEG or WebP picture.`);
        const saved = await writeUploadedImage(bytes, type);
        backdrop = {
          path: saved.url,
          transform: { offsetX: 0, offsetY: 0, scale: 1, opacity: 1, ...result.backdrop.transform },
        };
      }
      const addonView = result.view ? await landView(task, result.view) : null;
      return createPreparedMap({
        campaignId: campaign.id,
        name: result.map.name || args.request.name,
        notes: result.map.notes,
        tags: result.map.tags,
        width: result.map.width,
        height: result.map.height,
        terrain: result.map.terrain,
        ambient: result.map.ambient ?? args.request.ambient,
        theme: (result.map.theme as MapTheme | undefined) ?? args.request.theme,
        lights: result.map.lights,
        seed: args.request.seed,
        backdrop,
        outdoors: result.map.outdoors ?? null,
        addonView,
      });
    });
    finishTask(task, {
      result: { preparedMapId: map.id, name: map.name, campaignId: campaign.id, backdrop: map.backdrop?.path ?? "" },
      notes: result.notes,
    });
  } catch (error) {
    finishTask(task, { error: error instanceof Error ? error.message : String(error) });
  }
}

export type StartMap = {
  user: { id: string };
  campaign: Campaign;
  addonId: string;
  generatorId: string;
  request: MapRequest;
  options: unknown;
};

export async function startMapGeneration(input: StartMap): Promise<{ ok: true; task: AddonTask } | { ok: false; status: number; error: string }> {
  const ready = readyAddon(input.addonId);
  if (!ready.ok) return { ok: false, status: 409, error: ready.error };
  const { manifest } = ready.addon;
  const generator = manifest.contributes.mapGenerators.find((entry) => entry.id === input.generatorId);
  if (!generator) return { ok: false, status: 404, error: `${manifest.name} has no map generator called ${input.generatorId}.` };
  const created = await createTask({
    kind: "map",
    addonId: manifest.id,
    addonName: manifest.name,
    contributionId: generator.id,
    title: `${generator.title}: ${input.request.name}`,
    userId: input.user.id,
    campaignId: input.campaign.id,
  });
  if (!created.ok) return { ok: false, status: 429, error: created.error };
  const facts = hostFacts();
  const args: MapGeneratorArguments = {
    request: input.request,
    outputDir: outputDir(created.task),
    options: normalizeOptionValues(generator.options, input.options),
    host: { serverVersion: facts.serverVersion, apiVersion: ADDON_API_VERSION, platform: facts.platform },
  };
  void run(created.task, input.campaign, generator.tool, args);
  return { ok: true, task: created.task };
}
