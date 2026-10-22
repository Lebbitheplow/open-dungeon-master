import { ancestryOf, takesDraconicAncestry } from "@/lib/srd/racial-grants";
import classFeaturesJson from "@/lib/srd/class-features.json";
import subclassesJson from "@/lib/srd/subclasses.json";
import racesJson from "@/lib/srd/races.json";
import classesJson from "@/lib/srd/classes.json";
import { CUSTOM_CLASS_FEATURES, findCustomClass } from "@/lib/classes";
import { workshopClassDef } from "@/lib/classes/workshop-registry";
import type { SheetFeature } from "@/lib/schemas/sheet";
import { chosenFightingStyles, fightingStyleChoices, fightingStyleSlots } from "@/lib/srd/feature-effects";
import { findOptionByFeatureName, isOptionName, optionSlotsFor } from "@/lib/srd/options";
import { featOptionSlots } from "@/lib/srd/feat-combat";
import { srdRaceId } from "@/lib/srd/race-id";
import { subclassNamedBare, subclassNamedExactly } from "@/lib/srd/subclass-name";
import { browserSubclassExtras, type SubclassExtras } from "@/lib/srd/subclass-tables";
import { thirdCasterProfileOf, type ThirdCasterProfile } from "@/lib/srd/third-caster";
import { textKey } from "@/lib/language/text-logic";

export type SubclassTable = {
  name: string;
  // One line for the pickers; the authored entries carry theirs in desc too.
  desc?: string;
  // Other names a sheet may already hold for this subclass: content-pack
  // slugs and the shorthand players type ("Moon", "Land").
  aliases?: string[];
  levels: Record<string, string[]>;
  // Always-prepared spells the subclass hands out, keyed by the class level
  // they arrive at (domain, circle and oath lists, a learned cantrip). They do
  // not count against a caster's known/prepared ceiling.
  spells?: Record<string, string[]>;
  // A warlock patron's expanded list: added to the spells the class may
  // learn from that level, never granted (SRD 5.1, The Fiend; the Sage
  // Advice Compendium). Learned, they count against spells known.
  expanded?: Record<string, string[]>;
  // Spells that hang off the option chosen for one of the subclass's
  // features ("Circle Spells (Forest)", "Genie's Vessel (Efreeti)"), free or
  // expanded as `expanded` says.
  choiceSpells?: ChoiceSpells;
  // Other classes' lists the subclass may learn from (Divine Soul: cleric).
  spellLists?: string[];
};

export type ChoiceSpells = {
  feature: string;
  expanded?: boolean;
  options: Record<string, Record<string, string[]>>;
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

function subclassTextKey(classId: string, subclassName: string, featureName: string) {
  return `${classId}::${textKey(subclassName)}::${textKey(featureName)}`;
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
            SUBCLASS_FEATURE_TEXT[subclassTextKey(classId, entry.name, feature.n)] = feature.d;
          }
        }
        return {
          name: entry.name,
          ...(entry.aliases ? { aliases: entry.aliases } : {}),
          levels,
          ...(entry.spells ? { spells: entry.spells } : {}),
          ...(entry.expanded ? { expanded: entry.expanded } : {}),
          ...(entry.choiceSpells ? { choiceSpells: entry.choiceSpells } : {}),
          ...(entry.spellLists ? { spellLists: entry.spellLists } : {}),
        };
      }),
    ],
  ),
);

