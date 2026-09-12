// A world pack while it is being written.
//
// worldPackSchema (./types.ts) is the finished thing: every required field
// present, every id real, every string inside its cap. Nobody writes a pack in
// that state; they write a name, come back a week later with six races, and
// paste the DM brief last. So the plugin creator in the workshop keeps a
// DRAFT, which is the same shape with nothing required, and only the export
// step asks worldPackSchema whether it is done.
//
// The draft keeps every cap the pack has (a 200 character blurb is still 200
// characters while it is being typed), so nothing a person writes here has to
// be clipped later; the only things that can fail at export are the things
// that were left empty and the things the catalog does not know.
//
// Client-safe on purpose: the creator edits this in the browser. No fs, no
// database. The store is src/lib/db/world-pack-drafts.ts.
import { z } from "zod";
import { GENRES } from "@/lib/schemas/game-settings";
import {
  MAX_PACK_ART_DATA_URL_CHARS,
  MAX_PACK_ART_KEYS,
  PACK_ART_DATA_URL,
  PACK_ART_KEY,
  packArtSlots,
} from "@/lib/worlds/art";
import { worldPackSchema, type WorldPack } from "@/lib/worlds/types";
import { packIdFrom } from "@/lib/workshop/to-pack";

// The caps mirror worldPackSchema; the mins are gone.
const idReskinDraft = z.object({
  id: z.string().max(60).default(""),
  name: z.string().max(60).default(""),
  blurb: z.string().max(200).default(""),
});

const nameReskinDraft = z.object({
  from: z.string().max(80).default(""),
  name: z.string().max(80).default(""),
  blurb: z.string().max(200).default(""),
});

const pairDraft = z.object({
  name: z.string().max(60).default(""),
  blurb: z.string().max(200).default(""),
});

// Ceilings a pack does not state but a draft needs, so a runaway paste
// cannot make a manifest nobody can open. Generous: the size targets in
// docs/worlds.md are a tenth of these.
export const DRAFT_LIST_MAX = 200;
export const DRAFT_SEEDS_MAX = 60;

export const worldPackDraftSchema = z.object({
  // Empty means "derive from the name at export". A typed id is kept only
  // when it already matches the pack's pattern, so a draft can never carry
  // an id the install path would refuse.
  id: z
    .string()
    .max(50)
    .default("")
    .transform((value) => (/^[a-z][a-z0-9_]{2,49}$/.test(value) ? value : "")),
  name: z.string().max(70).default(""),
  blurb: z.string().max(200).default(""),
  version: z.string().trim().max(20).default("1.0.0"),
  author: z.string().trim().max(80).default(""),
  homepage: z.string().trim().max(300).default(""),
  inspiredBy: z.string().max(200).default(""),
  rightsHolder: z.string().trim().max(120).default(""),
  franchise: z.string().max(60).default(""),
  edition: z.string().max(60).default(""),
  editionOrder: z.number().int().min(0).max(999).default(0),
  baseGenre: z.enum(GENRES).default("high_fantasy"),
  dmFlavor: z.string().max(1400).default(""),
  mapStyle: z.string().max(300).default(""),
  portraitStyle: z.string().max(300).default(""),
  nameHints: z.string().max(300).default(""),
  raceHint: z.string().max(300).default(""),
  companionRaces: z.array(z.string().max(60)).max(DRAFT_LIST_MAX).default([]),
  theme: z.string().max(120).default(""),
  premise: z.string().max(500).default(""),
  races: z.array(idReskinDraft).max(DRAFT_LIST_MAX).default([]),
  classes: z
    .array(idReskinDraft.extend({ castingLabel: z.string().max(40).nullable().default(null) }))
    .max(DRAFT_LIST_MAX)
    .default([]),
  backgrounds: z.array(idReskinDraft).max(DRAFT_LIST_MAX).default([]),
  spells: z.array(nameReskinDraft).max(DRAFT_LIST_MAX).default([]),
  items: z.array(nameReskinDraft).max(DRAFT_LIST_MAX).default([]),
  features: z.array(nameReskinDraft).max(DRAFT_LIST_MAX).default([]),
  monsters: z
    .array(
      z.object({
        slug: z.string().max(120).default(""),
        name: z.string().max(60).default(""),
        cr: z.number().min(0).default(0),
        type: z.string().max(20).default(""),
        blurb: z.string().max(200).default(""),
      }),
    )
    .max(DRAFT_LIST_MAX)
    .default([]),
  alignments: z.array(z.string().max(2)).max(9).default([]),
  nameSeeds: z
    .object({
      people: z.array(z.string().max(40)).max(DRAFT_SEEDS_MAX).default([]),
      places: z.array(z.string().max(40)).max(DRAFT_SEEDS_MAX).default([]),
    })
    .default({ people: [], places: [] }),
  factions: z.array(pairDraft).max(DRAFT_LIST_MAX).default([]),
  locations: z.array(pairDraft).max(DRAFT_LIST_MAX).default([]),
  hooks: z.array(z.string().max(240)).max(DRAFT_LIST_MAX).default([]),
  glossary: z
    .array(z.object({ term: z.string().max(40).default(""), meaning: z.string().max(160).default("") }))
    .max(DRAFT_LIST_MAX)
    .default([]),
  art: z
    .record(
      z.string().regex(PACK_ART_KEY),
      z.string().max(MAX_PACK_ART_DATA_URL_CHARS).regex(PACK_ART_DATA_URL),
    )
    .refine((record) => Object.keys(record).length <= MAX_PACK_ART_KEYS)
    .default({}),
});

