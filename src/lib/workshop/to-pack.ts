import type { WorkshopBundle } from "@/lib/workshop/bundle";

// Compiling a workshop into a world pack, and saying plainly what does not
// travel.
//
// The plan's line was "a workshop that is only reskins can compile straight
// to a world pack". Building this found that the premise is half true, and
// the honest version is worth stating rather than papering over:
//
// A world pack is a PURE NAME MAPPING (docs/worlds.md, src/lib/worlds/
// types.ts). Its substance is the reskin tables: races, classes, spells,
// items and features renamed. A workshop holds none of those. Nothing in
// phases 1 to 8 produces a reskin, because a reskin is not a prep artefact,
// it is a translation table for the engine's own vocabulary. Adding an
// editor for one would be a new subsystem, which is exactly what risk 4 in
// the plan says not to do.
//
// So this compiles the OTHER half of a pack, which a workshop does produce
// in quantity and which is the tedious half to type by hand: the seeds and
// the flavour. Factions, places, hooks, a glossary, name seeds, the theme
// and the premise. The reskin tables come out empty, the refusals say so,
// and the result is a starting point a person finishes in a text editor
// rather than a finished pack pretending otherwise.
//
// Pure, and it takes a bundle rather than a database, so the same function
// serves the export path and the test.

// The pack schema's own limits, restated here so a compile that would fail
// worldPackSchema.parse gets truncated with a warning instead.
const FACTION_NAME_MAX = 60;
const FACTION_BLURB_MAX = 200;
const LOCATION_NAME_MAX = 60;
const LOCATION_BLURB_MAX = 200;
const HOOK_MAX = 240;
const GLOSSARY_TERM_MAX = 40;
const GLOSSARY_MEANING_MAX = 160;
const NAME_SEED_MAX = 40;
const SEEDS_PER_LIST = 40;

export type PackRefusal = {
  // The pack field that came out empty or short.
  field: string;
  reason: string;
};

export type CompiledPack = {
  // Not a WorldPack: it is a DRAFT of one, missing the reskin tables and the
  // franchise metadata a person has to choose. Typed loosely on purpose, so
  // nothing here can be mistaken for something worldPackSchema has accepted.
  draft: Record<string, unknown>;
  refusals: PackRefusal[];
  warnings: string[];
  // How many rows of real content the draft carries. Zero means the compile
  // produced nothing worth downloading, which the UI says rather than
  // handing over an empty file.
  filled: number;
};

// The result is never longer than `max`, ellipsis included. Getting that
// wrong is not cosmetic: these limits are worldPackSchema's own, and a
// "clipped" string two characters over the line fails the parse of the very
// file this function exists to make parseable.
function clip(text: string, max: number): string {
  const trimmed = (text ?? "").replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

// A pack id is also a filename stem, and its regex is the only thing between
// a downloaded manifest and an arbitrary write path (src/lib/worlds/types.ts
// says so in its own comment). So this derives a SAFE id and falls back to a
// fixed one rather than ever emitting something that might not match.
export function packIdFrom(name: string): string {
  const slug = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 50);
  return /^[a-z][a-z0-9_]{2,49}$/.test(slug) ? slug : "my_world";
}

