import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { createCampaign, getCampaignById } from "@/lib/db/campaigns";
import { getHouseRulesText, setHouseRules } from "@/lib/db/rules";
import { createHomebrewMonster, listHomebrewMonsters } from "@/lib/bestiary/homebrew-monsters";
import { draftFromData } from "@/lib/bestiary/monster-draft";
import { isUploadedImagePath } from "@/lib/uploads";
import {
  bundleManifestSchema,
  decodeBundleImage,
  encodeBundleImage,
  MAX_BUNDLE_BYTES,
  resolveEdges,
  WORKSHOP_BUNDLE_KIND,
  WORKSHOP_BUNDLE_VERSION,
  type BundleManifest,
  type WorkshopBundle,
} from "@/lib/workshop/bundle";
import { isWorkshop, normalizeTargetParty } from "@/lib/workshop/kind";

// Reading a workshop out to a bundle, and writing a stranger's bundle back
// in as a new workshop.
//
// The shape of this file follows src/lib/db/content-import.ts: raw SQL in
// both directions rather than the per-kind modules, because a bundle needs
// EVERY column a row has rather than the subset each module's public input
// exposes, and because the write has to happen in one transaction so a
// bundle that fails halfway leaves no half-workshop behind.
//
// Import always CREATES. It never merges into an existing workshop, which
// removes the entire collision-naming problem the campaign import had to
// solve: a fresh workshop has nothing to collide with. A DM who wants a
// stranger's places in their own workshop gets there in two steps, and both
// of them are steps they can see.

type Row = Record<string, unknown>;

function allRows(sql: string, ...args: unknown[]): Row[] {
  return getDatabase().prepare(sql).all(...args) as Row[];
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

// ---- export ----

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

export type ExportResult =
  | { bundle: WorkshopBundle; skippedImages: number }
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
    lore: allRows(
      `SELECT category, title, body, tags_json FROM lore_entries WHERE campaign_id = ? ORDER BY created_at`,
      workshopId,
    ).map((row) => ({
      category: str(row.category, "other"),
      title: str(row.title),
      body: str(row.body),
      tags: parseJson<string[]>(str(row.tags_json, "[]"), []),
    })),
    locations: allRows(
      `SELECT name, layout_description, connections_json FROM locations WHERE campaign_id = ? ORDER BY created_at`,
      workshopId,
    ).map((row) => ({
      name: str(row.name),
      layoutDescription: str(row.layout_description),
      connections: parseJson<string[]>(str(row.connections_json, "[]"), []),
    })),
    npcs: allRows(
      `SELECT name, attitude, trait, location, aliases_json, personality_json, goals_json, relations_json, portrait_url
         FROM npcs WHERE campaign_id = ? AND archived = 0 ORDER BY name COLLATE NOCASE`,
      workshopId,
    ).map((row) => ({
      name: str(row.name),
      attitude: (["hostile", "indifferent", "friendly"] as const).includes(
        str(row.attitude) as "hostile",
      )
        ? (str(row.attitude) as "hostile" | "indifferent" | "friendly")
        : "indifferent",
      trait: str(row.trait),
      location: str(row.location),
      aliases: parseJson<string[]>(str(row.aliases_json, "[]"), []),
      personality: str(row.personality_json),
      goals: str(row.goals_json),
      relations: str(row.relations_json),
      portrait: loadImage(row.portrait_url, budget),
    })),
    encounters: allRows(
      `SELECT name, enemies_json, battlefield, notes FROM encounter_templates WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`,
      workshopId,
    ).map((row) => ({
      name: str(row.name),
      enemies: parseJson<unknown[]>(str(row.enemies_json, "[]"), []),
      battlefield: str(row.battlefield),
      notes: str(row.notes),
    })),
    tables: allRows(
      `SELECT name, entries_json FROM roll_tables WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`,
      workshopId,
    ).map((row) => ({
      name: str(row.name),
      entries: parseJson<unknown[]>(str(row.entries_json, "[]"), []),
    })),
    maps: allRows(
      `SELECT name, notes, tags_json, width, height, terrain, ambient, theme, lights_json, seed,
              backdrop_path, backdrop_transform_json
         FROM prepared_maps WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`,
      workshopId,
    ).map((row) => {
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
      };
    }),
    storyboard: [],
    monsters: listHomebrewMonsters(campaign.ownerUserId).map((entry) => ({
      name: entry.draft.name,
      desc: entry.desc,
      stats: entry.draft.stats,
      extraDamagePerRound: entry.draft.extraDamagePerRound,
    })),
  };

  // The board last, because its arrows have to become indexes into the
  // array that is being built, and that array has to exist first.
  const beats = allRows(
    `SELECT id, kind, title, body, edges_json, x, y FROM workshop_beats WHERE campaign_id = ? ORDER BY created_at`,
    workshopId,
  );
  const indexById = new Map(beats.map((row, index) => [str(row.id), index]));
  bundle.storyboard = beats.map((row) => ({
    kind: str(row.kind, "event") as WorkshopBundle["storyboard"][number]["kind"],
    title: str(row.title),
    body: str(row.body),
    edges: parseJson<string[]>(str(row.edges_json, "[]"), [])
      .map((edge) => indexById.get(edge))
      .filter((index): index is number => index !== undefined),
    x: Number(row.x) || 0,
    y: Number(row.y) || 0,
  }));

  return { bundle, skippedImages: budget.skipped };
}

