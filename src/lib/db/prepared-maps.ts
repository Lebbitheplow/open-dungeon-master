import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { normalizeBackdrop, type Backdrop, type BackdropTransform } from "@/lib/battlemap/backdrop";
import type { AmbientLight, MapLight } from "@/lib/battlemap/types";
import type { MapTheme } from "@/lib/battlemap/generate";
import {
  EMPTY_AMBIENCE,
  normalizeAmbience,
  normalizeDoors,
  normalizeLabels,
  normalizeProps,
  normalizeZones,
  type DoorStates,
  type LightZone,
  type MapLabel,
  type MapProp,
  type SceneAmbience,
} from "@/lib/battlemap/scene";
import { isUploadedImagePath } from "@/lib/uploads";
import { dedupeName } from "@/lib/workshop/import";

// The map library: maps a DM built before anybody needed them.
//
// A battle_maps row always belongs to an encounter, which is right for a
// board on the table and wrong for a dungeon drawn three weeks early. The
// plan called for making battle_maps.encounter_id nullable; that would put a
// second lifecycle through every token, fog and movement path that assumes
// the link, for the sake of prep that needs none of them. So prepared maps
// hold the ground only, and deploying one copies its terrain into a fresh
// encounter's battle map. Nothing on the table ever points here.
//
// Campaign-scoped rather than user-scoped, which is what makes a workshop a
// map library for free: a workshop is a campaign row (src/lib/workshop/
// kind.ts), so maps drawn in one travel into a real campaign through the
// same import as everything else.
//
// A prepared map's terrain is always the DRAWN terrain: door states live
// beside it and are resolved into walls only when the map is on a table
// (src/lib/db/battle-maps.ts), because nothing walks a prepared map.

export type PreparedMap = {
  id: string;
  campaignId: string;
  name: string;
  notes: string;
  tags: string[];
  width: number;
  height: number;
  terrain: string;
  ambient: AmbientLight;
  theme: MapTheme;
  lights: MapLight[];
  seed: number;
  backdrop: Backdrop | null;
  // The scene layer (src/lib/battlemap/scene.ts).
  labels: MapLabel[];
  props: MapProp[];
  doors: DoorStates;
  zones: LightZone[];
  overlayPath: string;
  ambience: SceneAmbience;
  updatedAt: string;
};

type Row = {
  id: string;
  campaign_id: string;
  name: string;
  notes: string;
  tags_json: string;
  width: number;
  height: number;
  terrain: string;
  ambient: AmbientLight;
  theme: MapTheme;
  lights_json: string;
  seed: number;
  backdrop_path: string | null;
  backdrop_transform_json: string | null;
  labels_json: string | null;
  props_json: string | null;
  doors_json: string | null;
  zones_json: string | null;
  overlay_path: string | null;
  ambience_json: string | null;
  updated_at: string;
};

function mapRow(row: Row): PreparedMap {
  const overlay = row.overlay_path ?? "";
  return {
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    notes: row.notes ?? "",
    tags: parseJson<string[]>(row.tags_json, []),
    width: row.width,
    height: row.height,
    terrain: row.terrain,
    ambient: row.ambient,
    theme: row.theme ?? "field",
    lights: parseJson<MapLight[]>(row.lights_json, []),
    seed: row.seed,
    backdrop: normalizeBackdrop(
      row.backdrop_path ?? "",
      parseJson<unknown>(row.backdrop_transform_json ?? "{}", {}),
    ),
    labels: normalizeLabels(parseJson<unknown>(row.labels_json ?? "[]", []), row.width, row.height),
    props: normalizeProps(parseJson<unknown>(row.props_json ?? "[]", []), row.terrain, row.width, row.height),
    doors: normalizeDoors(parseJson<unknown>(row.doors_json ?? "{}", {}), row.terrain, row.width, row.height),
    zones: normalizeZones(parseJson<unknown>(row.zones_json ?? "[]", []), row.width, row.height),
    overlayPath: overlay && isUploadedImagePath(overlay) ? overlay : "",
    ambience: normalizeAmbience(parseJson<unknown>(row.ambience_json ?? "{}", {})),
    updatedAt: row.updated_at,
  };
}

export function listPreparedMaps(campaignId: string): PreparedMap[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM prepared_maps WHERE campaign_id = ? ORDER BY updated_at DESC`)
    .all(campaignId) as Row[];
  return rows.map(mapRow);
}

export function getPreparedMap(campaignId: string, mapId: string): PreparedMap | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM prepared_maps WHERE id = ? AND campaign_id = ?`)
    .get(mapId, campaignId) as Row | undefined;
  return row ? mapRow(row) : null;
}

