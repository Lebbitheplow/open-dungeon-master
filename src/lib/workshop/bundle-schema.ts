import { z } from "zod";
import { createSheetSchema } from "@/lib/schemas/sheet";
import { GENRES } from "@/lib/schemas/game-settings";
import { BEAT_KINDS, ROUTE_KINDS, ROUTE_LABEL_MAX } from "@/lib/workshop/board";
import { worldPackDraftSchema } from "@/lib/worlds/draft";

// The shape of a workshop bundle: every field, its length and its ceiling.
// Split from src/lib/workshop/bundle.ts (which re-exports all of it) to keep
// both under the project's 500-line cap; the reasoning about what a bundle
// carries and what it deliberately does not lives at the top of that file.

export const WORKSHOP_BUNDLE_KIND = "odm.workshop";
export const WORKSHOP_BUNDLE_VERSION = 1;

// Sixty-four megabytes: still one in-memory JSON parse, but with room for a
// workshop's art. Prose alone never gets near this (four megabytes is
// roughly a novel); the budget exists for base64-encoded backdrops and
// portraits, each individually capped below at the same 8 MB the upload
// route enforces.
export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

// Per-image binary cap, matching /api/upload's MAX_FILE_SIZE so nothing can
// arrive by bundle that could not have been uploaded by hand.
export const MAX_BUNDLE_IMAGE_BYTES = 8 * 1024 * 1024;

// A little over MAX_BUNDLE_IMAGE_BYTES * 4/3: base64 overhead plus header.
const MAX_IMAGE_DATA_URL_CHARS = 11_300_000;

export const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

// "" means "no image": absent art is an empty string rather than a missing
// key so a bundle diff shows the field either way.
const bundleImageSchema = z
  .string()
  .max(MAX_IMAGE_DATA_URL_CHARS)
  .refine((value) => value === "" || IMAGE_DATA_URL.test(value), {
    message: "Images must be PNG, JPEG or WebP data URLs.",
  })
  .default("");

export const BUNDLE_LIMITS = {
  lore: 500,
  locations: 300,
  npcs: 300,
  encounters: 200,
  tables: 200,
  maps: 100,
  storyboard: 200,
  monsters: 200,
  homebrew: 400,
  pregens: 12,
} as const;

export const BUNDLE_KINDS = Object.keys(BUNDLE_LIMITS) as Array<keyof typeof BUNDLE_LIMITS>;

// The licensing half, lifted from worldPackSchema so the two cannot drift.
export const bundleManifestSchema = z.object({
  name: z.string().trim().min(1).max(70),
  blurb: z.string().trim().min(1).max(200),
  version: z.string().trim().max(20).default("1.0.0"),
  author: z.string().trim().max(80).default(""),
  homepage: z.string().trim().max(300).default(""),
  // What this is a homage to. Required for the same reason a pack requires
  // it: a reader deserves to know before they install.
  inspiredBy: z.string().trim().min(1).max(200),
  // Who owns what it is built on. Empty means an original work, which gets
  // the milder community-content notice instead of a non-affiliation
  // disclaimer it does not need. See UnofficialPackNotice.
  rightsHolder: z.string().trim().max(120).default(""),
});

export type BundleManifest = z.infer<typeof bundleManifestSchema>;

// The portable key of a linkable row, and whether the row is a snapshot of
// the shared workshop a chapter draws on rather than the chapter's own.
const refSchema = z.string().trim().max(64).default("");
const sharedSchema = z.boolean().default(false);
// An index into one of the bundle's own arrays, or nothing.
const indexSchema = z.number().int().min(0).max(1_000).nullable().default(null);

const loreSchema = z.object({
  category: z.string().trim().max(40),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000).default(""),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
  // A secret stays a secret on the other side; a handout keeps its picture.
  visibility: z.enum(["party", "dm"]).default("party"),
  // Pinned entries ride in every prompt rather than waiting to be retrieved.
  pinned: z.boolean().default(false),
  style: z.enum(["plain", "parchment", "notice"]).default("plain"),
  image: bundleImageSchema,
});

const locationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  layoutDescription: z.string().max(8_000).default(""),
  connections: z.array(z.string().trim().max(120)).max(40).default([]),
  // The map the place stands on, as an index into `maps`, and the sound it
  // makes (normalised on import by src/lib/battlemap/scene.ts).
  map: indexSchema,
  ambience: z.record(z.string(), z.unknown()).nullable().default(null),
  ref: refSchema,
  shared: sharedSchema,
});

