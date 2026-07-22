// "What does this actually do?" for every game term a player meets.
//
// The app already held rules text in four places, all of it written for the
// DM model rather than for a person: guidance strings on FEATURE_EFFECTS and
// RESOURCE_DEFS, the rules text on authored subclass features, and the
// one-liners on custom genre-class features. This module resolves all of them
// behind one call, and srd-features.json fills the last gap (the 131 SRD
// feature names that had no text anywhere).
//
// Pure data and pure functions with no server imports, so client components
// can import it directly, exactly like src/lib/srd/features.ts.

import glossaryJson from "@/lib/help/glossary.json";
import srdFeaturesJson from "@/lib/help/srd-features.json";
import starterSpellsJson from "@/lib/help/starter-spells.json";
import racesJson from "@/lib/srd/races.json";
import skillsJson from "@/lib/srd/skills.json";
import { classFeatureDescription, spellClassFor } from "@/lib/classes";
import { matchResource } from "@/lib/srd/class-resources";
import { guidanceFor } from "@/lib/srd/feature-effects";
import { subclassFeatureDescription } from "@/lib/srd/features";
import { findOptionByFeatureName } from "@/lib/srd/options";

export type GlossaryTerm = {
  id: string;
  term: string;
  short: string;
  long?: string;
};

const TERMS = (glossaryJson as { terms: GlossaryTerm[] }).terms;
const TERMS_BY_ID = new Map(TERMS.map((entry) => [entry.id, entry]));

const SRD_FEATURE_TEXT = (srdFeaturesJson as { features: Record<string, string> }).features;
const SRD_FEATURE_BY_CLASS = (
  srdFeaturesJson as { byClass: Record<string, Record<string, string>> }
).byClass;

export function glossaryTerms(): GlossaryTerm[] {
  return TERMS;
}

export function glossaryTerm(id: string): GlossaryTerm | null {
  return TERMS_BY_ID.get(id) ?? null;
}

// Numbered SRD variants ("Indomitable (2 uses)", "Extra Attack (2)") are
// listed in full where the count changes the meaning, and fall back to the
// bare name where it does not.
function baseName(name: string): string {
  const paren = name.indexOf(" (");
  return paren === -1 ? name : name.slice(0, paren);
}

// An entry written for this exact feature name. Checked before the resource
// and effect tables, whose matching is deliberately fuzzy: "Wild Shape
// Improvement" contains "Wild Shape" and would otherwise be explained as the
// base feature rather than as the upgrade it is.
function exactSrdText(classId: string, name: string): string | null {
  const byClass = SRD_FEATURE_BY_CLASS[classId.trim().toLowerCase()];
  return byClass?.[name] ?? SRD_FEATURE_TEXT[name] ?? null;
}

function looseSrdText(classId: string, name: string): string | null {
  const byClass = SRD_FEATURE_BY_CLASS[classId.trim().toLowerCase()];
  return byClass?.[baseName(name)] ?? SRD_FEATURE_TEXT[baseName(name)] ?? null;
}

// The guidance strings were written to be read in a tool result, where naming
// the feature first is useful. In a dialog already titled with that name it
// just stutters, so a leading "Feature name:" is trimmed off.
function stripLeadingLabel(text: string | null, name: string): string | null {
  if (!text) {
    return text;
  }
  const prefix = `${name.trim()}:`;
  return text.trim().toLowerCase().startsWith(prefix.toLowerCase())
    ? text.trim().slice(prefix.length).trim()
    : text;
}

