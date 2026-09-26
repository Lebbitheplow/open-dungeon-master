import classFeaturesJson from "@/lib/srd/class-features.json";
import subclassesJson from "@/lib/srd/subclasses.json";
import racesJson from "@/lib/srd/races.json";
import { CUSTOM_CLASS_FEATURES } from "@/lib/classes";
import type { SheetFeature } from "@/lib/schemas/sheet";
import { chosenFightingStyles, fightingStyleSlots } from "@/lib/srd/feature-effects";
import { findOptionByFeatureName, optionSlotsFor } from "@/lib/srd/options";

export type SubclassTable = {
  name: string;
  // One line for the pickers; the authored entries carry theirs in desc too.
  desc?: string;
  // Other names a sheet may already hold for this subclass: content-pack
  // slugs and the shorthand players type ("Moon", "Land").
  aliases?: string[];
  levels: Record<string, string[]>;
  // Always-prepared spells the subclass hands out, keyed by the class level
  // they arrive at (domain, circle, oath, patron and Arcanum lists). They do
  // not count against a caster's known/prepared ceiling.
  spells?: Record<string, string[]>;
};

type ClassFeatureTable = {
  subclassLevel: number;
  levels: Record<string, string[]>;
  subclasses: SubclassTable[];
};

// subclasses.json stores each feature as { n: name, d: rules text }, the same
// shape the genre-class catalog uses, so the DM prompt can gloss a feature
// the model may not know. features.ts wants names only, so the text is split
// off into SUBCLASS_FEATURE_TEXT on load.
type RawSubclass = Omit<SubclassTable, "levels"> & {
  desc: string;
  levels: Record<string, Array<{ n: string; d: string }>>;
};

// Keyed by subclass as well as class: "Divine Strike" is a different damage
// type in every cleric domain, so a class-wide key would hand the model the
// last domain's text for all of them.
const SUBCLASS_FEATURE_TEXT: Record<string, string> = {};

function textKey(classId: string, subclassName: string, featureName: string) {
  return `${classId}::${subclassName.trim().toLowerCase()}::${featureName.trim().toLowerCase()}`;
}

// The SRD table carries each class's base levels and its one SRD subclass;
// subclasses.json adds the rest of the option space, written in our own
// words. Both halves are merged here so every helper below sees one list.
const AUTHORED_SUBCLASSES: Record<string, SubclassTable[]> = Object.fromEntries(
  Object.entries((subclassesJson as { classes: Record<string, RawSubclass[]> }).classes).map(
    ([classId, entries]) => [
      classId,
      entries.map((entry) => {
        const levels: Record<string, string[]> = {};
        for (const [level, features] of Object.entries(entry.levels)) {
          levels[level] = features.map((feature) => feature.n);
          for (const feature of features) {
            SUBCLASS_FEATURE_TEXT[textKey(classId, entry.name, feature.n)] = feature.d;
          }
        }
        return {
          name: entry.name,
          ...(entry.aliases ? { aliases: entry.aliases } : {}),
          levels,
          ...(entry.spells ? { spells: entry.spells } : {}),
        };
      }),
    ],
  ),
);

// The one-line pitch for a subclass, for the pickers and the level-up
// dialog: the SRD table's own line or the authored entry's. Null for a
// subclass only the content pack knows, whose row carries its own text.
export function subclassBlurb(classId: string, subclass: string): string | null {
  const wanted = subclass.trim().toLowerCase();
  const srd = SRD_CLASS_FEATURES[classId]?.subclasses.find(
    (entry) => entry.name.toLowerCase() === wanted && entry.desc,
  );
  if (srd?.desc) {
    return srd.desc;
  }
  const authored = AUTHORED_SUBCLASS_ENTRIES[classId]?.find(
    (entry) => entry.name.toLowerCase() === wanted || (entry.aliases ?? []).some((alias) => alias.toLowerCase() === wanted),
  );
  return authored?.desc ?? null;
}

// One line of rules text for a subclass feature, or null when the name is a
// bare SRD one the model already knows. The DM prompt appends it so a
// non-SRD feature is never an opaque token on the sheet. The stored subclass
// string is resolved the same loose way features are granted, so a sheet
// holding a pack slug still finds its text.
export function subclassFeatureDescription(
  classId: string,
  subclass: string,
  featureName: string,
): string | null {
  const table = CLASS_FEATURES[classId];
  const chosen = table ? findSubclass(table, subclass) : null;
  if (!chosen) {
    return null;
  }
  return SUBCLASS_FEATURE_TEXT[textKey(classId, chosen.name, featureName)] ?? null;
}