const npcSchema = z.object({
  name: z.string().trim().min(1).max(120),
  attitude: z.enum(["hostile", "indifferent", "friendly"]).default("indifferent"),
  trait: z.string().max(500).default(""),
  location: z.string().max(120).default(""),
  // A role id or free text; bundles written before the field have none.
  role: z.string().trim().max(40).default(""),
  aliases: z.array(z.string().trim().max(80)).max(20).default([]),
  personality: z.string().max(4_000).default(""),
  goals: z.string().max(4_000).default(""),
  // Relations are keyed by NAME, not by id, which is why a cast bundled
  // together arrives with its feuds intact. Same property the workshop
  // import relies on (src/lib/db/content-import.ts).
  relations: z.string().max(8_000).default(""),
  portrait: bundleImageSchema,
  // Their read-aloud voice, normalised on import (src/lib/npcs/forge.ts).
  voice: z.record(z.string(), z.unknown()).nullable().default(null),
  ref: refSchema,
  shared: sharedSchema,
});

// Factions (docs/vtt-parity-implementation-plan.md section 6). Members are
// matched back by NPC name on import, the way relations are.
const factionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  blurb: z.string().max(400).default(""),
  goal: z.string().max(400).default(""),
  attitude: z.enum(["hostile", "wary", "neutral", "friendly", "allied"]).default("neutral"),
  power: z.number().int().min(0).max(5).default(1),
  tags: z.array(z.string().trim().max(40)).max(8).default([]),
  members: z.array(z.string().trim().max(120)).max(40).default([]),
  portrait: bundleImageSchema,
});

const encounterSchema = z.object({
  name: z.string().trim().min(1).max(120),
  enemies: z.array(z.unknown()).max(40).default([]),
  battlefield: z.string().max(2_000).default(""),
  notes: z.string().max(8_000).default(""),
  // The saved map settings, with the prepared map as an index into `maps`
  // rather than an id, and the rest of the plan: placements, entry, hidden
  // enemies, overrides, rewards and phases. Both normalised on import by
  // src/lib/dm/encounter-template-logic.ts.
  map: z
    .object({
      map: indexSchema,
      seed: z.number().int().nullable().default(null),
      theme: z.string().max(40).nullable().default(null),
      ambient: z.string().max(40).nullable().default(null),
      width: z.number().int().nullable().default(null),
      height: z.number().int().nullable().default(null),
    })
    .default({ map: null, seed: null, theme: null, ambient: null, width: null, height: null }),
  extras: z.record(z.string(), z.unknown()).default({}),
  ref: refSchema,
  shared: sharedSchema,
});

const tableSchema = z.object({
  name: z.string().trim().min(1).max(120),
  entries: z.array(z.unknown()).max(200).default([]),
  // A table that draws without replacement still does on the other side;
  // what was already drawn is the source table's play and stays behind.
  noReplacement: z.boolean().default(false),
});

const mapSchema = z.object({
  name: z.string().trim().min(1).max(120),
  notes: z.string().max(4_000).default(""),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
  width: z.number().int().min(1).max(200),
  height: z.number().int().min(1).max(200),
  terrain: z.string().max(200_000).default(""),
  ambient: z.string().max(40).default("day"),
  theme: z.string().max(40).default("field"),
  lights: z.array(z.unknown()).max(200).default([]),
  seed: z.number().int().default(0),
  backdrop: bundleImageSchema,
  // How the backdrop sits on the grid (scale and offset). Meaningless
  // without the art, so it travels and lands only alongside it.
  backdropTransform: z.record(z.string(), z.unknown()).default({}),
  // What the map is painted with (src/lib/battlemap/skins.ts). Optional, so
  // a bundle written before skins existed still reads; normalised on import.
  skin: z.record(z.string(), z.unknown()).default({}),
  // The scene layer (src/lib/battlemap/scene.ts): labels, props, door
  // states, light zones, freehand drawings, the DM-only overlay picture and
  // the sound, plus whether the sky lights it. Each normalised on import
  // against the map's own grid.
  outdoors: z.boolean().nullable().default(null),
  labels: z.array(z.unknown()).max(400).default([]),
  props: z.array(z.unknown()).max(400).default([]),
  doors: z.record(z.string(), z.unknown()).default({}),
  zones: z.array(z.unknown()).max(200).default([]),
  drawings: z.array(z.unknown()).max(400).default([]),
  ambience: z.record(z.string(), z.unknown()).default({}),
  overlay: bundleImageSchema,
  ref: refSchema,
  shared: sharedSchema,
});

const beatSchema = z.object({
  kind: z.enum(BEAT_KINDS),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(4_000).default(""),
  // Arrows travel as INDEXES into this array rather than as ids, because
  // ids do not survive a bundle and an arrow that pointed at a stranger's
  // row would land nowhere.
  edges: z.array(z.number().int().min(0)).max(8).default([]),
  // What each arrow means (#157), keyed by the same index.
  routes: z
    .array(
      z.object({
        to: z.number().int().min(0),
        kind: z.enum(ROUTE_KINDS),
        label: z.string().max(ROUTE_LABEL_MAX).default(""),
      }),
    )
    .max(8)
    .default([]),
  // What the card picked (#155), as indexes into npcs, maps, encounters and
  // locations.
  links: z
    .object({ npc: indexSchema, map: indexSchema, encounter: indexSchema, location: indexSchema })
    .partial()
    .default({}),
  x: z.number().default(0),
  y: z.number().default(0),
});