export type WorldPackDraft = z.infer<typeof worldPackDraftSchema>;

export function blankDraft(genre: WorldPackDraft["baseGenre"] = "high_fantasy"): WorldPackDraft {
  return worldPackDraftSchema.parse({ baseGenre: genre === "custom" ? "high_fantasy" : genre });
}

// Anything pack-shaped becomes a draft: a finished pack somebody downloaded,
// a draft saved by an older build, a hand-written file. Unknown keys are
// dropped, artKeys (the loader's word, never the author's) is ignored, and a
// field the schema refuses takes the whole parse down rather than being
// quietly emptied, so a person is told their file was not read.
export function draftFromPack(raw: unknown): WorldPackDraft | { error: string } {
  const record = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
  delete record.artKeys;
  if (record.baseGenre === "custom") {
    // A pack must not be custom (docs/worlds.md); a draft started from one
    // simply forgets the choice.
    record.baseGenre = "high_fantasy";
  }
  const parsed = worldPackDraftSchema.safeParse(record);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      error: `That file is not a world pack: ${first ? `${first.path.join(".") || "root"} ${first.message}` : "unknown problem"}.`,
    };
  }
  return parsed.data;
}

// Rows with nothing in them are what a list editor leaves behind when a
// person adds a line and walks away. They are not the pack's fault, so the
// finish drops them rather than reporting them.
function isFilled(entry: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => String(entry[key] ?? "").trim().length > 0);
}

function trimAll<T extends Record<string, unknown>>(entry: T): T {
  return Object.fromEntries(
    Object.entries(entry).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]),
  ) as T;
}

// The draft as the pack it would be: blank rows dropped, whitespace trimmed,
// the id derived, art for anything the draft no longer names left behind,
// and the franchise falling back to the name the way compileToPack's does.
// This is a CANDIDATE: worldPackSchema decides whether it is a pack.
export function finishDraft(draft: WorldPackDraft): Record<string, unknown> {
  const races = draft.races.map(trimAll).filter((entry) => isFilled(entry, ["id", "name"]));
  const classes = draft.classes
    .map((entry) => ({ ...trimAll(entry), castingLabel: entry.castingLabel?.trim() || null }))
    .filter((entry) => isFilled(entry, ["id", "name"]));
  const backgrounds = draft.backgrounds.map(trimAll).filter((entry) => isFilled(entry, ["id", "name"]));
  const monsters = draft.monsters.map(trimAll).filter((entry) => isFilled(entry, ["slug", "name"]));
  const locations = draft.locations.map(trimAll).filter((entry) => isFilled(entry, ["name"]));
  const factions = draft.factions.map(trimAll).filter((entry) => isFilled(entry, ["name"]));
  const named = { races, classes, backgrounds, monsters, locations, factions };
  const slotKeys = new Set(packArtSlots(named).map((slot) => slot.key));
  const art = Object.fromEntries(Object.entries(draft.art).filter(([key]) => slotKeys.has(key)));
  const name = draft.name.trim();
  return {
    id: draft.id || packIdFrom(name),
    name,
    blurb: draft.blurb.trim(),
    version: draft.version.trim() || "1.0.0",
    author: draft.author.trim(),
    homepage: draft.homepage.trim(),
    inspiredBy: draft.inspiredBy.trim(),
    rightsHolder: draft.rightsHolder.trim(),
    franchise: draft.franchise.trim() || name.slice(0, 60),
    edition: draft.edition.trim(),
    editionOrder: draft.editionOrder,
    baseGenre: draft.baseGenre,
    dmFlavor: draft.dmFlavor.trim(),
    mapStyle: draft.mapStyle.trim(),
    portraitStyle: draft.portraitStyle.trim(),
    nameHints: draft.nameHints.trim(),
    raceHint: draft.raceHint.trim(),
    companionRaces: draft.companionRaces.map((id) => id.trim()).filter(Boolean),
    theme: draft.theme.trim(),
    premise: draft.premise.trim(),
    ...named,
    spells: draft.spells.map(trimAll).filter((entry) => isFilled(entry, ["from", "name"])),
    items: draft.items.map(trimAll).filter((entry) => isFilled(entry, ["from", "name"])),
    features: draft.features.map(trimAll).filter((entry) => isFilled(entry, ["from", "name"])),
    alignments: draft.alignments,
    nameSeeds: {
      people: draft.nameSeeds.people.map((seed) => seed.trim()).filter(Boolean),
      places: draft.nameSeeds.places.map((seed) => seed.trim()).filter(Boolean),
    },
    hooks: draft.hooks.map((hook) => hook.trim()).filter(Boolean),
    glossary: draft.glossary.map(trimAll).filter((entry) => isFilled(entry, ["term", "meaning"])),
    art,
  };
}