export function compileToPack(bundle: WorkshopBundle): CompiledPack {
  const refusals: PackRefusal[] = [];
  const warnings: string[] = [];

  // Factions come from the lore category of the same name. Everything else
  // in lore becomes a glossary line where it fits.
  const factionEntries = bundle.lore.filter((entry) => entry.category === "factions");
  const factions = factionEntries.map((entry) => ({
    name: clip(entry.title, FACTION_NAME_MAX),
    blurb: clip(entry.body, FACTION_BLURB_MAX),
  }));

  const glossary = bundle.lore
    .filter((entry) => entry.category !== "factions")
    .map((entry) => ({
      term: clip(entry.title, GLOSSARY_TERM_MAX),
      meaning: clip(entry.body, GLOSSARY_MEANING_MAX),
    }))
    .filter((entry) => entry.term && entry.meaning);

  const locations = bundle.locations.map((location) => ({
    name: clip(location.name, LOCATION_NAME_MAX),
    blurb: clip(location.layoutDescription, LOCATION_BLURB_MAX),
  }));

  // Hooks are the storyboard's hook cards, which is the one beat kind that
  // means exactly what a pack's `hooks` field means.
  const hooks = bundle.storyboard
    .filter((beat) => beat.kind === "hook")
    .map((beat) => clip(`${beat.title}. ${beat.body}`, HOOK_MAX))
    .filter(Boolean);

  const people = bundle.npcs
    .map((npc) => clip(npc.name, NAME_SEED_MAX))
    .filter(Boolean)
    .slice(0, SEEDS_PER_LIST);
  const places = bundle.locations
    .map((location) => clip(location.name, NAME_SEED_MAX))
    .filter(Boolean)
    .slice(0, SEEDS_PER_LIST);

  // ---- what did not travel ----

  // The big one, stated first because it is the difference between this
  // draft and a finished pack.
  refusals.push({
    field: "races, classes, backgrounds, spells, items, features",
    reason:
      "A pack's reskin tables rename what the engine already has. A workshop holds no reskins, so these come out empty and are yours to write.",
  });

  if (bundle.monsters.length) {
    refusals.push({
      field: "monsters",
      reason: `${bundle.monsters.length} hand-built monster${bundle.monsters.length === 1 ? "" : "s"} stayed behind. A pack's monster list overlays a name onto an existing SRD stat block by slug, and a monster built from scratch has no slug to overlay.`,
    });
  }
  if (bundle.encounters.length || bundle.maps.length || bundle.tables.length) {
    refusals.push({
      field: "encounters, maps, roll tables",
      reason:
        "A world pack is a setting, not a scenario. Prepared fights, maps and tables stay in the workshop bundle, which is the format that carries them.",
    });
  }
  if (!factionEntries.length) {
    refusals.push({
      field: "factions",
      reason: 'No lore entries are filed under "factions", so the pack has none.',
    });
  }

  if (bundle.lore.some((entry) => entry.body.length > GLOSSARY_MEANING_MAX)) {
    warnings.push(
      `Some lore was longer than a pack line allows and was clipped to ${GLOSSARY_MEANING_MAX} characters. Read the glossary before you publish it.`,
    );
  }
  if (bundle.npcs.length > SEEDS_PER_LIST) {
    warnings.push(`Only the first ${SEEDS_PER_LIST} NPC names became name seeds.`);
  }
  if (!bundle.manifest.rightsHolder.trim()) {
    warnings.push(
      "No rights holder is set, so this compiles as an original world. If it is built on somebody else's setting, fill that in before sharing it.",
    );
  }

  const draft = {
    id: packIdFrom(bundle.manifest.name),
    name: bundle.manifest.name,
    blurb: bundle.manifest.blurb,
    version: bundle.manifest.version,
    author: bundle.manifest.author,
    homepage: bundle.manifest.homepage,
    inspiredBy: bundle.manifest.inspiredBy,
    rightsHolder: bundle.manifest.rightsHolder,
    // A franchise is a grouping choice, not something a workshop knows. It
    // defaults to the pack's own name, which renders as a single button.
    franchise: clip(bundle.manifest.name, 60) || "My world",
    edition: "",
    editionOrder: 0,
    baseGenre: bundle.genre,
    dmFlavor: "",
    mapStyle: "",
    portraitStyle: "",
    nameHints: "",
    raceHint: "",
    companionRaces: [],
    theme: clip(bundle.theme || bundle.manifest.name, 120),
    premise: clip(bundle.premise || bundle.manifest.blurb, 500),
    races: [],
    classes: [],
    backgrounds: [],
    spells: [],
    items: [],
    features: [],
    monsters: [],
    alignments: [],
    nameSeeds: { people, places },
    factions,
    locations,
    hooks,
    glossary,
  };

  return {
    draft,
    refusals,
    warnings,
    filled: factions.length + locations.length + hooks.length + glossary.length,
  };
}