// The region map (it never travelled before). Terrain is one character per
// tile, checked against its size and its tile alphabet on import; anchors
// name places by index into `locations`.
const overworldSchema = z.object({
  seed: z.number().int().default(0),
  width: z.number().int().min(1).max(400),
  height: z.number().int().min(1).max(400),
  terrain: z.string().max(160_000),
  params: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().max(4_000).default(""),
  pins: z.array(z.unknown()).max(40).default([]),
  paths: z.array(z.unknown()).max(400).default([]),
  labels: z.array(z.unknown()).max(400).default([]),
  anchors: z
    .array(z.object({ location: z.number().int().min(0), x: z.number().int(), y: z.number().int() }))
    .max(300)
    .default([]),
  backdrop: bundleImageSchema,
});

const monsterSchema = z.object({
  name: z.string().trim().min(1).max(120),
  desc: z.string().max(8_000).default(""),
  stats: z.unknown(),
  extraDamagePerRound: z.number().min(0).max(1_000).default(0),
});

// Items, spells and character options travel as the same loose blob the
// homebrew table stores, and are normalized per kind on the way in
// (src/lib/homebrew/gear.ts), so a bundle written by an older build cannot
// hand the engine a weapon it cannot roll.
const homebrewSchema = z.object({
  kind: z.enum(["spell", "feat", "item", "race", "background", "archetype"]),
  name: z.string().trim().min(1).max(80),
  data: z.record(z.string(), z.unknown()).default({}),
});

// A pregenerated character: a whole sheet, checked by the same schema the
// character builder submits through, so a bundle cannot hand the dice
// engine a sheet it would not have accepted from a player.
const pregenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  level: z.number().int().min(1).max(20),
  role: z.enum(["pc", "companion"]).default("pc"),
  sheet: createSheetSchema,
});

export const workshopBundleSchema = z.object({
  kind: z.literal(WORKSHOP_BUNDLE_KIND),
  version: z.literal(WORKSHOP_BUNDLE_VERSION),
  manifest: bundleManifestSchema,
  genre: z.enum(GENRES).default("high_fantasy"),
  theme: z.string().max(120).default(""),
  premise: z.string().max(500).default(""),
  targetParty: z
    .object({ size: z.number().int().min(1).max(10), level: z.number().int().min(1).max(20) })
    .default({ size: 4, level: 3 }),
  houseRulesText: z.string().max(20_000).default(""),
  // Variant toggles travel as a loose record and are normalized by the
  // engine's own normalizeGameSettings on the way in, so a bundle written by
  // an older build cannot set a flag this one does not have.
  variantRules: z.record(z.string(), z.unknown()).default({}),
  lore: z.array(loreSchema).max(BUNDLE_LIMITS.lore).default([]),
  locations: z.array(locationSchema).max(BUNDLE_LIMITS.locations).default([]),
  npcs: z.array(npcSchema).max(BUNDLE_LIMITS.npcs).default([]),
  factions: z.array(factionSchema).max(60).default([]),
  encounters: z.array(encounterSchema).max(BUNDLE_LIMITS.encounters).default([]),
  tables: z.array(tableSchema).max(BUNDLE_LIMITS.tables).default([]),
  maps: z.array(mapSchema).max(BUNDLE_LIMITS.maps).default([]),
  storyboard: z.array(beatSchema).max(BUNDLE_LIMITS.storyboard).default([]),
  monsters: z.array(monsterSchema).max(BUNDLE_LIMITS.monsters).default([]),
  homebrew: z.array(homebrewSchema).max(BUNDLE_LIMITS.homebrew).default([]),
  pregens: z.array(pregenSchema).max(BUNDLE_LIMITS.pregens).default([]),
  // The world pack the workshop is writing (src/lib/worlds/draft.ts), art
  // inline, so a shared workshop arrives with its plugin half-built rather
  // than as a folder of lore somebody has to re-key. Null in bundles from
  // builds before the creator existed.
  plugin: worldPackDraftSchema.nullable().default(null),
  overworld: overworldSchema.nullable().default(null),
  // A chapter's shared workshop, by name, when the chapter draws on one
  // (#159). The rows its cards pick from it ride along marked `shared`, so
  // the bundle stands on its own; on import they either link to a workshop
  // of the importer's that holds the same refs, or land as the chapter's
  // own rows.
  dependsOn: z.object({ name: z.string().trim().max(80) }).nullable().default(null),
});

export type WorkshopBundle = z.infer<typeof workshopBundleSchema>;
