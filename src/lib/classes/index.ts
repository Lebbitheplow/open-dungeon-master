// Original setting-specific classes layered on top of the SRD twelve. Each
// genre ships a definitions file (class stats) and a features file (level
// tables with one-line rules text). Definitions merge into findClass and the
// builder; feature names merge into the SRD grant tables, read from
// feature-names.json (generated from the features files by
// scripts/build-feature-names.mjs) so no page's first load carries the rules
// text; the text feeds the DM prompt and the sheet's feature help through
// feature-text.ts, fetched only when asked for (issue 411).
// Import only types from @/lib/srd here: srd/index.ts imports our values,
// and a value import back would create a require cycle.
import type { Genre } from "@/lib/schemas/game-settings";
import type { SrdClass } from "@/lib/srd";
import cyberpunkJson from "@/lib/classes/cyberpunk.json";
import darkFantasyJson from "@/lib/classes/dark-fantasy.json";
import horrorJson from "@/lib/classes/horror.json";
import mysteryJson from "@/lib/classes/mystery.json";
import postApocalypticJson from "@/lib/classes/post-apocalyptic.json";
import steampunkJson from "@/lib/classes/steampunk.json";
import featureNamesJson from "@/lib/classes/feature-names.json";
// The SRD's own table, as data: srd/index.ts imports this module's values,
// so the ids are read from the JSON rather than from it.
import srdClassesJson from "@/lib/srd/classes.json";

export { classFeatureDescription } from "@/lib/classes/feature-text";
import { workshopClassDef } from "@/lib/classes/workshop-registry";

export type CustomClass = SrdClass & {
  // Genres that surface this class in the picker's recommended group.
  genres: Genre[];
  // One-line pitch, shown under the class select and in the DM primer.
  blurb: string;
  // SRD class id whose spell list this class borrows, or null for
  // non-casters. Custom ids never match Open5e spell lists, so spell
  // searches and advice go through spellClassFor().
  spellListFrom: string | null;
  knownCaster: boolean;
  // Flavor label for what this class calls its spells ("Programs").
  castingLabel: string | null;
};

// The generated names table: per class, the catalog it came from and its
// levels, names only.
type NamesTable = {
  file: string;
  subclassLevel: number;
  levels: Record<string, string[]>;
  subclass: { name: string; levels: Record<string, string[]> };
};

// Same shape features.ts uses for the SRD tables (names only). Genre classes
// ship exactly one subclass each, so it is wrapped into the list features.ts
// expects rather than changing the six catalog files.
export type CustomFeatureTable = {
  subclassLevel: number;
  levels: Record<string, string[]>;
  subclasses: Array<{ name: string; levels: Record<string, string[]> }>;
};

type DefinitionsFile = { classes: CustomClass[] };

const DEFINITION_FILES = [
  cyberpunkJson,
  darkFantasyJson,
  horrorJson,
  mysteryJson,
  postApocalypticJson,
  steampunkJson,
] as unknown as DefinitionsFile[];

export const CUSTOM_CLASSES: CustomClass[] = DEFINITION_FILES.flatMap(
  (file) => file.classes,
);

// Names-only tables for features.ts.
export const CUSTOM_CLASS_FEATURES: Record<string, CustomFeatureTable> = Object.fromEntries(
  Object.entries((featureNamesJson as { classes: Record<string, NamesTable> }).classes).map(([classId, table]) => [
    classId,
    {
      subclassLevel: table.subclassLevel,
      levels: table.levels,
      subclasses: [{ name: table.subclass.name, levels: table.subclass.levels }],
    },
  ]),
);

// A setting class, or one made in the workshop (src/lib/classes/workshop-registry.ts).
export function findCustomClass(id: string): CustomClass | null {
  return CUSTOM_CLASSES.find((entry) => entry.id === id) ?? workshopClassDef(id)?.klass ?? null;
}

// The class slug to use for spell-list searches and spell-count advice:
// custom casters borrow an SRD class's list, everything else passes through.
export function spellClassFor(classId: string): string {
  return findCustomClass(classId)?.spellListFrom ?? classId;
}

// SRD classes that also deserve a spot in a genre's recommended group.
export const SRD_GENRE_TAGS: Record<string, Genre[]> = {
  barbarian: ["post_apocalyptic"],
  bard: ["mystery"],
  cleric: ["horror"],
  druid: ["post_apocalyptic"],
  fighter: ["steampunk"],
  paladin: ["dark_fantasy"],
  ranger: ["post_apocalyptic"],
  rogue: ["mystery", "cyberpunk"],
  warlock: ["dark_fantasy", "horror"],
  wizard: ["steampunk"],
};

// Single lookup the picker uses for both custom and SRD classes.
export function classGenres(classId: string): Genre[] {
  return findCustomClass(classId)?.genres ?? SRD_GENRE_TAGS[classId] ?? [];
}

// The same question as genreClassIds, asked for a campaign that may have a
// world pack selected. A pack names the callings that exist in its world, and
// that list is both narrower and truer than the genre tags, so it wins. The
// pack ids arrive as a PARAMETER rather than by importing the pack loader,
// which keeps this module free of fs and safe for the character builder to
// import on the client. One rule for every place a class is offered or
// drafted: AI companions, the level-up dialog's list, an agent's level-up
// options (issues #433, #434). Empty: the whole catalog.
export function settingClassIds(genre: Genre, packClassIds: string[]): string[] {
  return packClassIds.length ? packClassIds : genreClassIds(genre);
}

// Genres whose classes a high fantasy world takes beside the SRD's: a witch
// hunter or a grave knight fits a world of swords and spells, a netrunner or
// a steam knight does not (issue #434).
const HIGH_FANTASY_KIN: Genre[] = ["dark_fantasy"];

// Class ids that belong in a genre's world. A custom world takes the whole
// catalog (empty list = no restriction); high fantasy takes the SRD classes
// and its kin's; every other genre takes its tagged classes.
export function genreClassIds(genre: Genre): string[] {
  if (genre === "custom") {
    return [];
  }
  if (genre === "high_fantasy") {
    return [
      ...(srdClassesJson as { classes: Array<{ id: string }> }).classes.map((entry) => entry.id),
      ...CUSTOM_CLASSES.filter((entry) => entry.genres.some((tag) => HIGH_FANTASY_KIN.includes(tag))).map(
        (entry) => entry.id,
      ),
    ];
  }
  const custom = CUSTOM_CLASSES.filter((entry) => entry.genres.includes(genre)).map(
    (entry) => entry.id,
  );
  const srd = Object.entries(SRD_GENRE_TAGS)
    .filter(([, genres]) => genres.includes(genre))
    .map(([classId]) => classId);
  return [...custom, ...srd];
}

// A list of classes split into the ones the campaign's setting offers
// (settingClassIds) and the rest, each in its given order. With no setting
// list (a custom world) every class is the setting's. The level-up dialog
// shows the first and folds the second under "Other settings" (issue #433).
export function splitBySetting<T extends { id: string }>(
  entries: readonly T[],
  settingIds: readonly string[],
): { setting: T[]; other: T[] } {
  if (!settingIds.length) {
    return { setting: [...entries], other: [] };
  }
  const offered = new Set(settingIds);
  return {
    setting: entries.filter((entry) => offered.has(entry.id)),
    other: entries.filter((entry) => !offered.has(entry.id)),
  };
}
