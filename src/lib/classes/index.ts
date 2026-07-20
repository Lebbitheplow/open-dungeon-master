// Original setting-specific classes layered on top of the SRD twelve. Each
// genre ships a definitions file (class stats) and a features file (level
// tables with one-line rules text). Definitions merge into findClass and the
// builder; feature names merge into the SRD grant tables; the rules text
// feeds the DM prompt so the model knows what a custom feature does.
// Import only types from @/lib/srd here: srd/index.ts imports our values,
// and a value import back would create a require cycle.
import type { Genre } from "@/lib/schemas/game-settings";
import type { SrdClass } from "@/lib/srd";
import cyberpunkJson from "@/lib/classes/cyberpunk.json";
import cyberpunkFeaturesJson from "@/lib/classes/cyberpunk-features.json";
import darkFantasyJson from "@/lib/classes/dark-fantasy.json";
import darkFantasyFeaturesJson from "@/lib/classes/dark-fantasy-features.json";
import horrorJson from "@/lib/classes/horror.json";
import horrorFeaturesJson from "@/lib/classes/horror-features.json";
import mysteryJson from "@/lib/classes/mystery.json";
import mysteryFeaturesJson from "@/lib/classes/mystery-features.json";
import postApocalypticJson from "@/lib/classes/post-apocalyptic.json";
import postApocalypticFeaturesJson from "@/lib/classes/post-apocalyptic-features.json";
import steampunkJson from "@/lib/classes/steampunk.json";
import steampunkFeaturesJson from "@/lib/classes/steampunk-features.json";

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

type RawFeature = { n: string; d: string };
type RawFeatureTable = {
  subclassLevel: number;
  levels: Record<string, RawFeature[]>;
  subclass: { name: string; levels: Record<string, RawFeature[]> };
};

// Same shape features.ts uses for the SRD tables (names only).
export type CustomFeatureTable = {
  subclassLevel: number;
  levels: Record<string, string[]>;
  subclass: { name: string; levels: Record<string, string[]> };
};

type DefinitionsFile = { classes: CustomClass[] };
type FeaturesFile = { classes: Record<string, RawFeatureTable> };

const DEFINITION_FILES = [
  cyberpunkJson,
  darkFantasyJson,
  horrorJson,
  mysteryJson,
  postApocalypticJson,
  steampunkJson,
] as unknown as DefinitionsFile[];
const FEATURE_FILES = [
  cyberpunkFeaturesJson,
  darkFantasyFeaturesJson,
  horrorFeaturesJson,
  mysteryFeaturesJson,
  postApocalypticFeaturesJson,
  steampunkFeaturesJson,
] as unknown as FeaturesFile[];

export const CUSTOM_CLASSES: CustomClass[] = DEFINITION_FILES.flatMap(
  (file) => file.classes,
);

const stripNames = (levels: Record<string, RawFeature[]>) =>
  Object.fromEntries(
    Object.entries(levels).map(([level, features]) => [
      level,
      features.map((feature) => feature.n),
    ]),
  );

// Names-only tables for features.ts, plus a per-class name -> rules-text map
// for the DM prompt, built in one pass over the raw files.
export const CUSTOM_CLASS_FEATURES: Record<string, CustomFeatureTable> = {};
const FEATURE_DESCRIPTIONS: Record<string, Record<string, string>> = {};

for (const file of FEATURE_FILES) {
  for (const [classId, table] of Object.entries(file.classes)) {
    CUSTOM_CLASS_FEATURES[classId] = {
      subclassLevel: table.subclassLevel,
      levels: stripNames(table.levels),
      subclass: {
        name: table.subclass.name,
        levels: stripNames(table.subclass.levels),
      },
    };
    const descriptions: Record<string, string> = {};
    for (const features of Object.values(table.levels)) {
      for (const feature of features) {
        descriptions[feature.n.toLowerCase()] = feature.d;
      }
    }
    for (const features of Object.values(table.subclass.levels)) {
      for (const feature of features) {
        descriptions[feature.n.toLowerCase()] = feature.d;
      }
    }
    FEATURE_DESCRIPTIONS[classId] = descriptions;
  }
}

export function findCustomClass(id: string): CustomClass | null {
  return CUSTOM_CLASSES.find((entry) => entry.id === id) ?? null;
}

// The class slug to use for spell-list searches and spell-count advice:
// custom casters borrow an SRD class's list, everything else passes through.
export function spellClassFor(classId: string): string {
  return findCustomClass(classId)?.spellListFrom ?? classId;
}

// Rules text for a custom class feature, or null (SRD feature names need no
// gloss; the model knows them).
export function classFeatureDescription(
  classId: string,
  featureName: string,
): string | null {
  return FEATURE_DESCRIPTIONS[classId]?.[featureName.trim().toLowerCase()] ?? null;
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

// Class ids that belong in a genre's world, the same rule the character
// builder applies to its picker: high fantasy and custom worlds take the
// whole catalog (empty list = no restriction), every other genre takes only
// its tagged classes. Used to keep AI companions in setting.
export function genreClassIds(genre: Genre): string[] {
  if (genre === "high_fantasy" || genre === "custom") {
    return [];
  }
  const custom = CUSTOM_CLASSES.filter((entry) => entry.genres.includes(genre)).map(
    (entry) => entry.id,
  );
  const srd = Object.entries(SRD_GENRE_TAGS)
    .filter(([, genres]) => genres.includes(genre))
    .map(([classId]) => classId);
  return [...custom, ...srd];
}
