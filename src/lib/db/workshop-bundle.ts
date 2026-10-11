import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDatabase, nowIso } from "@/lib/db/core";
import { createCampaign } from "@/lib/db/campaigns";
import { WORKSHOP_GAME_SETTINGS, getWorkshopForUser } from "@/lib/db/workshops";
import { setHouseRules } from "@/lib/db/rules";
import { BUNDLE_ORIGIN, recordOrigin, type OriginKind } from "@/lib/db/content-origins";
import { setCommonWorkshop } from "@/lib/db/workshop-common";
import {
  insertBundleMap,
  insertBundleOverworld,
  insertBundleShop,
  refIndex,
  writeBundleShelf,
  type SharedKind,
} from "@/lib/db/workshop-bundle-parts";
import { normalizeAmbience } from "@/lib/battlemap/scene";
import { MAP_THEMES } from "@/lib/battlemap/generate";
import { normalizeNpcVoice } from "@/lib/npcs/forge";
import {
  EXTRAS_LIMITS,
  normalizeTemplateExtras,
  normalizeTemplateMap,
} from "@/lib/dm/encounter-template-logic";
import {
  decodeBundleImage,
  type BundleImage,
  resolveEdges,
  type WorkshopBundle,
} from "@/lib/workshop/bundle";
import { removeUnreferencedFiles } from "@/lib/image-files";
import { worldFromBundle } from "@/lib/db/world-forge-bundle";
import { admitUpload, type UploadRefusal } from "@/lib/upload-budget";

export { exportWorkshopBundle, type ExportResult } from "@/lib/db/workshop-bundle-export";

// Writing a stranger's bundle back in as a new workshop. The export half is
// src/lib/db/workshop-bundle-export.ts, re-exported from here.
//
// The shape of this file follows src/lib/db/content-import.ts: raw SQL
// rather than the per-kind modules, because a bundle needs EVERY column a
// row has rather than the subset each module's public input exposes, and
// because the write has to happen in one transaction so a bundle that fails
// halfway leaves no half-workshop behind.
//
// Import always CREATES. It never merges into an existing workshop, which
// removes the entire collision-naming problem the campaign import had to
// solve: a fresh workshop has nothing to collide with. A DM who wants a
// stranger's places in their own workshop gets there in two steps, and both
// of them are steps they can see.
//
// Every relationship arrives as an index into the bundle's own arrays and
// becomes the id of the row that index wrote (src/lib/workshop/bundle.ts):
// a card's picks, a fight's map, a place's map, the region map's anchors. An
// index that lands nowhere is dropped. A chapter's shared rows either link
// to a workshop of the importer's that holds the same refs (#159), or land
// as the chapter's own.

// ---- import ----

export type BundleImportResult =
  // `shelf`: arrivals that were the importer's own entry already, and those
  // kept beside it under the bundle's name (workshop-bundle-shelf.ts).
  | { workshopId: string; copied: number; linkedShared: number; droppedLinks: number; shelf: { reused: string[]; renamed: string[] } }
  | { error: string; refusal?: UploadRefusal };

// Writes a decoded image to /uploads under a fresh uuid name, exactly the
// shape /api/upload produces, so isUploadedImagePath accepts it everywhere
// else, and notes the path in `written`. Returns "" when there was no image
// or it did not survive decoding.
function saveBundleImage(image: BundleImage | null, uploadDir: string, written: string[]): string {
  if (!image) {
    return "";
  }
  const filename = `${crypto.randomUUID()}.${image.ext}`;
  writeFileSync(path.join(/*turbopackIgnore: true*/ uploadDir, filename), image.bytes);
  const url = `/uploads/${filename}`;
  written.push(url);
  return url;
}

type BundleArtPaths = {
  npcPortraits: string[];
  mapBackdrops: string[];
  mapOverlays: string[];
  loreImages: string[];
  factionPortraits: string[];
  regionBackdrop: string;
};

