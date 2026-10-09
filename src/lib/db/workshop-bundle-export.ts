import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getDatabase, parseJson } from "@/lib/db/core";
import { getCampaignById } from "@/lib/db/campaigns";
import { getHouseRulesText } from "@/lib/db/rules";
import { listHomebrew } from "@/lib/db/homebrew";
import { getPackDraft, hasPackDraft } from "@/lib/db/world-pack-drafts";
import { bundleRefOf, type OriginKind } from "@/lib/db/content-origins";
import { getCommonWorkshop } from "@/lib/db/workshop-common";
import { worldForBundle } from "@/lib/db/world-forge-bundle";
import { normalizeStock } from "@/lib/db/shops";
import { clampMarkup } from "@/lib/dm/shop-logic";
import { storedSheetSchema } from "@/lib/schemas/sheet";
import { storedGender } from "@/lib/gender";
import { isUploadedImagePath } from "@/lib/uploads";
import { normalizeMapSkin } from "@/lib/battlemap/skins";
import { normalizeRoutes } from "@/lib/workshop/board";
import {
  bundleManifestSchema,
  encodeBundleImage,
  MAX_BUNDLE_BYTES,
  WORKSHOP_BUNDLE_KIND,
  WORKSHOP_BUNDLE_VERSION,
  type BundleManifest,
  type WorkshopBundle,
} from "@/lib/workshop/bundle";
import { isWorkshop, normalizeTargetParty } from "@/lib/workshop/kind";
import { portableSheet, portableStatBlock, shelfForBundle, type ShelfReport } from "@/lib/db/workshop-bundle-shelf";

// Reading a workshop out to a bundle. Split from src/lib/db/workshop-bundle.ts
// (the import half, which re-exports this) to keep both under the project's
// 500-line cap.
//
// Raw SQL rather than the per-kind modules, because a bundle needs EVERY
// column a row has rather than the subset each module's public input
// exposes. Every reference between rows becomes an index into the bundle's
// own arrays (src/lib/workshop/bundle.ts): what a card picked (#155), the
// map a fight or a place is drawn on, the places the region map anchors.

type Row = Record<string, unknown>;