// The player-facing blurb for each authored subclass, for the pickers and
// the content-pack importer that publishes them as archetype rows.
export const AUTHORED_SUBCLASS_ENTRIES = (
  subclassesJson as { classes: Record<string, RawSubclass[]> }
).classes;

const SRD_CLASS_FEATURES = Object.fromEntries(
  Object.entries(
    (classFeaturesJson as unknown as { classes: Record<string, ClassFeatureTable> }).classes,
  ).map(([classId, table]) => [
    classId,
    { ...table, subclasses: [...table.subclasses, ...(AUTHORED_SUBCLASSES[classId] ?? [])] },
  ]),
);

// SRD tables plus the custom-class catalog; ids never collide, so every
// grant helper below works for both without call-site changes.
const CLASS_FEATURES: Record<string, ClassFeatureTable> = {
  ...SRD_CLASS_FEATURES,
  ...CUSTOM_CLASS_FEATURES,
};

function clampLevel(level: number) {
  return Math.max(1, Math.min(20, Math.floor(level)));
}

// The character level at which a class picks its subclass; null for classes
// outside the SRD table (custom/homebrew classes).
export function subclassLevelFor(classId: string): number | null {
  return CLASS_FEATURES[classId]?.subclassLevel ?? null;
}

// SRD expertise grants: levels at which a class doubles proficiency in two
// skills. Rogues at 1 and 6, bards at 3 and 10.
const EXPERTISE_GRANTS: Record<string, number[]> = {
  rogue: [1, 6],
  bard: [3, 10],
};

// Total expertise picks a class has earned by `level` (2 per grant level).
export function expertiseSlotsFor(classId: string, level: number): number {
  const grants = EXPERTISE_GRANTS[classId] ?? [];
  return grants.filter((grantLevel) => grantLevel <= clampLevel(level)).length * 2;
}

// Every subclass this class can take, in table order (the SRD one first).
// Empty for unknown classes. The character builder and the level-up dialog
// merge these with whatever the content pack offers.
export function subclassNamesFor(classId: string): string[] {
  return (CLASS_FEATURES[classId]?.subclasses ?? []).map((entry) => entry.name);
}

function leveledNames(levels: Record<string, string[]>, level: number): SheetFeature[] {
  const granted: SheetFeature[] = [];
  for (const [levelKey, names] of Object.entries(levels)) {
    const grantLevel = Number(levelKey);
    if (grantLevel <= level) {
      for (const name of names) {
        granted.push({ name, source: "class", level: grantLevel });
      }
    }
  }
  return granted.sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
}

const normalizeName = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

// Loose name match: sheets store subclasses as free text and content packs
// use their own slugs, so "Evocation" must still hit "School of Evocation".
function subclassMatches(stored: string, srdName: string): boolean {
  const a = normalizeName(stored);
  const b = normalizeName(srdName);
  if (!a || a.length < 4) {
    return a === b;
  }
  return a === b || a.includes(b) || b.includes(a);
}

// The subclass a sheet's free-text string means, or null. With eight or more
// subclasses per class the loose match alone is ambiguous ("Land" is inside
// "Circle of the Land" but so is "the Land" inside other prose), so exact
// name and alias matches are tried across the whole list before any of them
// is allowed to match loosely.
function findSubclass(table: ClassFeatureTable, stored: string): SubclassTable | null {
  const wanted = normalizeName(stored);
  if (!wanted) {
    return null;
  }
  const exact = table.subclasses.find(
    (entry) =>
      normalizeName(entry.name) === wanted ||
      (entry.aliases ?? []).some((alias) => normalizeName(alias) === wanted),
  );
  if (exact) {
    return exact;
  }
  return (
    table.subclasses.find(
      (entry) =>
        subclassMatches(stored, entry.name) ||
        (entry.aliases ?? []).some((alias) => subclassMatches(stored, alias)),
    ) ?? null
  );
}

// Base-class features up to `level`, plus the features of whichever subclass
// the stored string names. A subclass we have no table for (content-pack
// prose, homebrew) still gets the base-class features.
export function classFeaturesFor(classId: string, subclass: string, level: number): SheetFeature[] {
  const table = CLASS_FEATURES[classId];
  if (!table) {
    return [];
  }
  const clamped = clampLevel(level);
  const granted = leveledNames(table.levels, clamped);
  const chosen = findSubclass(table, subclass);
  if (chosen) {
    granted.push(...leveledNames(chosen.levels, clamped));
  }
  return granted.sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
}