export type BundleImportOptions = {
  // Lifts the importer's upload budget (src/lib/upload-budget.ts): the
  // registry install is an admin's, and the workshop route passes the
  // signed-in user's flag.
  isAdmin?: boolean;
  // A workshop of the importer's that holds the chapter's shared rows: they
  // link to it, and the new workshop draws on it (#159). Without it the
  // shared rows land as the chapter's own.
  sharedWorkshopId?: string;
};

export function importWorkshopBundle(
  userId: string,
  bundle: WorkshopBundle,
  options: BundleImportOptions = {},
): BundleImportResult {
  // Every picture is decoded first and the lot weighed against the
  // importer's upload budget (src/lib/upload-budget.ts), so an import that
  // is refused writes nothing.
  const art = {
    npcs: bundle.npcs.map((npc) => decodeBundleImage(npc.portrait)),
    maps: bundle.maps.map((map) => decodeBundleImage(map.backdrop)),
    overlays: bundle.maps.map((map) => decodeBundleImage(map.overlay)),
    lore: bundle.lore.map((entry) => decodeBundleImage(entry.image)),
    factions: bundle.factions.map((faction) => decodeBundleImage(faction.portrait)),
    region: [bundle.overworld ? decodeBundleImage(bundle.overworld.backdrop) : null],
    world: Object.values(bundle.world?.images ?? {}).map((image) => decodeBundleImage(image)),
  };
  const images = Object.values(art)
    .flat()
    .filter((image): image is BundleImage => image !== null);
  const refusal = admitUpload(
    { id: userId, isAdmin: options.isAdmin },
    images.reduce((sum, image) => sum + image.bytes.length, 0),
    images.length,
  );
  if (refusal) {
    return { error: refusal.error, refusal };
  }

  // Art lands on disk before the transaction opens, because the reverse
  // order would commit rows pointing at images that were never written. If
  // the rows then fail, the files none of them ended up naming are removed
  // again rather than left in public/uploads for good.
  const uploadDir = path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "uploads");
  mkdirSync(uploadDir, { recursive: true });
  const written: string[] = [];
  try {
    const paths: BundleArtPaths = {
      npcPortraits: art.npcs.map((image) => saveBundleImage(image, uploadDir, written)),
      mapBackdrops: art.maps.map((image) => saveBundleImage(image, uploadDir, written)),
      mapOverlays: art.overlays.map((image) => saveBundleImage(image, uploadDir, written)),
      loreImages: art.lore.map((image) => saveBundleImage(image, uploadDir, written)),
      factionPortraits: art.factions.map((image) => saveBundleImage(image, uploadDir, written)),
      regionBackdrop: saveBundleImage(art.region[0], uploadDir, written),
    };
    return writeBundleRows(userId, bundle, paths, options.sharedWorkshopId ?? "");
  } catch (error) {
    removeUnreferencedFiles(written);
    throw error;
  }
}

const AMBIENTS = ["bright", "dim", "dark"];