// One line explaining a feature on a sheet. Resolution runs most specific
// first: a Life Domain cleric's Divine Strike says "radiant", a Nature
// Domain one says "cold", and only a feature with no subclass-specific
// meaning falls through to the shared SRD text.
export function describeFeature(classId: string, subclass: string, name: string): string | null {
  // An option pick ("Invocation: Agonizing Blast") explains itself from the
  // option list, before any of the feature tables are consulted.
  const option = findOptionByFeatureName(name);
  if (option) {
    return option.req ? `${option.d} (Requires ${option.req}.)` : option.d;
  }
  const found =
    subclassFeatureDescription(classId, subclass, name) ??
    classFeatureDescription(classId, name) ??
    exactSrdText(classId, name) ??
    matchResource(name)?.guidance ??
    guidanceFor({ class: classId, features: [], feature: name }) ??
    looseSrdText(classId, name);
  return stripLeadingLabel(found, name);
}

const RACES = (racesJson as { races: Array<{ id: string; name: string; traits: string[] }> }).races;

function normalizeRaceId(raceId: string) {
  return raceId.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

// The bundled lineage lines. Racial traits are written to describe themselves
// ("Darkvision 60 ft", "Powerful Build (count as one size larger for
// carrying)"), so the trait list IS the description.
export function describeRace(raceId: string): string | null {
  const race = RACES.find((entry) => entry.id === normalizeRaceId(raceId));
  return race ? race.traits.join(". ") + "." : null;
}

const SKILLS = (skillsJson as { skills: Array<{ id: string; name: string; ability: string }> })
  .skills;

// A skill's line: which ability it uses, plus the glossary note on skills.
export function describeSkill(skillId: string): string | null {
  const skill = SKILLS.find((entry) => entry.id === skillId.trim().toLowerCase());
  if (!skill) {
    return null;
  }
  const ability = glossaryTerm(skill.ability);
  return `${skill.name} uses ${ability?.term ?? skill.ability.toUpperCase()}. ${
    ability?.short ?? ""
  }`.trim();
}

// The description carried on a content-pack or homebrew row. Pack rows keep
// the source's own field names, which differ between v1, v2 and the authored
// layer, so every spelling is tried.
export function describeContentEntry(data: Record<string, unknown> | undefined): string | null {
  if (!data) {
    return null;
  }
  for (const key of ["desc", "description", "traits", "benefits"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (Array.isArray(value)) {
      const joined = value
        .map((entry) =>
          typeof entry === "string"
            ? entry
            : typeof (entry as { desc?: string })?.desc === "string"
              ? (entry as { desc: string }).desc
              : "",
        )
        .filter(Boolean)
        .join("\n\n");
      if (joined.trim()) {
        return joined;
      }
    }
  }
  return null;
}

export type StarterSpells = {
  why: string;
  cantrips: Array<{ n: string; d: string }>;
  spells: Array<{ n: string; d: string }>;
};

const STARTERS = (starterSpellsJson as { classes: Record<string, StarterSpells> }).classes;

// Opening spell suggestions for a class. A new player who does not know 5e
// cannot search for a spell whose name they have never heard, so the builder
// offers these as one-tap picks next to the full list. Custom genre casters
// borrow the list of whichever SRD class they cast from.
export function starterSpellsFor(classId: string): StarterSpells | null {
  return STARTERS[spellClassFor(classId)] ?? STARTERS[classId] ?? null;
}

// Sheets store spells, feats and items by name, not by slug. This is the same
// transform scripts/lib/open5e-normalize.mjs uses, so most names resolve
// straight to their pack row; InfoDialog falls back to a search by name when
// a row uses a slug of its own.
export function contentSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// The one-line summary shown under a spell's name in a picker: level, school
// and the flags that change how it is cast.
export function spellSummary(data: Record<string, unknown> | undefined): string {
  if (!data) {
    return "";
  }
  const level = Number(data.level_int ?? data.level ?? 0);
  const school = String(
    (data.school as { name?: string })?.name ?? data.school ?? "",
  ).toLowerCase();
  const parts = [
    level === 0 ? `${school} cantrip` : `level ${level} ${school}`.trim(),
    String(data.casting_time ?? ""),
    String(data.range ?? ""),
    data.concentration ? "concentration" : "",
    data.ritual ? "ritual" : "",
  ].filter(Boolean);
  return parts.join(" · ");
}
