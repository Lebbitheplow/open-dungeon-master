import { z } from "zod";
import { GENRES } from "@/lib/schemas/game-settings";
import { BEAT_KINDS } from "@/lib/workshop/board";

// A workshop as a file: what travels between two people, and what does not.
//
// The format follows docs/worlds.md rather than inventing a second one. A
// world pack manifest is already the app's answer to "somebody made a thing
// and wants to hand it to a stranger", and it carries the licensing fields
// that answer matters for. This reuses those fields verbatim, so the notice
// a shared workshop shows is the SAME UnofficialPackNotice a pack shows, and
// the same rule applies: original work only, and `rightsHolder` filled in for
// anything built on somebody else's setting.
//
// What a bundle deliberately does NOT carry:
//
//   - IDs. Everything is written fresh on import. A bundle is content, not a
//     database dump, so it cannot collide with what the importer already has
//     and cannot smuggle a reference to a row on somebody else's machine.
//   - Anything from play. A workshop has no transcript, no party and no
//     characters, which is exactly why it is the thing worth sharing.
//
// Images DO travel (since format v1 grew the optional fields): a map's
// backdrop and an NPC's portrait ride along as size-capped data URLs, because
// a map without its art is half a map. The licensing weight that the old
// no-images rule carried now rests on the manifest declaration plus an
// explicit warning whenever art is aboard: the person exporting vouches for
// what they share, the person importing is told what they received. An older
// build importing a newer bundle strips the image fields and lands geometry
// only, which is why the version number did not move.
//
// Pure: no "@/" imports with I/O, so scripts/test-workshop-bundle.mjs drives
// the whole format without a database. The rim is src/lib/db/workshop-bundle.ts.

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

const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

// "" means "no image": absent art is an empty string rather than a missing
// key so a bundle diff shows the field either way.
const bundleImageSchema = z
  .string()
  .max(MAX_IMAGE_DATA_URL_CHARS)
  .refine((value) => value === "" || IMAGE_DATA_URL.test(value), {
    message: "Images must be PNG, JPEG or WebP data URLs.",
  })
  .default("");

export type BundleImage = { mime: string; ext: "png" | "jpg" | "webp"; bytes: Buffer };

// Decodes a schema-accepted image field back to bytes, re-checking the
// binary size: base64 length was capped by the schema, but this is the
// number the disk actually pays.
export function decodeBundleImage(dataUrl: string): BundleImage | null {
  const match = dataUrl.match(IMAGE_DATA_URL);
  if (!match) {
    return null;
  }
  const mime = `image/${match[1]}`;
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  if (!bytes.length || bytes.length > MAX_BUNDLE_IMAGE_BYTES) {
    return null;
  }
  const ext = match[1] === "png" ? "png" : match[1] === "webp" ? "webp" : "jpg";
  return { mime, ext, bytes };
}

// The other direction, for export. Returns "" for anything that cannot
// travel (unknown extension, oversized file), so the caller can count what
// it had to leave behind.
export function encodeBundleImage(filePath: string, bytes: Buffer): string {
  if (!bytes.length || bytes.length > MAX_BUNDLE_IMAGE_BYTES) {
    return "";
  }
  const extension = filePath.toLowerCase().split(".").pop() ?? "";
  const mime =
    extension === "png"
      ? "image/png"
      : extension === "webp"
        ? "image/webp"
        : extension === "jpg" || extension === "jpeg"
          ? "image/jpeg"
          : "";
  if (!mime) {
    return "";
  }
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

// Per-kind ceilings. These are not really about memory, they are about a
// bundle staying something a person can read before they trust it.
export const BUNDLE_LIMITS = {
  lore: 500,
  locations: 300,
  npcs: 300,
  encounters: 200,
  tables: 200,
  maps: 100,
  storyboard: 200,
  monsters: 200,
} as const;

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

const loreSchema = z.object({
  category: z.string().trim().max(40),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000).default(""),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
});

const locationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  layoutDescription: z.string().max(8_000).default(""),
  connections: z.array(z.string().trim().max(120)).max(40).default([]),
});

const npcSchema = z.object({
  name: z.string().trim().min(1).max(120),
  attitude: z.enum(["hostile", "indifferent", "friendly"]).default("indifferent"),
  trait: z.string().max(500).default(""),
  location: z.string().max(120).default(""),
  aliases: z.array(z.string().trim().max(80)).max(20).default([]),
  personality: z.string().max(4_000).default(""),
  goals: z.string().max(4_000).default(""),
  // Relations are keyed by NAME, not by id, which is why a cast bundled
  // together arrives with its feuds intact. Same property the workshop
  // import relies on (src/lib/db/content-import.ts).
  relations: z.string().max(8_000).default(""),
  portrait: bundleImageSchema,
});

const encounterSchema = z.object({
  name: z.string().trim().min(1).max(120),
  enemies: z.array(z.unknown()).max(40).default([]),
  battlefield: z.string().max(2_000).default(""),
  notes: z.string().max(8_000).default(""),
});

const tableSchema = z.object({
  name: z.string().trim().min(1).max(120),
  entries: z.array(z.unknown()).max(200).default([]),
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
});

const beatSchema = z.object({
  kind: z.enum(BEAT_KINDS),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(4_000).default(""),
  // Arrows travel as INDEXES into this array rather than as ids, because
  // ids do not survive a bundle and an arrow that pointed at a stranger's
  // row would land nowhere.
  edges: z.array(z.number().int().min(0)).max(8).default([]),
  x: z.number().default(0),
  y: z.number().default(0),
});