// ---- import ----

export type BundleImportResult =
  | { workshopId: string; copied: number }
  | { error: string };

// Writes an arriving image to /uploads under a fresh uuid name, exactly the
// shape /api/upload produces, so isUploadedImagePath accepts it everywhere
// else. Returns "" when the data URL does not survive decoding.
function saveBundleImage(dataUrl: string, uploadDir: string): string {
  if (!dataUrl) {
    return "";
  }
  const image = decodeBundleImage(dataUrl);
  if (!image) {
    return "";
  }
  const filename = `${crypto.randomUUID()}.${image.ext}`;
  writeFileSync(path.join(uploadDir, filename), image.bytes);
  return `/uploads/${filename}`;
}

export function importWorkshopBundle(
  userId: string,
  bundle: WorkshopBundle,
): BundleImportResult {
  // Art lands on disk before the transaction opens: a failed import can
  // orphan a few image files (harmless), while the reverse order would
  // commit rows pointing at images that were never written.
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  mkdirSync(uploadDir, { recursive: true });
  const npcPortraits = bundle.npcs.map((npc) => saveBundleImage(npc.portrait, uploadDir));
  const mapBackdrops = bundle.maps.map((map) => saveBundleImage(map.backdrop, uploadDir));

  const workshop = createCampaign(userId, {
    title: bundle.manifest.name,
    description: bundle.premise || bundle.manifest.blurb,
    theme: bundle.theme,
    maxPlayers: 6,
    startingLevel: bundle.targetParty.level,
    difficulty: "normal",
    kind: "workshop",
    gameSettings: {
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

  db.transaction(() => {
    for (const entry of bundle.lore) {
      db.prepare(
        `INSERT INTO lore_entries (id, campaign_id, category, title, body, tags_json, pinned, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        workshop.id,
        entry.category,
        entry.title,
        entry.body,
        JSON.stringify(entry.tags),
        now,
        now,
      );
      copied += 1;
    }

    // Locations carry a UNIQUE (campaign_id, name COLLATE NOCASE), and a
    // bundle written by hand can hold two rows with the same name. A fresh
    // workshop cannot collide with anything already there, but it can still
    // collide with ITSELF, so duplicates inside one bundle are numbered.
    const usedLocationNames = new Set<string>();
    for (const location of bundle.locations) {
      let name = location.name;
      for (let suffix = 2; usedLocationNames.has(name.toLowerCase()); suffix += 1) {
        name = `${location.name} (${suffix})`;
      }
      usedLocationNames.add(name.toLowerCase());
      db.prepare(
        `INSERT INTO locations
           (id, campaign_id, name, layout_description, connections_json, visited, is_current, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        workshop.id,
        name,
        location.layoutDescription,
        JSON.stringify(location.connections),
        now,
        now,
      );
      copied += 1;
    }

    for (const [index, npc] of bundle.npcs.entries()) {
      db.prepare(
        `INSERT INTO npcs
           (id, campaign_id, name, attitude, trait, location, last_shift_turn,
            aliases_json, personality_json, goals_json, relations_json, bonds_json,
            pressure_json, arc_cast_id, portrait_url, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, '[]', '', '', ?, 0, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        workshop.id,
        npc.name,
        npc.attitude,
        npc.trait,
        npc.location,
        JSON.stringify(npc.aliases),
        npc.personality,
        npc.goals,
        // Relations survive because they are keyed by name. Bonds do not,
        // because they are keyed by character id and a bundle has no
        // characters: an imported bond would point at somebody who has never
        // existed on this machine.
        npc.relations || "[]",
        npcPortraits[index],
        now,
        now,
      );
      copied += 1;
    }

    for (const encounter of bundle.encounters) {
      db.prepare(
        `INSERT INTO encounter_templates
           (id, campaign_id, name, enemies_json, battlefield, map_json, notes,
            created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        workshop.id,
        encounter.name,
        JSON.stringify(encounter.enemies),
        encounter.battlefield,
        encounter.notes,
        userId,
        now,
        now,
      );
      copied += 1;
    }

    for (const table of bundle.tables) {
      db.prepare(
        `INSERT INTO roll_tables (id, campaign_id, name, entries_json, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        workshop.id,
        table.name,
        JSON.stringify(table.entries),
        userId,
        now,
        now,
      );
      copied += 1;
    }

    for (const [index, map] of bundle.maps.entries()) {
      const backdropPath = mapBackdrops[index];
      db.prepare(
        `INSERT INTO prepared_maps
           (id, campaign_id, name, notes, tags_json, width, height, terrain, ambient,
            theme, lights_json, seed, backdrop_path, backdrop_transform_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        workshop.id,
        map.name,
        map.notes,
        JSON.stringify(map.tags),
        map.width,
        map.height,
        map.terrain,
        map.ambient,
        map.theme,
        JSON.stringify(map.lights),
        map.seed,
        backdropPath,
        // The transform only means something over its art.
        backdropPath ? JSON.stringify(map.backdropTransform) : "{}",
        now,
        now,
      );
      copied += 1;
    }

    // The board in two passes: every card first, so an arrow drawn from the
    // first card to the last has something to point at.
    const beatIds = bundle.storyboard.map(() => crypto.randomUUID());
    for (const [index, beat] of bundle.storyboard.entries()) {
      db.prepare(
        `INSERT INTO workshop_beats
           (id, campaign_id, kind, title, body, links_json, edges_json, x, y, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '{}', '[]', ?, ?, ?, ?)`,
      ).run(beatIds[index], workshop.id, beat.kind, beat.title, beat.body, beat.x, beat.y, now, now);
      copied += 1;
    }
    for (const [index, beat] of bundle.storyboard.entries()) {
      const edges = resolveEdges(beat.edges, beatIds.length)
        .filter((edge) => edge !== index)
        .map((edge) => beatIds[edge]);
      if (edges.length) {
        db.prepare(`UPDATE workshop_beats SET edges_json = ? WHERE id = ?`).run(
          JSON.stringify(edges),
          beatIds[index],
        );
      }
    }

  })();

  // House rules land outside the transaction because setHouseRules chunks the
  // prose and queues an embedding, which is the same reason runContentImport
  // writes them after its own transaction closes.
  if (bundle.houseRulesText.trim()) {
    setHouseRules(workshop.id, bundle.houseRulesText);
    copied += 1;
  }

  // Hand-built monsters are USER-scoped, not campaign-scoped, so they are
  // written outside the transaction above through the module that owns their
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

  return { workshopId: workshop.id, copied };
}
