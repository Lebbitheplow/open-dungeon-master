import { getDatabase } from "@/lib/db/core";
import { getWorkshopForUser, listWorkshopsForUser } from "@/lib/db/workshops";
import { getCommonWorkshop } from "@/lib/db/workshop-common";
import { refFor } from "@/lib/db/workshop-bundle-export";
import type { OriginKind } from "@/lib/db/content-origins";
import {
  normalizeAmbience,
  normalizeDoors,
  normalizeDrawings,
  normalizeLabels,
  normalizeProps,
  normalizeZones,
} from "@/lib/battlemap/scene";
import { normalizeMapSkin } from "@/lib/battlemap/skins";
import { normalizeOverworldParams } from "@/lib/overworld/logic";
import { normalizeLabels as normalizeOverworldLabels, normalizePaths, normalizeSize } from "@/lib/overworld/features";
import type { WorkshopBundle } from "@/lib/workshop/bundle";
import { createHomebrewMonster, listHomebrewMonsters } from "@/lib/bestiary/homebrew-monsters";
import { createHomebrew, listHomebrew } from "@/lib/db/homebrew";
import { createCharacter } from "@/lib/db/characters";
import { savePackDraft } from "@/lib/db/world-pack-drafts";
import { insertShop } from "@/lib/db/shops";
import { getClock } from "@/lib/db/clock";
import { normalizeHomebrewData } from "@/lib/homebrew/gear";
import { draftFromData } from "@/lib/bestiary/monster-draft";

// The parts of writing a bundle back in that need more than one line each:
// a prepared map's scene layer, the region map, and finding the shared
// workshop a chapter bundle was written against (#159). Split from
// src/lib/db/workshop-bundle.ts to keep it under the project's 500-line cap.
// Everything here runs inside that module's transaction (one singleton
// connection, so its statements are part of it).

type BundleMap = WorkshopBundle["maps"][number];

// A prepared map, scene and all, every layer normalised against the map's
// own grid exactly as the map library's writer does
// (src/lib/db/prepared-maps.ts sceneColumns), so a hand-edited bundle
// cannot put a door on a floor tile or a label off the edge.
export function insertBundleMap(
  id: string,
  workshopId: string,
  map: BundleMap,
  art: { backdrop: string; overlay: string },
  now: string,
) {
  const { width, height, terrain } = map;
  getDatabase()
    .prepare(
      `INSERT INTO prepared_maps
         (id, campaign_id, name, notes, tags_json, width, height, terrain, ambient,
          theme, lights_json, seed, backdrop_path, backdrop_transform_json, skin_json,
          outdoors, labels_json, props_json, doors_json, zones_json, drawings_json,
          overlay_path, ambience_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      workshopId,
      map.name,
      map.notes,
      JSON.stringify(map.tags),
      width,
      height,
      terrain,
      map.ambient,
      map.theme,
      JSON.stringify(map.lights),
      map.seed,
      art.backdrop,
      // The transform only means something over its art.
      art.backdrop ? JSON.stringify(map.backdropTransform) : "{}",
      JSON.stringify(normalizeMapSkin(map.skin)),
      map.outdoors === null ? null : map.outdoors ? 1 : 0,
      JSON.stringify(normalizeLabels(map.labels, width, height)),
      JSON.stringify(normalizeProps(map.props, terrain, width, height)),
      JSON.stringify(normalizeDoors(map.doors, terrain, width, height)),
      JSON.stringify(normalizeZones(map.zones, width, height)),
      JSON.stringify(normalizeDrawings(map.drawings, width, height)),
      art.overlay,
      JSON.stringify(normalizeAmbience(map.ambience)),
      now,
      now,
    );
}

// A Market shop (#171), its place and keeper resolved from the indexes the
// bundle wrote and kept only when they landed in this workshop: a chapter's
// shared row that linked to another workshop is not this shop's to point
// at. A place that did not come keeps its name, so the shop still opens
// wherever a place of that name stands. Every field goes through the shop
// module's own normalisers. Returns how many of its links were dropped.
export function insertBundleShop(
  workshopId: string,
  shop: WorkshopBundle["shops"][number],
  locationIds: string[],
  npcIds: string[],
): number {
  const db = getDatabase();
  let dropped = 0;
  const own = (table: "locations" | "npcs", ids: string[], index: number | null): string => {
    if (index === null) {
      return "";
    }
    const id = ids[index];
    if (id && db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND campaign_id = ?`).get(id, workshopId)) {
      return id;
    }
    dropped += 1;
    return "";
  };
  const locationId = own("locations", locationIds, shop.location);
  const place = locationId ? (db.prepare(`SELECT name FROM locations WHERE id = ?`).get(locationId) as { name: string }) : null;
  insertShop(workshopId, {
    name: shop.name,
    kind: shop.kind,
    size: shop.size,
    locationId,
    locationName: place?.name ?? shop.locationName,
    keeperNpcId: own("npcs", npcIds, shop.keeper),
    stock: shop.stock,
    preparedStock: shop.preparedStock,
    markup: shop.markup,
    buys: shop.buys,
    restockDays: shop.restockDays,
    restockedAt: getClock(workshopId).instant,
  });
  return dropped;
}