const monsterSchema = z.object({
  name: z.string().trim().min(1).max(120),
  desc: z.string().max(8_000).default(""),
  stats: z.unknown(),
  extraDamagePerRound: z.number().min(0).max(1_000).default(0),
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
  encounters: z.array(encounterSchema).max(BUNDLE_LIMITS.encounters).default([]),
  tables: z.array(tableSchema).max(BUNDLE_LIMITS.tables).default([]),
  maps: z.array(mapSchema).max(BUNDLE_LIMITS.maps).default([]),
  storyboard: z.array(beatSchema).max(BUNDLE_LIMITS.storyboard).default([]),
  monsters: z.array(monsterSchema).max(BUNDLE_LIMITS.monsters).default([]),
});

export type WorkshopBundle = z.infer<typeof workshopBundleSchema>;

export const BUNDLE_KIND_LABELS: Record<string, string> = {
  lore: "World lore",
  locations: "Places",
  npcs: "NPCs",
  encounters: "Prepared encounters",
  tables: "Roll tables",
  maps: "Battle maps",
  storyboard: "Storyboard cards",
  monsters: "Hand-built monsters",
};

export type BundleCounts = Record<keyof typeof BUNDLE_LIMITS, number>;

export function bundleCounts(bundle: WorkshopBundle): BundleCounts {
  return {
    lore: bundle.lore.length,
    locations: bundle.locations.length,
    npcs: bundle.npcs.length,
    encounters: bundle.encounters.length,
    tables: bundle.tables.length,
    maps: bundle.maps.length,
    storyboard: bundle.storyboard.length,
    monsters: bundle.monsters.length,
  };
}

export function bundleTotal(bundle: WorkshopBundle): number {
  return Object.values(bundleCounts(bundle)).reduce((sum, count) => sum + count, 0);
}

export function bundleImageCount(bundle: WorkshopBundle): number {
  return (
    bundle.maps.filter((map) => map.backdrop !== "").length +
    bundle.npcs.filter((npc) => npc.portrait !== "").length
  );
}

// What to say about a bundle before somebody trusts it. These are not
// validation errors; the bundle is already valid. They are the things a
// reasonable person would want said out loud.
export function bundleWarnings(bundle: WorkshopBundle): string[] {
  const warnings: string[] = [];
  if (bundle.manifest.rightsHolder.trim()) {
    warnings.push(
      `Built on ${bundle.manifest.rightsHolder.trim()}'s setting. It is a fan work and is not affiliated with them.`,
    );
  }
  const images = bundleImageCount(bundle);
  if (images > 0) {
    warnings.push(
      `Carries ${images} image${images === 1 ? "" : "s"} (map backdrops and portraits). Only pass on art you made or have the right to share.`,
    );
  } else if (bundle.maps.length || bundle.npcs.length) {
    warnings.push(
      "No images came along: any map backdrops or NPC portraits have to be added again by hand.",
    );
  }
  if (bundle.houseRulesText.trim()) {
    warnings.push(
      "This bundle carries house rules. They land on the new workshop, not on any campaign, until you import them yourself.",
    );
  }
  return warnings;
}

export type BundleRead = { bundle: WorkshopBundle } | { error: string };

// The one door a stranger's file comes through.
//
// SECURITY: everything past this point is untrusted input from a file
// somebody was handed. Nothing here is written anywhere until the schema has
// accepted it, every string has a length, every array has a ceiling, and the
// whole thing has a byte cap checked BEFORE it is parsed as JSON: a
// four-gigabyte file must be refused by its size, not by running out of
// memory proving it is malformed.
export function readBundle(text: string): BundleRead {
  if (typeof text !== "string" || !text.trim()) {
    return { error: "That file is empty." };
  }
  // Byte length, not character count: a multi-byte string is bigger on the
  // wire than it looks in the editor.
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_BUNDLE_BYTES) {
    return {
      error: `That file is ${Math.round(bytes / 1024 / 1024)} MB. A workshop bundle caps at ${MAX_BUNDLE_BYTES / 1024 / 1024} MB.`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "That file is not JSON." };
  }
  const record = (parsed ?? {}) as Record<string, unknown>;
  // Two specific misses get their own sentence, because "invalid bundle" is
  // useless when the real answer is "that is a world pack, not a workshop"
  // or "that came out of a newer build".
  if (record.kind !== WORKSHOP_BUNDLE_KIND) {
    return { error: "That file is not a workshop bundle." };
  }
  if (record.version !== WORKSHOP_BUNDLE_VERSION) {
    return {
      error: `That bundle is format version ${String(record.version)}; this build reads version ${WORKSHOP_BUNDLE_VERSION}.`,
    };
  }
  const result = workshopBundleSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    return {
      error: first
        ? `That bundle is malformed at ${first.path.join(".") || "its root"}: ${first.message}`
        : "That bundle is malformed.",
    };
  }
  return { bundle: result.data };
}

// Arrows are stored as indexes, so an edge past the end of the board is
// dropped rather than trusted. A bundle that was hand-edited is the case
// this exists for.
export function resolveEdges(edges: number[], total: number): number[] {
  return [...new Set(edges.filter((edge) => Number.isInteger(edge) && edge >= 0 && edge < total))];
}
