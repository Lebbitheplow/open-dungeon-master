import authoredFeatsJson from "@/lib/srd/authored-feats.json";
import { authoredRows } from "@/lib/srd/authored-effects";
import { populateResources, RESOURCE_DEFS } from "@/lib/srd/class-resources";
import { clashesWithClassFeature, FEATURE_EFFECTS, FIGHTING_STYLES } from "@/lib/srd/feature-effects";
import { isPublishedFeatureName } from "@/lib/srd/features";
import { racialNaturalWeapon } from "@/lib/srd/racial-weapons";
import { sensesFromText } from "@/lib/srd/senses";
import { climbsFrom, flyingSpeedOf, swimsFrom } from "@/lib/battlemap/types";
import { darkvisionTilesFromText } from "@/lib/battlemap/los";
import { pcImmunities, pcResistances } from "@/lib/dm/pc-defenses";
import { normalizeHomebrewData } from "@/lib/homebrew/gear";
import { readSpeciesVariants, type SpeciesVariantGroup } from "@/lib/content/species-variants";
import { textKey } from "@/lib/language/text-logic";
import type { HomebrewKind } from "@/lib/schemas/homebrew";

// A species' choice is written on a character's sheet as a race feature,
// "<label> (<option>)" (src/lib/content/species-variants.ts), and the table's
// engines read features by name: the name before a bracket note as the
// feature itself, and some words anywhere in it ("wings", "darkvision"). A
// choice called "Second Wind" would hand every character who picks an option
// a Second Wind counter, one called "Dwarven Resilience" poison resistance,
// an option named "Dragon Wings" a flying speed. Such a choice is refused when
// it is saved, with the clash named, here on the server: the tables of names
// the engines run stay out of the editor's bundle, and the editor shows the
// refusal as the save's error and keeps the draft.

// The Dragonborn's Draconic Ancestry is read only as "Draconic Ancestry: Red
// (...)" (src/lib/srd/racial-grants.ts), never by its bare name, and it is
// the choice this one generalizes: "Draconic ancestry (Ashen)" reads as
// nothing but the record of the pick.
const RECORD_ONLY = new Set([textKey("Draconic Ancestry")]);

const bare = (name: string) => name.replace(/\s*\([^()]*\)\s*$/, "").trim();

// Every name an engine runs by, keyed: the typed feature effects, the
// fighting styles, the authored subclass features, ODM's own feats and the
// counters. The class and subclass tables, the lineages' traits and the
// option picks are asked through their own lookups below.
let tableNames: Set<string> | null = null;
function namesTheTableRuns(): Set<string> {
  if (tableNames) {
    return tableNames;
  }
  const out = new Set<string>();
  const add = (name: string) => {
    const key = textKey(bare(name));
    if (key) {
      out.add(key);
    }
  };
  FEATURE_EFFECTS.forEach((def) => def.match.forEach(add));
  FIGHTING_STYLES.forEach((style) => add(style.name));
  authoredRows().forEach((row) => add(row.feature));
  (authoredFeatsJson as { feats: Array<{ name: string }> }).feats.forEach((feat) => add(feat.name));
  RESOURCE_DEFS.forEach((def) => [...def.match, ...(def.upgrades ?? []).map((upgrade) => upgrade.match)].forEach(add));
  tableNames = out;
  return out;
}

// What the table would read a race feature of this name as, in a few plain
// words, or null when it reads nothing in it.
export function engineReading(name: string): string | null {
  const feature = { name, source: "race" as const };
  const features = [feature];
  // The whole name, and the name before its bracket note, as isNamed reads
  // them (src/lib/srd/feature-names.ts).
  for (const spelling of new Set([name, bare(name)])) {
    if (RECORD_ONLY.has(textKey(bare(spelling)))) {
      continue;
    }
    if (namesTheTableRuns().has(textKey(spelling)) || isPublishedFeatureName(spelling) || clashesWithClassFeature(spelling)) {
      return `${bare(spelling)}, a feature it runs`;
    }
  }
  const counter = Object.keys(populateResources(features, 20, {}, undefined))[0];
  if (counter) {
    return `the ${RESOURCE_DEFS.find((def) => def.id === counter)?.displayName ?? counter} it counts`;
  }
  const resisted = pcResistances({ race: "", features });
  if (resisted) {
    return `resistance to ${resisted} damage`;
  }
  const immune = pcImmunities({ features });
  if (immune) {
    return `immunity to ${immune} damage`;
  }
  if (flyingSpeedOf({ features }) !== null) {
    return "a flying speed";
  }
  if (swimsFrom(undefined, features)) {
    return "a swimming speed";
  }
  if (climbsFrom(undefined, features)) {
    return "a climbing speed";
  }
  if (darkvisionTilesFromText([name]) > 0 || Object.values(sensesFromText([name])).some((range) => range > 0)) {
    return "a sense (darkvision, blindsight, tremorsense or truesight)";
  }
  // Two readers that look for their words in every feature's name and keep
  // them to themselves: a reaction spell's sight of the invisible
  // (src/lib/dm/reaction-spells.ts) and a Hunter's Multiattack Defense
  // (src/lib/dm/enemy-attack.ts).
  if (/see invisibility|true seeing/i.test(name)) {
    return "a sight of the invisible";
  }
  if (/multiattack defense/i.test(name)) {
    return "Multiattack Defense";
  }
  if (racialNaturalWeapon(features, bare(name))) {
    return "a natural weapon";
  }
  return null;
}

// The first clash a species' choice holds, as the sentence a save is refused
// with, or null. The label alone first: every option's record carries it.
export function speciesChoiceClash(group: SpeciesVariantGroup): string | null {
  const labelReading = engineReading(group.label);
  if (labelReading) {
    return `The table would read the choice's label, "${group.label}", as ${labelReading}, and give it to every character who picks an option. Call the choice something else, such as Bloodline or Lineage.`;
  }
  for (const option of group.options) {
    const record = `${group.label} (${option.name})`;
    const reading = engineReading(record);
    if (reading) {
      return `The table would read "${record}", the feature ${option.name} writes on a sheet, as ${reading}. Give the option another name.`;
    }
  }
  return null;
}

// The normalizer the save routes and a bundle's arrivals run: the editor's
// own (src/lib/homebrew/gear.ts), then for a species the clash above.
export function normalizeHomebrewForSave(
  kind: HomebrewKind,
  data: unknown,
  name: string,
): ReturnType<typeof normalizeHomebrewData> {
  const normalized = normalizeHomebrewData(kind, data, name);
  if ("error" in normalized || kind !== "race") {
    return normalized;
  }
  const group = readSpeciesVariants((normalized.data as { variants?: unknown }).variants);
  const clash = group ? speciesChoiceClash(group) : null;
  return clash ? { error: clash } : normalized;
}