const OVERWORLD_TILES = /^[wpfhms]*$/;

// The region map. Its size is held to what the map tools accept, its
// terrain to that size and to the tile alphabet, and everything drawn over
// it is normalised against it; an anchor names a place by index, and one
// that lands nowhere is dropped (src/lib/db/overworld.ts places it again).
// Returns whether a map was written: a malformed one is skipped, not fatal.
export function insertBundleOverworld(
  workshopId: string,
  region: NonNullable<WorkshopBundle["overworld"]>,
  locationIds: string[],
  backdrop: string,
  now: string,
): boolean {
  const size = normalizeSize(region, { width: region.width, height: region.height });
  if (
    size.width !== region.width ||
    size.height !== region.height ||
    region.terrain.length !== size.width * size.height ||
    !OVERWORLD_TILES.test(region.terrain)
  ) {
    return false;
  }
  const anchors: Record<string, { x: number; y: number }> = {};
  for (const anchor of region.anchors) {
    const id = locationIds[anchor.location];
    if (id && anchor.x >= 0 && anchor.y >= 0 && anchor.x < size.width && anchor.y < size.height) {
      anchors[id] = { x: anchor.x, y: anchor.y };
    }
  }
  const pins = region.pins.slice(0, 40).flatMap((raw) => {
    const pin = (raw ?? {}) as { id?: unknown; x?: unknown; y?: unknown; label?: unknown };
    const x = Math.round(Number(pin.x));
    const y = Math.round(Number(pin.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return [];
    }
    return [{
      id: crypto.randomUUID(),
      x: Math.min(size.width - 1, Math.max(0, x)),
      y: Math.min(size.height - 1, Math.max(0, y)),
      label: String(pin.label ?? "").slice(0, 60),
    }];
  });
  getDatabase()
    .prepare(
      `INSERT OR REPLACE INTO overworld_maps
         (campaign_id, seed, width, height, terrain, anchors_json, pins_json, params_json,
          party_xy_json, notes, paths_json, labels_json, backdrop_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      workshopId,
      region.seed >>> 0,
      size.width,
      size.height,
      region.terrain,
      JSON.stringify(anchors),
      JSON.stringify(pins),
      JSON.stringify(normalizeOverworldParams(region.params)),
      region.notes.slice(0, 4_000),
      JSON.stringify(normalizePaths(region.paths, size.width, size.height)),
      JSON.stringify(normalizeOverworldLabels(region.labels, size.width, size.height)),
      backdrop,
      now,
      now,
    );
  return true;
}

// ---- the shared workshop a chapter was written against ----

const SHARED_TABLES = {
  npcs: "npcs",
  locations: "locations",
  maps: "prepared_maps",
  encounters: "encounter_templates",
} as const;

export type SharedKind = keyof typeof SHARED_TABLES;

// Every row of one kind in a workshop, by its portable key.
export function refIndex(workshopId: string, kind: SharedKind): Map<string, string> {
  const rows = getDatabase()
    .prepare(`SELECT id FROM ${SHARED_TABLES[kind]} WHERE campaign_id = ?`)
    .all(workshopId) as Array<{ id: string }>;
  return new Map(rows.map((row) => [refFor(workshopId, kind as OriginKind, row.id), row.id]));
}

// The bundle's shared rows, by kind, as the refs the importer has to find.
function sharedRefs(bundle: WorkshopBundle): Record<SharedKind, string[]> {
  const refs = (rows: Array<{ ref: string; shared: boolean }>) =>
    rows.filter((row) => row.shared && row.ref).map((row) => row.ref);
  return {
    npcs: refs(bundle.npcs),
    locations: refs(bundle.locations),
    maps: refs(bundle.maps),
    encounters: refs(bundle.encounters),
  };
}

export type SharedHome = { id: string; title: string; found: number; total: number };

// The importer's workshops that hold the chapter's shared rows, best first,
// for the preview's "link to your workshop" choice. A workshop that draws on
// another itself cannot be a shared workshop, so it is not offered.
export function sharedHomesFor(userId: string, bundle: WorkshopBundle): SharedHome[] {
  if (!bundle.dependsOn) {
    return [];
  }
  const wanted = sharedRefs(bundle);
  const total = Object.values(wanted).reduce((sum, refs) => sum + refs.length, 0);
  if (!total) {
    return [];
  }
  const homes: SharedHome[] = [];
  for (const workshop of listWorkshopsForUser(userId)) {
    const full = getWorkshopForUser(workshop.id, userId);
    if (!full || getCommonWorkshop(full)) {
      continue;
    }
    let found = 0;
    for (const kind of Object.keys(wanted) as SharedKind[]) {
      const index = refIndex(workshop.id, kind);
      found += wanted[kind].filter((ref) => index.has(ref)).length;
    }
    if (found) {
      homes.push({ id: workshop.id, title: workshop.title, found, total });
    }
  }
  return homes.sort((a, b) => b.found - a.found);
}

// What lands outside the bundle's transaction: the importer's own shelves
// (hand-built monsters, homebrew) and the new workshop's plugin draft and
// pregens, each through the module that owns its rules. Returns how many
// arrived.
export function writeBundleShelf(userId: string, workshopId: string, bundle: WorkshopBundle): number {
  let copied = 0;
  // Hand-built monsters are USER-scoped, not campaign-scoped, so they are
  // written outside the bundle's transaction through the module that owns their
  // uniqueness rule rather than by raw insert. A name already in the
  // importer's bestiary is skipped: their own monster wins, because it is
  // the one their existing prepared encounters resolve by name.
  const existing = new Set(
    listHomebrewMonsters(userId).map((entry) => entry.draft.name.toLowerCase()),
  );
  for (const monster of bundle.monsters) {
    if (existing.has(monster.name.toLowerCase())) {
      continue;
    }
    const draft = draftFromData(monster.name, {
      desc: monster.desc,
      stats: monster.stats,
      extraDamagePerRound: monster.extraDamagePerRound,
    });
    createHomebrewMonster(userId, draft, monster.desc);
    existing.add(monster.name.toLowerCase());
    copied += 1;
  }

  // Items, spells and options, by the same rule: the importer's own entry
  // of that kind and name wins, and each arrival is normalized by the
  // module that decides what a legal entry is, so a bundle cannot smuggle a
  // weapon the dice engine would throw on.
  const owned = new Set(
    listHomebrew(userId).map((entry) => `${entry.kind}:${entry.name.toLowerCase()}`),
  );
  for (const entry of bundle.homebrew) {
    const key = `${entry.kind}:${entry.name.toLowerCase()}`;
    if (owned.has(key)) {
      continue;
    }
    const normalized = normalizeHomebrewData(entry.kind, entry.data, entry.name);
    if ("error" in normalized) {
      continue;
    }
    createHomebrew(userId, { kind: entry.kind, name: entry.name, data: normalized.data });
    owned.add(key);
    copied += 1;
  }

  if (bundle.plugin) {
    savePackDraft(workshopId, bundle.plugin);
    copied += 1;
  }

  // Pregens land in the importer's library, filed under the new workshop,
  // through the module that populates a sheet's features on creation.
  for (const pregen of bundle.pregens) {
    createCharacter(
      userId,
      pregen.level,
      { ...pregen.sheet, name: pregen.name },
      pregen.role,
      workshopId,
    );
    copied += 1;
  }
  return copied;
}