// The always-prepared spells a subclass has granted by `level`: domain,
// circle, oath and patron lists. Callers add these to the sheet's prepared
// list; they are free and never count against the known/prepared ceiling.
export function subclassSpellsFor(classId: string, subclass: string, level: number): string[] {
  const table = CLASS_FEATURES[classId];
  if (!table) {
    return [];
  }
  const chosen = findSubclass(table, subclass);
  if (!chosen?.spells) {
    return [];
  }
  const clamped = clampLevel(level);
  const granted: string[] = [];
  for (const [levelKey, spells] of Object.entries(chosen.spells)) {
    if (Number(levelKey) <= clamped) {
      granted.push(...spells);
    }
  }
  return [...new Set(granted)];
}

const RACES = (racesJson as { races: Array<{ id: string; traits: string[] }> }).races;

// Race ids arrive as SRD ids (half_elf), content-pack slugs (half-elf) or
// the pack's own copies of the bundled rows (odm-half-elf); all three find
// the bundled traits.
function normalizeRaceId(raceId: string) {
  return raceId.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^odm_/, "");
}

export function racialTraitsFor(raceId: string): SheetFeature[] {
  const wanted = normalizeRaceId(raceId);
  const race = RACES.find((entry) => entry.id === wanted);
  if (!race) {
    return [];
  }
  return race.traits.map((name) => ({ name, source: "race" as const }));
}

// Recompute the auto-granted class and race entries from SRD data while
// keeping everything the table added by hand or story, the background
// feature granted at creation, and the player's own class picks
// ("feat", "choice", "story" and "background" sources).
// Deduped by lowercased name; the SRD grant wins ties so regrants stay
// idempotent across level-ups and re-instantiation at a new level.
// Multiclass: each class grants at ITS OWN level and tags its features with
// classId so level-scaled mechanics (Sneak Attack dice, Martial Arts die)
// resolve against the granting class. Duplicate names collapse to the first
// class in acquisition order, which is how one Extra Attack and one
// Unarmored Defense survive a barbarian/monk.
export function populateFeaturesForClasses(
  existing: SheetFeature[],
  classes: Array<{ id: string; subclass: string; level: number }>,
  raceId: string,
): SheetFeature[] {
  const granted: SheetFeature[] = [];
  for (const entry of classes) {
    granted.push(
      ...classFeaturesFor(entry.id, entry.subclass, entry.level).map((feature) => ({
        ...feature,
        classId: entry.id,
      })),
    );
  }
  granted.push(...racialTraitsFor(raceId));
  const grantedNames = new Set(granted.map((feature) => feature.name.toLowerCase()));
  const kept = pruneChoiceFeatures(
    existing.filter(
      (feature) =>
        (feature.source === "feat" ||
          feature.source === "story" ||
          feature.source === "choice" ||
          feature.source === "background") &&
        !grantedNames.has(feature.name.toLowerCase()),
    ),
    classes,
    granted,
  );
  const seen = new Set<string>();
  return [...granted, ...kept].filter((feature) => {
    const key = feature.name.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// A "choice" feature is the player's own pick from a list a class feature
// opens: a fighting style, an invocation, a maneuver. It stays only while
// some class on the sheet still opens that list at its level, and only as
// many as the list allows. Without this a Battle Master's maneuvers rode
// along under a Champion for good, and a warlock adapted down to level 1
// kept invocations it had not earned. Story, feat and background features
// are not touched.
function pruneChoiceFeatures(
  features: SheetFeature[],
  classes: Array<{ id: string; subclass: string; level: number }>,
  granted: SheetFeature[],
): SheetFeature[] {
  const styleSlots = fightingStyleSlots(granted);
  const styles = new Set(chosenFightingStyles(features).map((name) => name.toLowerCase()));
  let stylesKept = 0;
  const perKind = new Map<string, number>();
  return features.filter((feature) => {
    if (feature.source !== "choice") {
      return true;
    }
    const option = findOptionByFeatureName(feature.name);
    if (option) {
      const total = classes.reduce(
        (sum, entry) => sum + optionSlotsFor(entry.id, entry.subclass, entry.level, option.k),
        0,
      );
      const taken = perKind.get(option.k) ?? 0;
      if (taken >= total) {
        return false;
      }
      perKind.set(option.k, taken + 1);
      return true;
    }
    const bare = chosenFightingStyles([feature])[0];
    if (bare !== undefined && styles.has(bare.toLowerCase())) {
      if (stylesKept >= styleSlots) {
        return false;
      }
      stylesKept += 1;
      return true;
    }
    return true;
  });
}

// Single-class shape, kept so the many existing call sites stay unchanged;
// delegates to the class-list grant above.
export function populateFeatures(
  existing: SheetFeature[],
  classId: string,
  subclass: string,
  raceId: string,
  level: number,
): SheetFeature[] {
  return populateFeaturesForClasses(existing, [{ id: classId, subclass, level }], raceId);
}