export type ExportOutcome = { pack: WorldPack } | { error: string };

// The finished pack, or the first reason it is not one. checkDraft
// (./draft-check.ts) lists every reason at once for the editor; this is the
// gate the export route stands behind, and it answers with the schema's own
// verdict so the two can never disagree about what a pack is.
export function exportDraft(draft: WorldPackDraft): ExportOutcome {
  const parsed = worldPackSchema.safeParse(finishDraft(draft));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      error: first ? `${first.path.join(".") || "pack"}: ${first.message}` : "The pack is not finished.",
    };
  }
  return { pack: { ...parsed.data, artKeys: [] } };
}

// How many things the draft names, for the workshop card: reskins, monsters
// and setting entries. Art and the identity fields do not count, because a
// pack with a cover and no tables is a cover.
export function draftCount(draft: WorldPackDraft): number {
  return (
    draft.races.length +
    draft.classes.length +
    draft.backgrounds.length +
    draft.spells.length +
    draft.items.length +
    draft.features.length +
    draft.monsters.length +
    draft.factions.length +
    draft.locations.length +
    draft.hooks.length +
    draft.glossary.length
  );
}

// Roughly what the manifest would weigh on disk, so the editor can show a
// person how close they are to the install cap before they find out from
// the install.
export function draftBytes(draft: WorldPackDraft): number {
  return new TextEncoder().encode(JSON.stringify(draft)).length;
}

// The flavour half compileToPack (src/lib/workshop/to-pack.ts) reads out of
// a workshop: the shape of its `draft`, narrowed to what this merge takes.
export type PulledFlavour = {
  baseGenre?: string;
  theme?: string;
  premise?: string;
  factions?: Array<{ name: string; blurb: string }>;
  locations?: Array<{ name: string; blurb: string }>;
  hooks?: string[];
  glossary?: Array<{ term: string; meaning: string }>;
  nameSeeds?: { people?: string[]; places?: string[] };
};

const fold = (value: string) => value.trim().toLowerCase();

function appendUnique<T>(
  current: T[],
  incoming: T[],
  key: (entry: T) => string,
  max: number,
): { list: T[]; added: number } {
  const seen = new Set(current.map(key).filter(Boolean));
  const list = [...current];
  let added = 0;
  for (const entry of incoming) {
    const id = key(entry);
    if (!id || seen.has(id) || list.length >= max) {
      continue;
    }
    seen.add(id);
    list.push(entry);
    added += 1;
  }
  return { list, added };
}

// "Pull from this workshop": the lore, places, hook cards and cast the
// workshop already holds, added to the draft's setting lists. Adds, never
// replaces: a faction the person already wrote by hand is theirs, and a
// pulled one with the same name is skipped rather than overwriting it. The
// identity fields (theme, premise) are filled only when they are empty.
export function mergePulled(
  draft: WorldPackDraft,
  pulled: PulledFlavour,
): { draft: WorldPackDraft; added: number } {
  const factions = appendUnique(draft.factions, pulled.factions ?? [], (entry) => fold(entry.name), DRAFT_LIST_MAX);
  const locations = appendUnique(draft.locations, pulled.locations ?? [], (entry) => fold(entry.name), DRAFT_LIST_MAX);
  const hooks = appendUnique(draft.hooks, pulled.hooks ?? [], fold, DRAFT_LIST_MAX);
  const glossary = appendUnique(draft.glossary, pulled.glossary ?? [], (entry) => fold(entry.term), DRAFT_LIST_MAX);
  const people = appendUnique(draft.nameSeeds.people, pulled.nameSeeds?.people ?? [], fold, DRAFT_SEEDS_MAX);
  const places = appendUnique(draft.nameSeeds.places, pulled.nameSeeds?.places ?? [], fold, DRAFT_SEEDS_MAX);
  const next: WorldPackDraft = {
    ...draft,
    theme: draft.theme.trim() ? draft.theme : (pulled.theme ?? "").slice(0, 120),
    premise: draft.premise.trim() ? draft.premise : (pulled.premise ?? "").slice(0, 500),
    factions: factions.list,
    locations: locations.list,
    hooks: hooks.list,
    glossary: glossary.list,
    nameSeeds: { people: people.list, places: places.list },
  };
  return {
    draft: next,
    added: factions.added + locations.added + hooks.added + glossary.added + people.added + places.added,
  };
}