// The one-line pitch for a subclass, for the pickers and the level-up
// dialog: the SRD table's own line or the authored entry's. Null for a
// subclass only the content pack knows, whose row carries its own text.
export function subclassBlurb(classId: string, subclass: string): string | null {
  const wanted = textKey(subclass);
  const srd = SRD_CLASS_FEATURES[classId]?.subclasses.find(
    (entry) => textKey(entry.name) === wanted && entry.desc,
  );
  if (srd?.desc) {
    return srd.desc;
  }
  const authored = AUTHORED_SUBCLASS_ENTRIES[classId]?.find(
    (entry) => textKey(entry.name) === wanted || (entry.aliases ?? []).some((alias) => textKey(alias) === wanted),
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
  extras?: SubclassExtras,
): string | null {
  const table = featureTableOf(classId);
  const chosen = table ? findSubclass(table, subclass) : null;
  if (!chosen) {
    // A workshop or pack subclass carries its features' own text.
    const extra = extraSubclassNamed(classId, subclass, extras);
    const wanted = textKey(featureName);
    for (const rows of Object.values(extra?.levels ?? {})) {
      const row = rows.find((entry) => textKey(entry.n) === wanted);
      if (row?.d) {
        return row.d;
      }
    }
    return null;
  }
  return SUBCLASS_FEATURE_TEXT[subclassTextKey(classId, chosen.name, featureName)] ?? null;
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

// A class's table: the bundled or setting one, or a workshop class's,
// registered at run time (src/lib/classes/index.ts registerWorkshopClasses).
function featureTableOf(classId: string): ClassFeatureTable | undefined {
  return CLASS_FEATURES[classId] ?? workshopClassDef(classId)?.features;
}

function clampLevel(level: number) {
  return Math.max(1, Math.min(20, Math.floor(level)));
}

// The character level at which a class picks its subclass; null for classes
// outside the SRD table (custom/homebrew classes).
export function subclassLevelFor(classId: string): number | null {
  return featureTableOf(classId)?.subclassLevel ?? null;
}

// Whether a class may pick its subclass at this level: `locked` with the
// level it unlocks at while it may not. The builder's picker, the pack-only
// archetypes included, waits on this: a pick made early is one the sheet
// rules drop (sheet-legality subclassesOf), so offering it was a menu whose
// choices vanished (issue #109). A class outside the tables (homebrew) has
// no pick level and is never locked.
export function subclassGate(classId: string, level: number): { pickLevel: number | null; locked: boolean } {
  const pickLevel = subclassLevelFor(classId);
  return { pickLevel, locked: pickLevel !== null && level < pickLevel };
}

// SRD expertise grants: levels at which a class doubles proficiency in two
// skills. Rogues at 1 and 6, bards at 3 and 10.
const EXPERTISE_GRANTS: Record<string, number[]> = {
  rogue: [1, 6],
  bard: [3, 10],
};

// A rogue's Expertise may take thieves' tools in place of a skill (SRD 5.1,
// Rogue: "two of your skill proficiencies, or one of your skill
// proficiencies and your proficiency with thieves' tools").
export const THIEVES_TOOLS = "thieves' tools";
export function isThievesTools(name: string): boolean {
  return /^thieves['’]?\s*tools?$/i.test(name.trim());
}

// Whether an expertise pick doubles a proficiency the character may take it
// in: one of their skills, or thieves' tools for a rogue.
export function expertiseAllowed(pick: string, skills: string[], classIds: string[]): boolean {
  const wanted = pick.trim().toLowerCase();
  return skills.some((skill) => skill.toLowerCase() === wanted) || (isThievesTools(pick) && classIds.some((id) => id.trim().toLowerCase() === "rogue"));
}

// Total expertise picks a class has earned by `level` (2 per grant level).
export function expertiseSlotsFor(classId: string, level: number): number {
  const grants = EXPERTISE_GRANTS[classId] ?? [];
  return grants.filter((grantLevel) => grantLevel <= clampLevel(level)).length * 2;
}

// Every subclass this class can take, in table order (the SRD one first).
// Empty for unknown classes. The character builder and the level-up dialog
// merge these with whatever the content pack offers.
export function subclassNamesFor(classId: string): string[] {
  return (featureTableOf(classId)?.subclasses ?? []).map((entry) => entry.name);
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

// The subclass a sheet's free-text string means, or null: the exact name, an
// alias, or either with its title stripped on both sides and compared
// whole. A string that is merely part of a name matches nothing, so a
// paladin whose subclass reads "Oath" is granted no oath's features.
// (The rule is src/lib/srd/subclass-name.ts, shared with options.ts.)
// Without extras of its own a caller reads the browser's registered ones
// (src/lib/srd/subclass-tables.ts registerBrowserSubclassExtras); the
// server always passes the table's own (src/lib/db/subclass-extras.ts).
export { registerBrowserSubclassExtras } from "@/lib/srd/subclass-tables";

function extraSubclassNamed(classId: string, stored: string, extras?: SubclassExtras) {
  const list = (extras ?? browserSubclassExtras())[classId] ?? [];
  return (
    list.find((entry) => subclassNamedExactly(stored, entry.name)) ??
    list.find((entry) => subclassNamedBare(stored, entry.name)) ??
    null
  );
}

// Whether a subclass of this class may bring its own Spellcasting: the
// classes that cast nothing themselves (barbarian, fighter, monk, rogue, and
// a genre class without a casting ability). A cleric's or a warlock's
// subclass adds to the class's own casting, never a second one.
export function subclassMayCast(classId: string): boolean {
  const custom = findCustomClass(classId);
  if (custom) {
    return custom.casterType === "none";
  }
  const srd = (classesJson as unknown as { classes: Array<{ id: string; casterType: string }> }).classes.find(
    (entry) => entry.id === classId,
  );
  return srd ? srd.casterType === "none" : false;
}

// The third-caster rules a workshop or pack subclass casts by, for a class
// that may bring its own (subclassMayCast); undefined for any other.
export function subclassCastingProfileFor(
  classId: string,
  stored: string,
  extras?: SubclassExtras,
): ThirdCasterProfile | undefined {
  if (!subclassMayCast(classId)) {
    return undefined;
  }
  // Read through the profile names, so a table built from older data
  // ("third-caster", the first spelling) answers with the class's own.
  return thirdCasterProfileOf(classId, "", extraSubclassNamed(classId, stored, extras)?.castingProfile) ?? undefined;
}

// A workshop or pack subclass as the bundled tables' shape: names by level.
function extraTableNamed(classId: string, stored: string, extras?: SubclassExtras): SubclassTable | null {
  const found = extraSubclassNamed(classId, stored, extras);
  if (!found) {
    return null;
  }
  return {
    name: found.name,
    levels: Object.fromEntries(Object.entries(found.levels).map(([level, rows]) => [level, rows.map((row) => row.n)])),
    ...(found.spells ? { spells: found.spells } : {}),
  };
}

function findSubclass(table: ClassFeatureTable, stored: string): SubclassTable | null {
  return (
    table.subclasses.find((entry) => subclassNamedExactly(stored, entry.name, entry.aliases)) ??
    table.subclasses.find((entry) => subclassNamedBare(stored, entry.name, entry.aliases)) ??
    null
  );
}

// The table's own name for a subclass a sheet names exactly, or by one of
// its aliases; null for anything else. The strict match: the level-up and
// the creation check ask it "is this one of the class's subclasses", where
// the loose match above would answer yes to half a name.
export function bundledSubclassName(classId: string, subclass: string): string | null {
  const table = featureTableOf(classId);
  const wanted = textKey(subclass);
  if (!table || !wanted) {
    return null;
  }
  const found = table.subclasses.find(
    (entry) =>
      textKey(entry.name) === wanted ||
      (entry.aliases ?? []).some((alias) => textKey(alias) === wanted),
  );
  return found?.name ?? null;
}

// Every feature name the bundled tables grant, at any level: base classes,
// their subclasses and the lineages' traits, plus the option picks. A name
// here is one the rules know, whoever holds it.
let publishedFeatureNames: Set<string> | null = null;
const featureKey = (name: string) => textKey(name.replace(/\s*\([^)]*\)\s*$/, ""));

export function isPublishedFeatureName(name: string): boolean {
  if (!publishedFeatureNames) {
    const names = Object.values(CLASS_FEATURES).flatMap((table) => [
      ...Object.values(table.levels).flat(),
      ...table.subclasses.flatMap((subclass) => Object.values(subclass.levels).flat()),
    ]);
    publishedFeatureNames = new Set([...names, ...RACES.flatMap((race) => race.traits)].map(featureKey));
  }
  return publishedFeatureNames.has(featureKey(name)) || isOptionName(name);
}

// Base-class features up to `level`, plus the features of whichever subclass
// the stored string names. A subclass we have no table for (content-pack
// prose, homebrew) still gets the base-class features.
export function classFeaturesFor(
  classId: string,
  subclass: string,
  level: number,
  // Subclasses the tables do not carry (src/lib/srd/subclass-tables.ts): the
  // table's workshop subclasses and the content pack's prose archetypes.
  extras?: SubclassExtras,
): SheetFeature[] {
  const table = featureTableOf(classId);
  if (!table) {
    return [];
  }
  const clamped = clampLevel(level);
  const granted = leveledNames(table.levels, clamped);
  const chosen = findSubclass(table, subclass) ?? extraTableNamed(classId, subclass, extras);
  if (chosen) {
    granted.push(...leveledNames(chosen.levels, clamped));
  }
  return granted.sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
}

// A bundled subclass's own table, for a workshop copy to start from: its
// feature names by level and its always-prepared spells. Null for a
// subclass the tables do not carry.
export function subclassTableFor(classId: string, stored: string): SubclassTable | null {
  const table = featureTableOf(classId);
  return table ? findSubclass(table, stored) : null;
}

function spellsBy(table: Record<string, string[]> | undefined, level: number): string[] {
  const out: string[] = [];
  for (const [levelKey, spells] of Object.entries(table ?? {})) {
    if (Number(levelKey) <= clampLevel(level)) {
      out.push(...spells);
    }
  }
  return out;
}

// The option a sheet chose for a feature: "Forest" of "Circle Spells
// (Forest)". Null when the feature carries none.
export function featureChoiceOf(features: ReadonlyArray<{ name: string }> | undefined, feature: string): string | null {
  const wanted = textKey(feature);
  for (const held of features ?? []) {
    const parts = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(held.name.trim());
    if (parts && textKey(parts[1]) === wanted) {
      return parts[2].trim();
    }
  }
  return null;
}

// The choice's list, for the option the sheet's features name.
function choiceSpellsBy(chosen: SubclassTable, features: ReadonlyArray<{ name: string }> | undefined, level: number, expanded: boolean): string[] {
  const choice = chosen.choiceSpells;
  if (!choice || Boolean(choice.expanded) !== expanded) {
    return [];
  }
  const option = featureChoiceOf(features, choice.feature);
  const table = option ? Object.entries(choice.options).find(([name]) => textKey(name) === textKey(option))?.[1] : undefined;
  return spellsBy(table, level);
}

function subclassTableOf(classId: string, subclass: string, extras?: SubclassExtras): SubclassTable | null {
  const table = featureTableOf(classId);
  return table ? (findSubclass(table, subclass) ?? extraTableNamed(classId, subclass, extras)) : null;
}

// The spells a subclass has granted by `level`, always prepared or known and
// free: domain, circle and oath lists, a learned cantrip, and the list of the
// option chosen for a feature when `features` name it (a Land druid's
// terrain, a Divine Soul's affinity). Callers add these to the sheet's
// lists; they never count against the known/prepared ceiling. A warlock
// patron's list is not one of them (subclassExpandedSpellsFor).
export function subclassSpellsFor(
  classId: string,
  subclass: string,
  level: number,
  extras?: SubclassExtras,
  features?: ReadonlyArray<{ name: string }>,
): string[] {
  const chosen = subclassTableOf(classId, subclass, extras);
  if (!chosen) {
    return [];
  }
  return [...new Set([...spellsBy(chosen.spells, level), ...choiceSpellsBy(chosen, features, level, false)])];
}

// The spells a subclass adds to those its class may learn by `level`, not
// granting them: a warlock patron's expanded list (and a genie's kind's
// part of it, read from `features`).
export function subclassExpandedSpellsFor(
  classId: string,
  subclass: string,
  level: number,
  extras?: SubclassExtras,
  features?: ReadonlyArray<{ name: string }>,
): string[] {
  const chosen = subclassTableOf(classId, subclass, extras);
  if (!chosen) {
    return [];
  }
  return [...new Set([...spellsBy(chosen.expanded, level), ...choiceSpellsBy(chosen, features, level, true)])];
}

// Other classes' spell lists a subclass may learn from (Divine Soul: the
// cleric's), lowercased class ids.
export function subclassSpellListsFor(classId: string, subclass: string, extras?: SubclassExtras): string[] {
  return (subclassTableOf(classId, subclass, extras)?.spellLists ?? []).map((entry) => textKey(entry));
}

const RACES = (racesJson as { races: Array<{ id: string; traits: string[] }> }).races;

// Race ids arrive as SRD ids (half_elf), content-pack slugs (half-elf) or
// the pack's own copies of the bundled rows (odm-half-elf); all three find
// the bundled traits.
export function racialTraitsFor(raceId: string): SheetFeature[] {
  const wanted = srdRaceId(raceId);
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
  // The feats on the sheet: Martial Adept, Eldritch Adept and Metamagic
  // Adept open choice slots of their own (src/lib/srd/feat-combat.ts).
  feats?: string[],
  extras?: SubclassExtras,
): SheetFeature[] {
  const granted: SheetFeature[] = [];
  for (const entry of classes) {
    granted.push(
      ...classFeaturesFor(entry.id, entry.subclass, entry.level, extras).map((feature) => ({
        ...feature,
        classId: entry.id,
      })),
    );
  }
  // A feature whose option the player chose keeps it ("Totem Spirit (Bear)",
  // "Genie's Vessel (Efreeti)": src/lib/srd/authored-effects.ts renames the
  // feature), where the regrant would write the bare name back and lose it.
  // A table name with its own parentheses ("Extra Attack (2)") is a grant,
  // never a choice.
  const tableNames = exactFeatureNames(extras);
  for (let index = 0; index < granted.length; index += 1) {
    const feature = granted[index];
    const chosen = existing.find(
      (held) =>
        held.source === "class" &&
        (!held.classId || !feature.classId || held.classId === feature.classId) &&
        held.name.replace(/\s*\([^()]*\)\s*$/, "") !== held.name &&
        textKey(held.name.replace(/\s*\([^()]*\)\s*$/, "")) === textKey(feature.name) &&
        !tableNames.has(textKey(held.name)),
    );
    if (chosen) {
      granted[index] = { ...feature, name: chosen.name };
    }
  }
  const racialTraits = racialTraitsFor(raceId);
  granted.push(...racialTraits);
  // A race the bundled data doesn't describe (a content-pack Catfolk) has its
  // trait names written by the builder; they are the only copy there is.
  const keepsRaceNames = racialTraits.length === 0;
  const grantedNames = new Set(granted.map((feature) => textKey(feature.name)));
  const kept = pruneChoiceFeatures(
    existing.filter(
      (feature) =>
        (feature.source === "feat" ||
          feature.source === "story" ||
          feature.source === "choice" ||
          feature.source === "background" ||
          (feature.source === "race" && keepsRaceNames) ||
          // A dragonborn's chosen ancestry is a race feature only the
          // player's pick names; the regrant keeps it.
          (feature.source === "race" && takesDraconicAncestry(raceId) && ancestryOf([feature]) !== null)) &&
        !grantedNames.has(textKey(feature.name)),
    ),
    classes,
    granted,
    feats,
  );
  const seen = new Set<string>();
  return [...granted, ...kept].filter((feature) => {
    const key = textKey(feature.name);
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
  feats?: string[],
): SheetFeature[] {
  const styleSlots = fightingStyleSlots(granted);
  const styles = new Set(chosenFightingStyles(features).map((name) => textKey(name)));
  // A style the slots do not allow (Archery on a Swords bard) is not kept.
  const allowedStyles = new Set(fightingStyleChoices(granted).map((style) => textKey(style.name)));
  let stylesKept = 0;
  const perKind = new Map<string, number>();
  return features.filter((feature) => {
    if (feature.source !== "choice") {
      return true;
    }
    const option = findOptionByFeatureName(feature.name);
    if (option) {
      const total =
        classes.reduce(
          (sum, entry) =>
            sum +
            optionSlotsFor(
              entry.id,
              entry.subclass,
              entry.level,
              option.k,
              // The features this class granted: a workshop subclass's
              // borrowed Combat Superiority keeps its maneuvers.
              granted.filter((held) => held.classId === entry.id),
            ),
          0,
        ) +
        featOptionSlots(feats, option.k);
      const taken = perKind.get(option.k) ?? 0;
      if (taken >= total) {
        return false;
      }
      perKind.set(option.k, taken + 1);
      return true;
    }
    const bare = chosenFightingStyles([feature])[0];
    if (bare !== undefined && styles.has(textKey(bare))) {
      if (stylesKept >= styleSlots || !allowedStyles.has(textKey(bare))) {
        return false;
      }
      stylesKept += 1;
      return true;
    }
    return true;
  });
}

// Every feature name the class and subclass tables grant, exactly as written
// (parentheses kept), with the workshop's and the pack's subclasses.
let tableFeatureNames: Set<string> | null = null;
function exactFeatureNames(extras?: SubclassExtras): Set<string> {
  if (!tableFeatureNames) {
    tableFeatureNames = new Set(
      Object.values(CLASS_FEATURES)
        .flatMap((table) => [
          ...Object.values(table.levels).flat(),
          ...table.subclasses.flatMap((subclass) => Object.values(subclass.levels).flat()),
        ])
        .map(textKey),
    );
  }
  const extra = Object.values(extras ?? browserSubclassExtras())
    .flat()
    .flatMap((entry) => Object.values(entry.levels).flat().map((row) => textKey(row.n)));
  return extra.length ? new Set([...tableFeatureNames, ...extra]) : tableFeatureNames;
}

// Single-class shape, kept so the many existing call sites stay unchanged;
// delegates to the class-list grant above.
export function populateFeatures(
  existing: SheetFeature[],
  classId: string,
  subclass: string,
  raceId: string,
  level: number,
  feats?: string[],
  extras?: SubclassExtras,
): SheetFeature[] {
  return populateFeaturesForClasses(existing, [{ id: classId, subclass, level }], raceId, feats, extras);
}