function writeBundleRows(
  userId: string,
  bundle: WorkshopBundle,
  { npcPortraits, mapBackdrops, mapOverlays, loreImages, factionPortraits, regionBackdrop }: BundleArtPaths,
  sharedWorkshopId: string,
): BundleImportResult {
  const workshop = createCampaign(userId, {
    title: bundle.manifest.name,
    description: bundle.premise || bundle.manifest.blurb,
    theme: bundle.theme,
    maxPlayers: 6,
    startingLevel: bundle.targetParty.level,
    difficulty: "normal",
    kind: "workshop",
    gameSettings: {
      // The same seat and silence a workshop made by the button gets: the
      // importer is its DM, and nothing in it narrates on a cadence. Left
      // out, the row defaulted to an AI narrator with no human seat, so the
      // owner had no DM caps and the DM-only panels came up blank (#121).
      ...WORKSHOP_GAME_SETTINGS,
      genre: bundle.genre,
      targetParty: bundle.targetParty,
      // The engine's own normalizer runs inside createCampaign, so a flag
      // this build does not have is dropped rather than stored.
      variantRules: bundle.variantRules as never,
    },
  });

  const db = getDatabase();
  const now = nowIso();
  let copied = 0;
  let droppedLinks = 0;
  let linkedShared = 0;

  // The workshop of the importer's that a chapter's shared rows link to,
  // when they chose one and it is theirs. A shared row whose ref that
  // workshop does not hold lands as the chapter's own, so nothing a card
  // picked is lost to a partial match.
  const sharedHome = sharedWorkshopId && bundle.dependsOn ? getWorkshopForUser(sharedWorkshopId, userId) : null;
  const sharedIndex = new Map<SharedKind, Map<string, string>>();
  const sharedRow = (kind: SharedKind, row: { ref: string; shared: boolean }): string | null => {
    if (!sharedHome || !row.shared || !row.ref) {
      return null;
    }
    let index = sharedIndex.get(kind);
    if (!index) {
      index = refIndex(sharedHome.id, kind);
      sharedIndex.set(kind, index);
    }
    return index.get(row.ref) ?? null;
  };
  // Records the key a linkable row arrived under, so this workshop's next
  // export keeps the author's keys and a later chapter can find it.
  const keyed = (kind: OriginKind, id: string, ref: string) => {
    if (ref) {
      recordOrigin(workshop.id, kind, id, BUNDLE_ORIGIN, ref);
    }
  };
  // Index -> the id that index became, per kind.
  const ids = { maps: [] as string[], locations: [] as string[], npcs: [] as string[], encounters: [] as string[], lore: [] as string[], factions: [] as string[] };
  const idAt = (list: string[], index: number | null | undefined): string | null => {
    if (index === null || index === undefined) {
      return null;
    }
    const id = list[index];
    if (!id) {
      droppedLinks += 1;
    }
    return id ?? null;
  };

  db.transaction(() => {
    bundle.lore.forEach((entry, index) => {
      ids.lore.push(crypto.randomUUID());
      db.prepare(
        `INSERT INTO lore_entries (id, campaign_id, category, title, body, tags_json, pinned, visibility, image_path, style, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        ids.lore[index],
        workshop.id,
        entry.category,
        entry.title,
        entry.body,
        JSON.stringify(entry.tags),
        entry.pinned ? 1 : 0,
        entry.visibility,
        loreImages[index],
        entry.style ?? "plain",
        now,
        now,
      );
      copied += 1;
    });

    // Maps first: places and fights are bound to them by index. Map names
    // are UNIQUE per workshop, and a chapter's shared maps can share a name
    // with its own, so a repeat is numbered as places and NPCs are below.
    const usedMapNames = new Set<string>();
    for (const [index, map] of bundle.maps.entries()) {
      const linked = sharedRow("maps", map);
      if (linked) {
        ids.maps.push(linked);
        linkedShared += 1;
        continue;
      }
      let name = map.name;
      for (let suffix = 2; usedMapNames.has(name.toLowerCase()); suffix += 1) {
        name = `${map.name} (${suffix})`;
      }
      usedMapNames.add(name.toLowerCase());
      const id = crypto.randomUUID();
      insertBundleMap(id, workshop.id, { ...map, name }, { backdrop: mapBackdrops[index], overlay: mapOverlays[index] }, now);
      keyed("maps", id, map.ref);
      ids.maps.push(id);
      copied += 1;
    }

    // Locations carry a UNIQUE (campaign_id, name COLLATE NOCASE), and a
    // bundle written by hand can hold two rows with the same name. A fresh
    // workshop cannot collide with anything already there, but it can still
    // collide with ITSELF, so duplicates inside one bundle are numbered.
    const usedLocationNames = new Set<string>();
    for (const location of bundle.locations) {
      const linked = sharedRow("locations", location);
      if (linked) {
        ids.locations.push(linked);
        linkedShared += 1;
        continue;
      }
      let name = location.name;
      for (let suffix = 2; usedLocationNames.has(name.toLowerCase()); suffix += 1) {
        name = `${location.name} (${suffix})`;
      }
      usedLocationNames.add(name.toLowerCase());
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO locations
           (id, campaign_id, name, layout_description, connections_json, visited, is_current,
            prepared_map_id, ambience_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
      ).run(
        id,
        workshop.id,
        name,
        location.layoutDescription,
        JSON.stringify(location.connections),
        idAt(ids.maps, location.map),
        location.ambience ? JSON.stringify(normalizeAmbience(location.ambience)) : null,
        now,
        now,
      );
      keyed("locations", id, location.ref);
      ids.locations.push(id);
      copied += 1;
    }

    const usedNpcNames = new Set<string>();
    for (const [index, npc] of bundle.npcs.entries()) {
      const linked = sharedRow("npcs", npc);
      if (linked) {
        ids.npcs.push(linked);
        linkedShared += 1;
        continue;
      }
      // npcs carries UNIQUE (campaign_id, name): a shared NPC landing as the
      // chapter's own can share a name with one of the chapter's.
      let name = npc.name;
      for (let suffix = 2; usedNpcNames.has(name.toLowerCase()); suffix += 1) {
        name = `${npc.name} (${suffix})`;
      }
      usedNpcNames.add(name.toLowerCase());
      const id = crypto.randomUUID();
      const voice = npc.voice ? normalizeNpcVoice(npc.voice) : null;
      db.prepare(
        `INSERT INTO npcs
           (id, campaign_id, name, attitude, trait, location, role, last_shift_turn,
            aliases_json, personality_json, goals_json, relations_json, bonds_json,
            pressure_json, arc_cast_id, portrait_url, voice_json, stat_block, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, '[]', '', '', ?, ?, ?, 0, ?, ?)`,
      ).run(
        id,
        workshop.id,
        name,
        npc.attitude,
        npc.trait,
        npc.location,
        npc.role,
        JSON.stringify(npc.aliases),
        npc.personality,
        npc.goals,
        // Relations survive because they are keyed by name. Bonds do not,
        // because they are keyed by character id and a bundle has no
        // characters: an imported bond would point at somebody who has never
        // existed on this machine.
        npc.relations || "[]",
        npcPortraits[index],
        voice ? JSON.stringify(voice) : null,
        npc.statBlock ?? "",
        now,
        now,
      );
      keyed("npcs", id, npc.ref);
      ids.npcs.push(id);
      copied += 1;
    }

    // Factions land after the cast so members can be matched by name.
    for (const [index, faction] of bundle.factions.entries()) {
      const factionId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO factions (id, campaign_id, name, blurb, goal, attitude_to_party, power, tags_json, portrait_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(factionId, workshop.id, faction.name, faction.blurb, faction.goal, faction.attitude, faction.power, JSON.stringify(faction.tags), factionPortraits[index], now, now);
      ids.factions.push(factionId);
      for (const member of faction.members) {
        db.prepare(`UPDATE npcs SET faction_id = ? WHERE campaign_id = ? AND name = ? COLLATE NOCASE`).run(factionId, workshop.id, member);
      }
      copied += 1;
    }

    // The Market after the places and the cast it stands at and is kept by.
    for (const shop of bundle.shops) {
      droppedLinks += insertBundleShop(workshop.id, shop, ids.locations, ids.npcs);
      copied += 1;
    }

    for (const encounter of bundle.encounters) {
      const linked = sharedRow("encounters", encounter);
      if (linked) {
        ids.encounters.push(linked);
        linkedShared += 1;
        continue;
      }
      // The map settings and the rest of the plan, each through the
      // normaliser the encounter routes use, the extras against the roster
      // they belong to.
      const map = normalizeTemplateMap(
        { ...encounter.map, mapId: idAt(ids.maps, encounter.map.map) },
        { themes: MAP_THEMES, ambients: AMBIENTS },
      );
      const slots = (encounter.enemies as Array<{ monster?: unknown; count?: unknown }>)
        .filter((row) => typeof row?.monster === "string" && row.monster)
        .reduce((sum, row) => sum + Math.min(99, Math.max(1, Math.round(Number(row.count) || 1))), 0);
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO encounter_templates
           (id, campaign_id, name, enemies_json, battlefield, map_json, notes, extras_json,
            created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        workshop.id,
        encounter.name,
        JSON.stringify(encounter.enemies),
        encounter.battlefield,
        JSON.stringify(map),
        encounter.notes,
        JSON.stringify(normalizeTemplateExtras(encounter.extras, Math.min(slots, EXTRAS_LIMITS.slots))),
        userId,
        now,
        now,
      );
      keyed("encounters", id, encounter.ref);
      ids.encounters.push(id);
      copied += 1;
    }

    for (const table of bundle.tables) {
      db.prepare(
        `INSERT INTO roll_tables (id, campaign_id, name, entries_json, no_replacement, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        workshop.id,
        table.name,
        JSON.stringify(table.entries),
        table.noReplacement ? 1 : 0,
        userId,
        now,
        now,
      );
      copied += 1;
    }

    // The board in two passes: every card first, so an arrow drawn from the
    // first card to the last has something to point at. What each card
    // picked lands on the row its index became (#155).
    const beatIds = bundle.storyboard.map(() => crypto.randomUUID());
    for (const [index, beat] of bundle.storyboard.entries()) {
      const links = Object.fromEntries(
        (
          [
            ["npcId", idAt(ids.npcs, beat.links.npc)],
            ["mapId", idAt(ids.maps, beat.links.map)],
            ["encounterId", idAt(ids.encounters, beat.links.encounter)],
            ["locationId", idAt(ids.locations, beat.links.location)],
          ] as const
        ).filter(([, id]) => id),
      );
      db.prepare(
        `INSERT INTO workshop_beats
           (id, campaign_id, kind, title, body, links_json, edges_json, x, y, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
      ).run(beatIds[index], workshop.id, beat.kind, beat.title, beat.body, JSON.stringify(links), beat.x, beat.y, now, now);
      copied += 1;
    }
    for (const [index, beat] of bundle.storyboard.entries()) {
      const edges = resolveEdges(beat.edges, beatIds.length).filter((edge) => edge !== index);
      if (edges.length) {
        const routes = Object.fromEntries(
          beat.routes
            .filter((route) => edges.includes(route.to))
            .map((route) => [beatIds[route.to], { kind: route.kind, label: route.label }]),
        );
        db.prepare(`UPDATE workshop_beats SET edges_json = ?, routes_json = ? WHERE id = ?`).run(
          JSON.stringify(edges.map((edge) => beatIds[edge])),
          JSON.stringify(routes),
          beatIds[index],
        );
      }
    }

    if (bundle.overworld && insertBundleOverworld(workshop.id, bundle.overworld, ids.locations, regionBackdrop, now)) {
      copied += 1;
    }
  })();

  // A chapter whose shared rows found their workshop draws on it from now
  // on, so its pickers list that workshop's cast beside its own.
  if (sharedHome && linkedShared) {
    setCommonWorkshop(workshop, sharedHome.id);
  }

  // House rules land outside the transaction because setHouseRules chunks the
  // prose and queues an embedding, which is the same reason runContentImport
  // writes them after its own transaction closes.
  if (bundle.houseRulesText.trim()) {
    setHouseRules(workshop.id, bundle.houseRulesText);
    copied += 1;
  }

  const shelf = writeBundleShelf(userId, workshop.id, bundle);
  copied += shelf.copied;
  if (bundle.world) {
    copied += worldFromBundle(workshop.id, bundle.world, { npc: ids.npcs, location: ids.locations, faction: ids.factions, lore: ids.lore });
  }

  return { workshopId: workshop.id, copied, linkedShared, droppedLinks, shelf: { reused: shelf.reused, renamed: shelf.renamed } };
}