function allRows(sql: string, ...args: unknown[]): Row[] {
  return getDatabase().prepare(sql).all(...args) as Row[];
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

// Images share the bundle's byte budget with everything else; the reserve
// keeps a fully-illustrated workshop from squeezing its own prose out.
const IMAGE_BUDGET_CHARS = MAX_BUNDLE_BYTES - 8 * 1024 * 1024;

type ImageBudget = { remaining: number; skipped: number };

// A stored path becomes a data URL, or "" plus a skip when it cannot travel:
// path not one of ours, file gone, single image over cap, or bundle budget
// spent. The export never fails over art; it just says what stayed behind.
function loadImage(relPath: unknown, budget: ImageBudget): string {
  if (!isUploadedImagePath(relPath)) {
    return "";
  }
  let encoded = "";
  try {
    encoded = encodeBundleImage(relPath, readFileSync(path.join(process.cwd(), "public", relPath)));
  } catch {
    // Dangling path; fall through to the skip below.
  }
  if (!encoded || encoded.length > budget.remaining) {
    budget.skipped += 1;
    return "";
  }
  budget.remaining -= encoded.length;
  return encoded;
}

// A row's portable key: the key it arrived under, if it came out of a
// bundle, so an export of an import keeps the author's keys; otherwise a
// hash of its id, stable across exports and saying nothing about the id.
export function refFor(campaignId: string, kind: OriginKind, rowId: string): string {
  return (
    bundleRefOf(campaignId, kind, rowId) ??
    `r-${createHash("sha256").update(rowId).digest("hex").slice(0, 24)}`
  );
}

// The rows of one linkable kind: this workshop's, then the ones its cards
// pick from the shared workshop (#159), each with the workshop it lives in.
function linkable(sql: string, own: string, sharedIds: string[], common: string | null): Array<Row & { home: string }> {
  const rows = allRows(sql.replace("{where}", "campaign_id = ?"), own).map((row) => ({ ...row, home: own }));
  if (!common || !sharedIds.length) {
    return rows;
  }
  const wanted = new Set(sharedIds);
  return [
    ...rows,
    ...allRows(sql.replace("{where}", "campaign_id = ?"), common)
      .filter((row) => wanted.has(str(row.id)))
      .map((row) => ({ ...row, home: common })),
  ];
}

// Every column of the tables a bundle draws from, and why each one that does
// not travel stays behind. scripts/test-workshop-dependencies.mjs fails when
// a table grows a column that is in neither list: a field used to be lost to
// a bundle simply because nobody added it to the export (#153, #155), and
// this makes somebody decide.
const IDENTITY = { id: "a fresh id on import", campaign_id: "the new workshop", created_at: "now", updated_at: "now" };
export const BUNDLE_COLUMNS: Record<string, { carried: string[]; left: Record<string, string> }> = {
  world_forge: {
    carried: ["doc_json"],
    left: { campaign_id: "the new workshop", updated_at: "now" },
  },
  prepared_maps: {
    carried: ["name", "notes", "tags_json", "width", "height", "terrain", "ambient", "theme", "lights_json", "seed", "backdrop_path", "backdrop_transform_json", "outdoors", "drawings_json", "skin_json", "labels_json", "props_json", "doors_json", "zones_json", "overlay_path", "ambience_json"],
    left: { ...IDENTITY },
  },
  encounter_templates: {
    carried: ["name", "enemies_json", "battlefield", "map_json", "notes", "extras_json"],
    left: { ...IDENTITY, created_by_user_id: "the importer", cued: "a lead's cue is the source table's play" },
  },
  locations: {
    carried: ["name", "layout_description", "connections_json", "prepared_map_id", "ambience_json"],
    left: { ...IDENTITY, visited: "play", is_current: "play", map_image_json: "a legacy column nothing reads" },
  },
  npcs: {
    carried: ["name", "attitude", "trait", "location", "role", "gender", "aliases_json", "personality_json", "goals_json", "relations_json", "portrait_url", "voice_json", "faction_id", "stat_block"],
    left: {
      ...IDENTITY,
      last_shift_turn: "the source table's clock",
      bonds_json: "keyed by characters a bundle does not carry",
      pressure_json: "the agency model's running pressure, rebuilt in play",
      arc_cast_id: "the source campaign's arc",
      archived: "archived NPCs are not exported",
    },
  },
  lore_entries: {
    carried: ["category", "title", "body", "tags_json", "pinned", "visibility", "image_path", "style"],
    left: {
      ...IDENTITY,
      embedding: "recomputed on import",
      audience_json: "names the source table's people",
      attachment_path: "an attached PDF stays behind; bundles carry pictures only",
    },
  },
  roll_tables: {
    carried: ["name", "entries_json", "no_replacement"],
    left: { ...IDENTITY, created_by_user_id: "the importer", drawn_json: "what was drawn is the source table's play" },
  },
  factions: {
    carried: ["name", "blurb", "goal", "attitude_to_party", "power", "tags_json", "portrait_path"],
    left: { ...IDENTITY },
  },
  workshop_beats: {
    carried: ["kind", "title", "body", "links_json", "edges_json", "routes_json", "x", "y"],
    left: { ...IDENTITY },
  },
  overworld_maps: {
    carried: ["seed", "width", "height", "terrain", "anchors_json", "pins_json", "params_json", "notes", "paths_json", "labels_json", "backdrop_path"],
    left: { campaign_id: "the new workshop", created_at: "now", updated_at: "now", party_xy_json: "where the party stood is play" },
  },
  shops: {
    carried: ["name", "kind", "size", "location_id", "location_name", "keeper_npc_id", "stock_json", "prepared_stock_json", "markup", "buys", "restock_days"],
    left: { ...IDENTITY, restocked_at: "the source's clock; the cycle starts on arrival", haggled_json: "who haggled is the source table's play" },
  },
};

export type ExportResult =
  | { bundle: WorkshopBundle; skippedImages: number; shelf: ShelfReport }
  | { error: string };

export function exportWorkshopBundle(
  workshopId: string,
  manifestInput: unknown,
): ExportResult {
  const campaign = getCampaignById(workshopId);
  if (!campaign) {
    return { error: "That workshop does not exist." };
  }
  // Campaigns are refused outright. A campaign holds a transcript, a party
  // and characters, and none of that is anybody else's to receive; a
  // workshop is the thing that was built to be shared.
  if (!isWorkshop(campaign)) {
    return { error: "Only a workshop can be shared. A campaign holds a table's own play." };
  }
  const parsed = bundleManifestSchema.safeParse(manifestInput);
  if (!parsed.success) {
    return { error: "Fill in a name, a one-line blurb and what this is inspired by." };
  }
  const manifest: BundleManifest = parsed.data;
  const budget: ImageBudget = { remaining: IMAGE_BUDGET_CHARS, skipped: 0 };

  // What the cards pick from the shared workshop rides along as a snapshot,
  // marked shared, so the bundle stands on its own. A shared fight brings
  // the shared map it is drawn on, and a shared place the map it stands on.
  const beats = allRows(
    `SELECT id, kind, title, body, links_json, edges_json, routes_json, x, y FROM workshop_beats WHERE campaign_id = ? ORDER BY created_at`,
    workshopId,
  );
  const common = getCommonWorkshop(campaign);
  const picked = { npcId: new Set<string>(), mapId: new Set<string>(), encounterId: new Set<string>(), locationId: new Set<string>() };
  for (const beat of beats) {
    const links = parseJson<Record<string, unknown>>(str(beat.links_json, "{}"), {});
    for (const field of Object.keys(picked) as Array<keyof typeof picked>) {
      if (typeof links[field] === "string") {
        picked[field].add(links[field] as string);
      }
    }
  }
  if (common) {
    for (const row of allRows(`SELECT id, map_json FROM encounter_templates WHERE campaign_id = ?`, common.id)) {
      const mapId = parseJson<{ mapId?: unknown }>(str(row.map_json, "{}"), {}).mapId;
      if (picked.encounterId.has(str(row.id)) && typeof mapId === "string") {
        picked.mapId.add(mapId);
      }
    }
    for (const row of allRows(`SELECT id, prepared_map_id FROM locations WHERE campaign_id = ?`, common.id)) {
      if (picked.locationId.has(str(row.id)) && typeof row.prepared_map_id === "string") {
        picked.mapId.add(row.prepared_map_id);
      }
    }
  }
  const commonId = common?.id ?? null;
  const npcRows = linkable(
    `SELECT * FROM npcs WHERE {where} AND archived = 0 ORDER BY name COLLATE NOCASE`,
    workshopId,
    [...picked.npcId],
    commonId,
  );
  const locationRows = linkable(`SELECT * FROM locations WHERE {where} ORDER BY created_at`, workshopId, [...picked.locationId], commonId);
  const mapRows = linkable(`SELECT * FROM prepared_maps WHERE {where} ORDER BY name COLLATE NOCASE`, workshopId, [...picked.mapId], commonId);
  const encounterRows = linkable(
    `SELECT * FROM encounter_templates WHERE {where} ORDER BY name COLLATE NOCASE`,
    workshopId,
    [...picked.encounterId],
    commonId,
  );
  const indexOf = (rows: Row[]) => new Map(rows.map((row, index) => [str(row.id), index]));
  const npcIndex = indexOf(npcRows);
  const locationIndex = indexOf(locationRows);
  const mapIndex = indexOf(mapRows);
  const encounterIndex = indexOf(encounterRows);
  const at = (index: Map<string, number>, id: unknown) =>
    typeof id === "string" ? index.get(id) ?? null : null;

  // The owner's library characters filed under this workshop. Each sheet is
  // checked against the builder's schema on the way OUT as well, so one old
  // sheet the schema no longer accepts drops out of the bundle rather than
  // making the whole bundle unreadable on the other side.
  const pregenRows = allRows(
    `SELECT name, level, role, sheet_json FROM library_characters
     WHERE workshop_id = ? AND user_id = ? ORDER BY name COLLATE NOCASE`,
    workshopId,
    campaign.ownerUserId,
  ).flatMap((row) => {
    const sheet = storedSheetSchema.safeParse(parseJson<unknown>(str(row.sheet_json, "{}"), {}));
    return sheet.success
      ? [{ name: str(row.name), level: Math.min(20, Math.max(1, Number(row.level) || 1)), role: str(row.role) === "companion" ? ("companion" as const) : ("pc" as const), sheet: sheet.data }]
      : [];
  });

  const loreRows = allRows(
    `SELECT id, category, title, body, tags_json, pinned, visibility, image_path, style FROM lore_entries WHERE campaign_id = ? ORDER BY created_at, rowid`,
    workshopId,
  );
  const factionRows = allRows(
    `SELECT id, name, blurb, goal, attitude_to_party, power, tags_json, portrait_path FROM factions WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`,
    workshopId,
  );
  const ownIds = (rows: Array<Row & { home?: string }>) => rows.map((row) => (row.home === undefined || row.home === workshopId ? str(row.id) : ""));

  const shelf = shelfForBundle({
    ownerUserId: campaign.ownerUserId,
    setting: campaign.gameSettings,
    scope: manifest.shelf,
    statBlocks: npcRows.map((row) => portableStatBlock(str(row.stat_block))),
    rosters: encounterRows.map((row) => parseJson<unknown[]>(str(row.enemies_json, "[]"), [])),
    sheets: pregenRows.map((row) => row.sheet),
    texts: [
      ...beats.map((row) => `${str(row.title)}\n${str(row.body)}`),
      ...encounterRows.map((row) => `${str(row.notes)}\n${str(row.battlefield)}`),
      ...locationRows.map((row) => str(row.layout_description)),
      ...loreRows.map((row) => str(row.body)),
    ],
  });
  const shelfById = new Map(listHomebrew(campaign.ownerUserId).map((entry) => [entry.id, entry]));
  const bundle: WorkshopBundle = {
    kind: WORKSHOP_BUNDLE_KIND,
    version: WORKSHOP_BUNDLE_VERSION,
    manifest,
    genre: campaign.gameSettings.genre,
    theme: campaign.theme ?? "",
    premise: campaign.description ?? "",
    targetParty: normalizeTargetParty(campaign.gameSettings.targetParty),
    houseRulesText: getHouseRulesText(workshopId),
    variantRules: { ...campaign.gameSettings.variantRules },
    lore: loreRows.map((row) => ({
      category: str(row.category, "other"),
      title: str(row.title),
      body: str(row.body),
      tags: parseJson<string[]>(str(row.tags_json, "[]"), []),
      visibility: str(row.visibility) === "dm" ? ("dm" as const) : ("party" as const),
      pinned: Number(row.pinned) === 1,
      image: loadImage(row.image_path, budget),
      // How it is dressed (docs/vtt-parity-implementation-plan.md 5.6).
      style: (str(row.style) === "parchment" || str(row.style) === "notice" ? str(row.style) : "plain") as "plain" | "parchment" | "notice",
    })),
    locations: locationRows.map((row) => ({
      name: str(row.name),
      layoutDescription: str(row.layout_description),
      connections: parseJson<string[]>(str(row.connections_json, "[]"), []),
      map: at(mapIndex, row.prepared_map_id),
      ambience: row.ambience_json ? parseJson<Record<string, unknown> | null>(str(row.ambience_json), null) : null,
      ref: refFor(row.home, "locations", str(row.id)),
      shared: row.home !== workshopId,
    })),
    npcs: npcRows.map((row) => ({
      name: str(row.name),
      attitude: (["hostile", "indifferent", "friendly"] as const).includes(
        str(row.attitude) as "hostile",
      )
        ? (str(row.attitude) as "hostile" | "indifferent" | "friendly")
        : "indifferent",
      trait: str(row.trait),
      location: str(row.location),
      role: str(row.role),
      gender: storedGender(row.gender),
      aliases: parseJson<string[]>(str(row.aliases_json, "[]"), []),
      personality: str(row.personality_json),
      goals: str(row.goals_json),
      relations: str(row.relations_json),
      portrait: loadImage(row.portrait_url, budget),
      voice: row.voice_json ? parseJson<Record<string, unknown> | null>(str(row.voice_json), null) : null,
      statBlock: portableStatBlock(str(row.stat_block)),
      ref: refFor(row.home, "npcs", str(row.id)),
      shared: row.home !== workshopId,
    })),
    factions: factionRows.map((row) => ({
      name: str(row.name),
      blurb: str(row.blurb),
      goal: str(row.goal),
      attitude: (["hostile", "wary", "neutral", "friendly", "allied"] as const).includes(str(row.attitude_to_party) as "neutral")
        ? (str(row.attitude_to_party) as "hostile" | "wary" | "neutral" | "friendly" | "allied")
        : "neutral",
      power: Math.max(0, Math.min(5, Number(row.power) || 0)),
      tags: parseJson<string[]>(str(row.tags_json, "[]"), []),
      members: allRows(`SELECT name FROM npcs WHERE campaign_id = ? AND faction_id = ?`, workshopId, String(row.id)).map((npc) => str(npc.name)),
      portrait: loadImage(row.portrait_path, budget),
    })),
    encounters: encounterRows.map((row) => {
      const map = parseJson<Record<string, unknown>>(str(row.map_json, "{}"), {});
      const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null);
      return {
        name: str(row.name),
        enemies: parseJson<unknown[]>(str(row.enemies_json, "[]"), []),
        battlefield: str(row.battlefield),
        notes: str(row.notes),
        map: {
          map: at(mapIndex, map.mapId),
          seed: number(map.seed),
          theme: typeof map.theme === "string" ? map.theme : null,
          ambient: typeof map.ambient === "string" ? map.ambient : null,
          width: number(map.width),
          height: number(map.height),
        },
        extras: parseJson<Record<string, unknown>>(str(row.extras_json, "{}"), {}),
        ref: refFor(row.home, "encounters", str(row.id)),
        shared: row.home !== workshopId,
      };
    }),
    tables: allRows(
      `SELECT name, entries_json, no_replacement FROM roll_tables WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`,
      workshopId,
    ).map((row) => ({
      name: str(row.name),
      entries: parseJson<unknown[]>(str(row.entries_json, "[]"), []),
      noReplacement: Number(row.no_replacement) === 1,
    })),
    maps: mapRows.map((row) => {
      const backdrop = loadImage(row.backdrop_path, budget);
      return {
        name: str(row.name),
        notes: str(row.notes),
        tags: parseJson<string[]>(str(row.tags_json, "[]"), []),
        width: Number(row.width) || 1,
        height: Number(row.height) || 1,
        terrain: str(row.terrain),
        ambient: str(row.ambient, "day"),
        theme: str(row.theme, "field"),
        lights: parseJson<unknown[]>(str(row.lights_json, "[]"), []),
        seed: Number(row.seed) || 0,
        backdrop,
        // The transform is meaningless without its art, so it only travels
        // alongside it.
        backdropTransform: backdrop
          ? parseJson<Record<string, unknown>>(str(row.backdrop_transform_json, "{}"), {})
          : {},
        skin: { ...normalizeMapSkin(parseJson<unknown>(str(row.skin_json, "{}"), {})) },
        outdoors: row.outdoors === null || row.outdoors === undefined ? null : Number(row.outdoors) === 1,
        labels: parseJson<unknown[]>(str(row.labels_json, "[]"), []),
        props: parseJson<unknown[]>(str(row.props_json, "[]"), []),
        doors: parseJson<Record<string, unknown>>(str(row.doors_json, "{}"), {}),
        zones: parseJson<unknown[]>(str(row.zones_json, "[]"), []),
        drawings: parseJson<unknown[]>(str(row.drawings_json, "[]"), []),
        ambience: parseJson<Record<string, unknown>>(str(row.ambience_json, "{}"), {}),
        overlay: loadImage(row.overlay_path, budget),
        ref: refFor(row.home, "maps", str(row.id)),
        shared: row.home !== workshopId,
      };
    }),
    storyboard: [],
    // The shelf: hand-built monsters, and items, spells and options, so a
    // prepared encounter or a pregen that names one finds it on the other
    // side; the whole shelf, or only what this workshop uses
    // (workshop-bundle-shelf.ts).
    monsters: shelf.monsters.map((entry) => ({
      name: entry.draft.name,
      desc: entry.desc,
      stats: entry.draft.stats,
      extraDamagePerRound: entry.draft.extraDamagePerRound,
    })),
    homebrew: shelf.homebrew.map((entry) => ({
      kind: entry.kind as Exclude<typeof entry.kind, "monster">,
      name: entry.name,
      data: entry.data,
    })),
    // The owner's library characters filed under this workshop, their
    // homebrew written by kind and name rather than by this server's ids.
    pregens: pregenRows.map((row) => ({ ...row, sheet: portableSheet(row.sheet, shelfById) })),
    // The world pack draft travels whole, art and all; it is the one thing
    // in a workshop that was built to be handed on.
    // The Market (#171), the place and keeper as indexes like a card's picks.
    shops: allRows(`SELECT * FROM shops WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`, workshopId).map((row) => {
      const prepared = str(row.prepared_stock_json);
      return {
        name: str(row.name),
        kind: str(row.kind, "general"),
        size: str(row.size, "village"),
        location: at(locationIndex, row.location_id),
        locationName: str(row.location_name),
        keeper: at(npcIndex, row.keeper_npc_id),
        stock: normalizeStock(parseJson<unknown>(str(row.stock_json, "[]"), [])),
        preparedStock: prepared ? normalizeStock(parseJson<unknown>(prepared, [])) : null,
        markup: clampMarkup(Number(row.markup) || 1),
        buys: Number(row.buys) === 1,
        restockDays: Math.max(0, Math.min(365, Math.round(Number(row.restock_days) || 0))),
      };
    }),
    plugin: hasPackDraft(workshopId) ? getPackDraft(workshopId).draft : null,
    world: worldForBundle(
      workshopId,
      { npc: ownIds(npcRows), location: ownIds(locationRows), faction: ownIds(factionRows), lore: ownIds(loreRows) },
      (image) => loadImage(image, budget),
    ),
    overworld: null,
    dependsOn: common ? { name: common.title.slice(0, 80) } : null,
  };

  // The region map, with its anchors as indexes into the places.
  const [region] = allRows(`SELECT * FROM overworld_maps WHERE campaign_id = ?`, workshopId);
  if (region) {
    bundle.overworld = {
      seed: Number(region.seed) || 0,
      width: Number(region.width) || 1,
      height: Number(region.height) || 1,
      terrain: str(region.terrain),
      params: parseJson<Record<string, unknown>>(str(region.params_json, "{}"), {}),
      notes: str(region.notes),
      pins: parseJson<unknown[]>(str(region.pins_json, "[]"), []),
      paths: parseJson<unknown[]>(str(region.paths_json, "[]"), []),
      labels: parseJson<unknown[]>(str(region.labels_json, "[]"), []),
      anchors: Object.entries(parseJson<Record<string, { x?: unknown; y?: unknown }>>(str(region.anchors_json, "{}"), {}))
        .map(([locationId, xy]) => ({
          location: locationIndex.get(locationId) ?? -1,
          x: Math.round(Number(xy?.x) || 0),
          y: Math.round(Number(xy?.y) || 0),
        }))
        .filter((anchor) => anchor.location >= 0),
      backdrop: loadImage(region.backdrop_path, budget),
    };
  }

  // The board last, because its arrows have to become indexes into the
  // array that is being built, and that array has to exist first.
  const indexById = new Map(beats.map((row, index) => [str(row.id), index]));
  bundle.storyboard = beats.map((row) => {
    const edges = parseJson<string[]>(str(row.edges_json, "[]"), []);
    const links = parseJson<Record<string, unknown>>(str(row.links_json, "{}"), {});
    const routes = normalizeRoutes(parseJson<unknown>(str(row.routes_json, "{}"), {}), edges);
    const link = (index: number | null) => (index === null ? {} : index);
    const picks = {
      npc: link(at(npcIndex, links.npcId)),
      map: link(at(mapIndex, links.mapId)),
      encounter: link(at(encounterIndex, links.encounterId)),
      location: link(at(locationIndex, links.locationId)),
    };
    return {
      kind: str(row.kind, "event") as WorkshopBundle["storyboard"][number]["kind"],
      title: str(row.title),
      body: str(row.body),
      edges: edges
        .map((edge) => indexById.get(edge))
        .filter((index): index is number => index !== undefined),
      routes: Object.entries(routes)
        .map(([to, route]) => ({ to: indexById.get(to) ?? -1, kind: route.kind, label: route.label }))
        .filter((route) => route.to >= 0),
      links: Object.fromEntries(
        Object.entries(picks).filter(([, index]) => typeof index === "number"),
      ) as WorkshopBundle["storyboard"][number]["links"],
      x: Number(row.x) || 0,
      y: Number(row.y) || 0,
    };
  });

  return { bundle, skippedImages: budget.skipped, shelf: shelf.report };
}
