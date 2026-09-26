import { raceMechanics, type RaceMechanics } from "@/lib/content/mechanics";
import { SRD_RACES, type SrdRace } from "@/lib/srd";

// The content pack's race rows, turned into the shape the character builder
// works from. Three things happen here that raceMechanics alone cannot do:
//
// - A subrace row (Hill Dwarf under Dwarf) carries only what it adds, so its
//   parent's speed, languages and ability bumps are folded in. Without this a
//   pack Hill Dwarf had +1 Wisdom, no +2 Constitution, and spoke only Common.
// - A row the bundled SRD also describes (the wotc-srd rows, the expanded
//   pack's copies) takes its mechanics from src/lib/srd/races.json, which is
//   what actually grants skills, tools, cantrips and free languages; the pack
//   keeps its prose.
// - Anything else is parsed from the pack's prose.

// Content-pack slugs are kebab-case and the pack's own copies of SRD rows
// carry an "odm-" prefix; the bundled ids are snake_case.
export function canonicalRaceId(raceId: string): string {
  return raceId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^odm_/, "")
    .replace(/^_|_$/g, "");
}

export function srdRaceFor(raceId: string): SrdRace | null {
  const id = canonicalRaceId(raceId);
  return SRD_RACES.find((entry) => entry.id === id) ?? null;
}

export type RaceRow = { slug: string; name: string; data: Record<string, unknown> };

export type PackRaceOption = { id: string; name: string; note: string } & RaceMechanics;

const GRANT_KEYS = [
  "skills",
  "skillChoice",
  "asiChoice",
  "cantripChoice",
  "tools",
  "toolChoice",
  "armor",
  "weapons",
] as const;

function withParent(
  sub: RaceMechanics,
  subData: Record<string, unknown>,
  parent: RaceMechanics,
): RaceMechanics {
  const asi: RaceMechanics["asi"] = { ...parent.asi };
  for (const [ability, bonus] of Object.entries(sub.asi)) {
    const key = ability as keyof RaceMechanics["asi"];
    asi[key] = (asi[key] ?? 0) + (bonus ?? 0);
  }
  const ownSpeed = subData.speed !== undefined || Array.isArray(subData.traits);
  const ownLanguages = subData.languages !== undefined;
  const merged: RaceMechanics = {
    ...sub,
    asi,
    speed: ownSpeed ? sub.speed : parent.speed,
    languages: ownLanguages ? sub.languages : parent.languages,
    bonusLanguages: ownLanguages ? sub.bonusLanguages : parent.bonusLanguages,
    traitsSummary: [parent.traitsSummary, sub.traitsSummary].filter(Boolean).join(" · "),
  };
  const choice = ownLanguages ? sub.languageChoice : parent.languageChoice;
  if (choice) {
    merged.languageChoice = choice;
  } else {
    delete merged.languageChoice;
  }
  for (const key of GRANT_KEYS) {
    const value = sub[key] ?? parent[key];
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

function withSrd(parsed: RaceMechanics, srd: SrdRace): RaceMechanics {
  const merged: RaceMechanics = {
    speed: srd.speed,
    asi: srd.asi,
    languages: srd.languages.filter((language) => !/of your choice/i.test(language)),
    bonusLanguages: srd.bonusLanguages ?? 0,
    traitsSummary: parsed.traitsSummary || srd.traits.join(" · "),
  };
  for (const key of GRANT_KEYS) {
    if (srd[key] !== undefined) {
      (merged as Record<string, unknown>)[key] = srd[key];
    }
  }
  return merged;
}

export function packRaceOptions(rows: RaceRow[]): PackRaceOption[] {
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const parsed = new Map<string, RaceMechanics>();
  const mechanicsFor = (row: RaceRow): RaceMechanics => {
    let mechanics = parsed.get(row.slug);
    if (!mechanics) {
      mechanics = raceMechanics(row.data);
      parsed.set(row.slug, mechanics);
    }
    return mechanics;
  };
  return rows.map((row) => {
    let mechanics = mechanicsFor(row);
    const parentSlug = String(row.data.parent_slug ?? "");
    const parent = parentSlug && parentSlug !== row.slug ? bySlug.get(parentSlug) : undefined;
    if (parent) {
      mechanics = withParent(mechanics, row.data, mechanicsFor(parent));
    }
    const srd = srdRaceFor(row.slug);
    if (srd) {
      mechanics = withSrd(mechanics, srd);
    }
    if (!mechanics.languages.length) {
      mechanics = { ...mechanics, languages: ["Common"] };
    }
    return { id: row.slug, name: row.name, ...mechanics, note: mechanics.traitsSummary };
  });
}