export type PreparedScene = {
  labels?: MapLabel[];
  props?: MapProp[];
  doors?: DoorStates;
  zones?: LightZone[];
  overlayPath?: string;
  ambience?: SceneAmbience;
};

export type PreparedMapInput = {
  campaignId: string;
  name: string;
  notes?: string;
  tags?: string[];
  width: number;
  height: number;
  terrain: string;
  ambient: AmbientLight;
  theme: MapTheme;
  lights?: MapLight[];
  seed?: number;
  backdrop?: Backdrop | null;
  scene?: PreparedScene;
};

// Every scene column written through one normalizer, so a prepared map can
// never hold a label off its own grid or a door state on a floor tile.
function sceneColumns(scene: PreparedScene | undefined, terrain: string, width: number, height: number) {
  const overlay = scene?.overlayPath ?? "";
  return {
    labels: JSON.stringify(normalizeLabels(scene?.labels ?? [], width, height)),
    props: JSON.stringify(normalizeProps(scene?.props ?? [], terrain, width, height)),
    doors: JSON.stringify(normalizeDoors(scene?.doors ?? {}, terrain, width, height)),
    zones: JSON.stringify(normalizeZones(scene?.zones ?? [], width, height)),
    overlay: overlay && isUploadedImagePath(overlay) ? overlay : "",
    ambience: JSON.stringify(normalizeAmbience(scene?.ambience ?? EMPTY_AMBIENCE)),
  };
}

// Names are unique per campaign so the library can be scanned by eye, and a
// clash is numbered rather than refused: a DM who saves "Crypt" twice meant
// to keep both, and losing the second to a constraint would be the worst
// possible answer. Same rule the workshop import follows.
export function createPreparedMap(input: PreparedMapInput): PreparedMap {
  // dedupeName compares and records lowercased, which is the same collation
  // the table's UNIQUE constraint uses.
  const taken = new Set(listPreparedMaps(input.campaignId).map((map) => map.name.toLowerCase()));
  const name = dedupeName(input.name, taken);
  const backdrop = normalizeBackdrop(input.backdrop?.path ?? "", input.backdrop?.transform);
  const scene = sceneColumns(input.scene, input.terrain, input.width, input.height);
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO prepared_maps (id, campaign_id, name, notes, tags_json, width, height, terrain,
         ambient, theme, lights_json, seed, backdrop_path, backdrop_transform_json,
         labels_json, props_json, doors_json, zones_json, overlay_path, ambience_json,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.campaignId,
      name,
      (input.notes ?? "").slice(0, 4000),
      JSON.stringify(normalizeTags(input.tags ?? [])),
      input.width,
      input.height,
      input.terrain,
      input.ambient,
      input.theme,
      JSON.stringify(input.lights ?? []),
      input.seed ?? 0,
      backdrop?.path ?? "",
      JSON.stringify(backdrop?.transform ?? {}),
      scene.labels,
      scene.props,
      scene.doors,
      scene.zones,
      scene.overlay,
      scene.ambience,
      now,
      now,
    );
  return getPreparedMap(input.campaignId, id) as PreparedMap;
}

// Short, lowercase, deduplicated. Tags exist to be filtered on, and a tag
// list that distinguishes "Crypt" from "crypt" filters on nothing.
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const clean = String(tag).trim().toLowerCase().slice(0, 24);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
    if (out.length >= 8) {
      break;
    }
  }
  return out;
}

export type PreparedMapPatch = {
  name?: string;
  notes?: string;
  tags?: string[];
  ambient?: AmbientLight;
  theme?: MapTheme;
  terrain?: string;
  // Already normalized by the caller (src/lib/battlemap/lights.ts); this
  // rim stores what it is handed.
  lights?: MapLight[];
  backdropPath?: string;
  backdropTransform?: BackdropTransform | null;
  scene?: PreparedScene;
};

