// World packs: pre-configured universes a table can pick instead of a bare
// genre. A pack is a PURE NAME MAPPING over the existing 5e engine. It renames
// what the player and the DM see; it never adds or changes a mechanic.
//
// Why name-mapping only, and not new mechanics:
//   - The precedent already ships. src/lib/bestiary/index.ts overlays a
//     genre-appropriate name on a real Open5e stat block ("Sump Rat" over
//     giant-rat) and seven catalogs work that way today.
//   - Character sheets store spells, equipment and features BY NAME
//     (src/lib/schemas/sheet.ts). If a pack rewrote "Cure Wounds" to "Curaga"
//     at storage time, findSpellByName, use_spell_slot, spellMechanicsFor and
//     FEATURE_EFFECTS would all miss. Display-only reskins are the only way
//     a pack cannot corrupt a sheet.
//   - A character built in a pack campaign stays portable. Pull it into a
//     plain campaign and it simply renders under its canonical names.
//
// A pack always also sets the campaign's `genre` to its `baseGenre`, so every
// existing genre consumer keeps working and a deleted pack degrades cleanly
// back to a plain genre.
//
// This module is client-safe on purpose: no fs, no node builtins, no database.
// The character builder imports it directly. The loader that reads the pack
// files off disk lives in ./index.ts, which is server-only.
import { z } from "zod";
import { GENRES } from "@/lib/schemas/game-settings";
import {
  MAX_PACK_ART_DATA_URL_CHARS,
  MAX_PACK_ART_KEYS,
  PACK_ART_DATA_URL,
  PACK_ART_KEY,
} from "@/lib/worlds/art";

// A manifest is prose, tables and a few hundred thumbnails at most. Anything
// larger than this is not a world pack, and the cap is what stops a hostile
// registry from streaming until the disk fills. Sixteen megabytes is roughly
// four hundred pictures at the per-picture cap (src/lib/worlds/art.ts); the
// packs this project's author maintains are two to three. Declared here,
// client-safe, so the editor that writes a pack can measure against it.
export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

// A reskin of something addressed by id (races, classes, backgrounds). The id
// is canonical and never rewritten; only `name` changes what is displayed.
const idReskin = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(60),
  blurb: z.string().max(200).default(""),
});

// A reskin of something the sheet stores by NAME (spells, items, features).
// `from` is the canonical name and stays on the sheet; `name` is the label.
const nameReskin = z.object({
  from: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  blurb: z.string().max(200).default(""),
});

