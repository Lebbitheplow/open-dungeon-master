import { ADDON_ID } from "@/lib/addons/manifest";
import { isUploadedImagePath, isUploadedModelPath } from "@/lib/uploads";
import { viewDataProblem } from "@/lib/addons/view-data";

// What a map addon left on a map for its board view: free-form data and the
// files it drew from (a .glb model, textures). Stored as addon_view_json on
// prepared_maps and battle_maps, carried from the library onto the table
// with the rest of the map, and handed only to the board view of the addon
// that made it (src/lib/addons/board-bridge.ts).
//
// Cosmetic, like a backdrop: the terrain string is still the only thing the
// rules read, and a server without the addon draws the map as it always did.
//
// Pure, so the board, the bundle code and the tests share one reading.

export type MapAddonFile = { name: string; path: string; type: string; bytes: number };

export type MapAddonView = {
  addonId: string;
  data: unknown;
  files: MapAddonFile[];
};

export function normalizeMapAddonView(raw: unknown): MapAddonView | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const addonId = typeof record.addonId === "string" ? record.addonId : "";
  if (!ADDON_ID.test(addonId)) return null;
  // Every door that takes view data from outside refuses it first with
  // viewDataProblem; this only keeps an impossible row out of storage.
  const data: unknown = viewDataProblem(record.data) ? null : (record.data ?? null);
  const files: MapAddonFile[] = [];
  const names = new Set<string>();
  for (const entry of Array.isArray(record.files) ? record.files.slice(0, 8) : []) {
    const file = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const name = typeof file.name === "string" ? file.name.slice(0, 120) : "";
    const path = typeof file.path === "string" ? file.path : "";
    if (!name || names.has(name) || !(isUploadedModelPath(path) || isUploadedImagePath(path))) continue;
    names.add(name);
    files.push({
      name,
      path,
      type: typeof file.type === "string" ? file.type.slice(0, 60) : "",
      bytes: typeof file.bytes === "number" && Number.isFinite(file.bytes) ? Math.max(0, Math.round(file.bytes)) : 0,
    });
  }
  return { addonId, data, files };
}

export function parseMapAddonView(json: string | null | undefined): MapAddonView | null {
  if (!json) return null;
  try {
    return normalizeMapAddonView(JSON.parse(json));
  } catch {
    return null;
  }
}

export function serializeMapAddonView(view: MapAddonView | null | undefined): string {
  const normalized = normalizeMapAddonView(view);
  return normalized ? JSON.stringify(normalized) : "";
}