export function updatePreparedMap(
  campaignId: string,
  mapId: string,
  patch: PreparedMapPatch,
): PreparedMap | null {
  const existing = getPreparedMap(campaignId, mapId);
  if (!existing) {
    return null;
  }
  // A rename that collides is numbered, exactly as a fresh save is, but the
  // map's own current name is not a collision with itself.
  const name =
    patch.name !== undefined && patch.name.trim() && patch.name.trim() !== existing.name
      ? dedupeName(
          patch.name,
          new Set(
            listPreparedMaps(campaignId)
              .filter((map) => map.id !== mapId)
              .map((map) => map.name.toLowerCase()),
          ),
        )
      : existing.name;

  // Terrain is only ever replaced wholesale by something that has already
  // been validated (a paint, an import); this never edits it in place.
  const terrain =
    patch.terrain && patch.terrain.length === existing.width * existing.height
      ? patch.terrain
      : existing.terrain;

  const backdrop =
    patch.backdropPath === undefined && patch.backdropTransform === undefined
      ? existing.backdrop
      : normalizeBackdrop(
          patch.backdropPath ?? existing.backdrop?.path ?? "",
          patch.backdropTransform ?? existing.backdrop?.transform,
        );

  // The scene layer is re-normalized against the terrain being written, so
  // a door painted over loses its state and a prop painted into rock is
  // dropped, in the same write.
  const scene = sceneColumns(
    {
      labels: patch.scene?.labels ?? existing.labels,
      props: patch.scene?.props ?? existing.props,
      doors: patch.scene?.doors ?? existing.doors,
      zones: patch.scene?.zones ?? existing.zones,
      overlayPath: patch.scene?.overlayPath ?? existing.overlayPath,
      ambience: patch.scene?.ambience ?? existing.ambience,
    },
    terrain,
    existing.width,
    existing.height,
  );

  getDatabase()
    .prepare(
      `UPDATE prepared_maps SET name = ?, notes = ?, tags_json = ?, ambient = ?, theme = ?,
         terrain = ?, lights_json = ?, backdrop_path = ?, backdrop_transform_json = ?,
         labels_json = ?, props_json = ?, doors_json = ?, zones_json = ?, overlay_path = ?,
         ambience_json = ?, updated_at = ?
       WHERE id = ? AND campaign_id = ?`,
    )
    .run(
      name,
      (patch.notes ?? existing.notes).slice(0, 4000),
      JSON.stringify(normalizeTags(patch.tags ?? existing.tags)),
      patch.ambient ?? existing.ambient,
      patch.theme ?? existing.theme,
      terrain,
      JSON.stringify(patch.lights ?? existing.lights),
      backdrop?.path ?? "",
      JSON.stringify(backdrop?.transform ?? {}),
      scene.labels,
      scene.props,
      scene.doors,
      scene.zones,
      scene.overlay,
      scene.ambience,
      nowIso(),
      mapId,
      campaignId,
    );
  return getPreparedMap(campaignId, mapId);
}

export function deletePreparedMap(campaignId: string, mapId: string): boolean {
  const result = getDatabase()
    .prepare(`DELETE FROM prepared_maps WHERE id = ? AND campaign_id = ?`)
    .run(mapId, campaignId);
  return result.changes > 0;
}

// The whole library copied from one campaign into another, for the workshop
// import. The backdrop path travels as-is: it points at a file in
// public/uploads that both campaigns can read, and copying the image would
// duplicate megabytes to no purpose.
export function copyPreparedMaps(fromCampaignId: string, toCampaignId: string): number {
  const source = listPreparedMaps(fromCampaignId);
  if (!source.length) {
    return 0;
  }
  const taken = new Set(listPreparedMaps(toCampaignId).map((map) => map.name.toLowerCase()));
  const db = getDatabase();
  let copied = 0;
  db.transaction(() => {
    for (const map of source) {
      // dedupeName records what it hands back, so successive copies of the
      // same name number upward instead of all colliding on (2).
      const name = dedupeName(map.name, taken);
      const now = nowIso();
      db.prepare(
        `INSERT INTO prepared_maps (id, campaign_id, name, notes, tags_json, width, height, terrain,
           ambient, theme, lights_json, seed, backdrop_path, backdrop_transform_json,
           labels_json, props_json, doors_json, zones_json, overlay_path, ambience_json,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        toCampaignId,
        name,
        map.notes,
        JSON.stringify(map.tags),
        map.width,
        map.height,
        map.terrain,
        map.ambient,
        map.theme,
        JSON.stringify(map.lights),
        map.seed,
        map.backdrop?.path ?? "",
        JSON.stringify(map.backdrop?.transform ?? {}),
        JSON.stringify(map.labels),
        JSON.stringify(map.props),
        JSON.stringify(map.doors),
        JSON.stringify(map.zones),
        map.overlayPath,
        JSON.stringify(map.ambience),
        now,
        now,
      );
      copied += 1;
    }
  })();
  return copied;
}

export function countPreparedMaps(campaignId: string): number {
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) AS n FROM prepared_maps WHERE campaign_id = ?`)
    .get(campaignId) as { n: number };
  return row.n;
}
