import classFeaturesJson from "@/lib/srd/class-features.json";
import racesJson from "@/lib/srd/races.json";
import { CUSTOM_CLASS_FEATURES } from "@/lib/classes";
import type { SheetFeature } from "@/lib/schemas/sheet";

type ClassFeatureTable = {
  subclassLevel: number;
  levels: Record<string, string[]>;
  subclass: { name: string; levels: Record<string, string[]> };
};

// SRD tables plus the custom-class catalog; ids never collide, so every
// grant helper below works for both without call-site changes.
const CLASS_FEATURES: Record<string, ClassFeatureTable> = {
  ...(classFeaturesJson as unknown as { classes: Record<string, ClassFeatureTable> }).classes,
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

// The SRD subclass name for a class (e.g. "Champion" for fighter), or null
// for unknown classes.
export function srdSubclassName(classId: string): string | null {
  return CLASS_FEATURES[classId]?.subclass.name ?? null;
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

// Loose name match: sheets store subclasses as free text and content packs
// use their own slugs, so "Evocation" must still hit "School of Evocation".
function subclassMatches(stored: string, srdName: string): boolean {
  const a = stored.trim().toLowerCase();
  const b = srdName.trim().toLowerCase();
  if (!a || a.length < 4) {
    return a === b;
  }
  return a === b || a.includes(b) || b.includes(a);
}

// Base-class features up to `level`; subclass features only when the stored
// subclass string matches the SRD subclass name. Custom subclasses get
// base-class features only.
export function classFeaturesFor(classId: string, subclass: string, level: number): SheetFeature[] {
  const table = CLASS_FEATURES[classId];
  if (!table) {
    return [];
  }
  const clamped = clampLevel(level);
  const granted = leveledNames(table.levels, clamped);
  if (subclassMatches(subclass, table.subclass.name)) {
    granted.push(...leveledNames(table.subclass.levels, clamped));
  }
  return granted.sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
}

const RACES = (racesJson as { races: Array<{ id: string; traits: string[] }> }).races;

// Race ids arrive as SRD ids (half_elf) or content-pack slugs (half-elf);
// normalize punctuation so both find the bundled traits.
function normalizeRaceId(raceId: string) {
  return raceId.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
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
// keeping everything the table added by hand or story ("feat" and "story"
// sources). Deduped by lowercased name; the SRD grant wins ties so regrants
// stay idempotent across level-ups and re-instantiation at a new level.
export function populateFeatures(
  existing: SheetFeature[],
  classId: string,
  subclass: string,
  raceId: string,
  level: number,
): SheetFeature[] {
  const granted = [...classFeaturesFor(classId, subclass, level), ...racialTraitsFor(raceId)];
  const grantedNames = new Set(granted.map((feature) => feature.name.toLowerCase()));
  const kept = existing.filter(
    (feature) =>
      (feature.source === "feat" || feature.source === "story") &&
      !grantedNames.has(feature.name.toLowerCase()),
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