export const worldPackSchema = z.object({
  // Also the filename stem. The regex is the only thing standing between a
  // downloaded manifest and an arbitrary write path, so keep it strict.
  id: z.string().regex(/^[a-z][a-z0-9_]{2,49}$/),
  name: z.string().min(1).max(70),
  blurb: z.string().min(1).max(200),
  // Plugin metadata, shown in the browser so a table can tell two builds of
  // the same world apart and know who made the one they installed.
  version: z.string().trim().max(20).default("1.0.0"),
  author: z.string().trim().max(80).default(""),
  homepage: z.string().trim().max(300).default(""),
  // What this pack is a homage to, and who owns it.
  //
  // `rightsHolder` is what turns the notice from a soft "community content"
  // line into the explicit non-affiliation disclaimer. A pack built on someone
  // else's IP MUST set it; an original world leaves it empty and gets the
  // milder notice. See UnofficialPackNotice.
  inspiredBy: z.string().min(1).max(200),
  rightsHolder: z.string().trim().max(120).default(""),
  // Franchises with several distinct eras ship one pack per era (Final
  // Fantasy VII and XIV are not the same world). `franchise` is the group
  // label the picker collapses them under, and `edition` is the label of the
  // entry inside that group. A single-era franchise leaves `edition` empty
  // and simply renders as one button.
  franchise: z.string().min(1).max(60),
  edition: z.string().max(60).default(""),
  // Sort key inside a franchise group, so editions list in release order
  // rather than alphabetically.
  editionOrder: z.number().int().min(0).max(999).default(0),
  baseGenre: z.enum(GENRES),
  // GenrePreset overrides. An empty string or empty array means "inherit the
  // base genre's value", which is what presetFor() layers on.
  dmFlavor: z.string().max(1400).default(""),
  mapStyle: z.string().max(300).default(""),
  portraitStyle: z.string().max(300).default(""),
  nameHints: z.string().max(300).default(""),
  raceHint: z.string().max(300).default(""),
  companionRaces: z.array(z.string()).default([]),
  // Campaign seeds. `theme` fills campaigns.theme (whose create-dialog input
  // caps at 120) and `premise` fills campaigns.description (capped at 500).
  theme: z.string().min(1).max(120),
  premise: z.string().max(500).default(""),
  races: z.array(idReskin).default([]),
  classes: z
    .array(idReskin.extend({ castingLabel: z.string().max(40).nullable().default(null) }))
    .default([]),
  backgrounds: z.array(idReskin).default([]),
  spells: z.array(nameReskin).default([]),
  items: z.array(nameReskin).default([]),
  features: z.array(nameReskin).default([]),
  // Same shape as BestiaryEntry on purpose, so a pack's list can be overlaid
  // straight onto the genre catalog in src/lib/bestiary.
  monsters: z
    .array(
      z.object({
        slug: z.string().min(1),
        name: z.string().min(1).max(60),
        cr: z.number().min(0),
        // SRD creature type in lowercase ("undead"), which picks the
        // thumbnail plate. A slug the genre roster also lists inherits its
        // type at overlay time when this is left empty.
        type: z.string().max(20).default(""),
        blurb: z.string().max(200).default(""),
      }),
    )
    .default([]),
  // Alignment codes this world leans on, using the same codes the builder
  // lists (LG, NG, CG, LN, N, CN, LE, NE, CE). The other nine stay pickable.
  alignments: z.array(z.string().max(2)).max(9).default([]),
  nameSeeds: z
    .object({
      people: z.array(z.string().max(40)).default([]),
      places: z.array(z.string().max(40)).default([]),
    })
    .default({ people: [], places: [] }),
  factions: z
    .array(z.object({ name: z.string().max(60), blurb: z.string().max(200) }))
    .default([]),
  locations: z
    .array(z.object({ name: z.string().max(60), blurb: z.string().max(200) }))
    .default([]),
  hooks: z.array(z.string().max(240)).default([]),
  glossary: z
    .array(z.object({ term: z.string().max(40), meaning: z.string().max(160) }))
    .default([]),
  // Thumbnails, keyed the way src/lib/worlds/art.ts derives keys ("cover",
  // "monster-<slug>", "race-<id>", ...) and carried as PNG, JPEG or WebP data
  // URLs, the same way a workshop bundle carries its portraits. This is the
  // WIRE shape: the server lifts the images out at load time and serves them
  // from /api/worlds/<id>/art/<key>, so nothing downstream of the loader ever
  // sees a base64 string here. Art for a key the pack does not name is
  // tolerated by the schema and flagged by the validator.
  art: z
    .record(
      z.string().regex(PACK_ART_KEY),
      z.string().max(MAX_PACK_ART_DATA_URL_CHARS).regex(PACK_ART_DATA_URL, {
        message: "Pack art must be PNG, JPEG or WebP data URLs.",
      }),
    )
    .refine((record) => Object.keys(record).length <= MAX_PACK_ART_KEYS, {
      message: `A pack carries at most ${MAX_PACK_ART_KEYS} pictures.`,
    })
    .default({}),
  // Which keys `art` carried, filled in by the loader after it lifts the
  // images out, so a client can ask "does this pack have a picture for my
  // class" without downloading a single byte of it. Ignored on the way in:
  // whatever a manifest claims here is overwritten by what it actually holds.
  artKeys: z.array(z.string().regex(PACK_ART_KEY)).max(MAX_PACK_ART_KEYS).default([]),
});

export type WorldPack = z.infer<typeof worldPackSchema>;

// The summary shape and the picker grouping live in ./summary (no zod, so
// a listing page stays light); they are re-exported here for the loader,
// the scripts and the tests that always reached them through this module.
export {
  groupByFranchise,
  summarizePack,
  type FranchiseGroup,
  type WorldPackSource,
  type WorldPackSummary,
} from "@/lib/worlds/summary";

// One entry in a remote registry index. It is deliberately NOT the pack: a
// browser listing must be cheap, and the manifest is only downloaded when
// somebody installs it.
export const registryEntrySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{2,49}$/),
  name: z.string().min(1).max(70),
  blurb: z.string().min(1).max(200),
  version: z.string().trim().max(20).default("1.0.0"),
  author: z.string().trim().max(80).default(""),
  homepage: z.string().trim().max(300).default(""),
  inspiredBy: z.string().min(1).max(200),
  rightsHolder: z.string().trim().max(120).default(""),
  franchise: z.string().min(1).max(60),
  edition: z.string().max(60).default(""),
  editionOrder: z.number().int().min(0).max(999).default(0),
  baseGenre: z.enum(GENRES),
  // Where the manifest itself lives, typically a GitHub release asset.
  // https only: an admin-configured registry is trusted to name hosts, but
  // never trusted to downgrade the transport.
  downloadUrl: z.string().url().startsWith("https://").max(500),
});

export const registryIndexSchema = z.object({
  packs: z.array(registryEntrySchema).max(500).default([]),
});

export type RegistryEntry = z.infer<typeof registryEntrySchema>;
