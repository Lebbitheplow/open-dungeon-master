import { raceMechanics, type RaceMechanics } from "@/lib/content/mechanics";
import { SRD_RACES, type SrdRace } from "@/lib/srd";
import { srdRaceId } from "@/lib/srd/race-id";

// The content pack's race rows, turned into the shape the character builder
// works from. Three things happen here that raceMechanics alone cannot do:
//
// - A subrace row (Hill Dwarf under Dwarf) carries only what it adds, so its
//   parent's speed, languages and ability bumps are folded in. Without this a
//   pack Hill Dwarf had +1 Wisdom, no +2 Constitution, and spoke only Common.
// - A row the bundled SRD also describes (the wotc-srd rows, the expanded
//   pack's copies, the srd-2024 species) takes its mechanics from
//   src/lib/srd/races.json, which is what actually grants skills, tools,
//   cantrips and free languages; the pack keeps its prose. A third-party row
//   that only shares a slug (Tome of Heroes' drow) is its own race.
// - Anything else is parsed from the pack's prose.
// - A parent whose rules require a subrace (the SRD's Dwarf, a gearforged
//   without its chassis) is not an option itself; its subraces are.

// Content-pack slugs are kebab-case and the pack's own copies of SRD rows
// carry an "odm-" prefix; the bundled ids are snake_case.
export function canonicalRaceId(raceId: string): string {
  return srdRaceId(raceId);
}

export function srdRaceFor(raceId: string): SrdRace | null {
  const id = canonicalRaceId(raceId);
  return SRD_RACES.find((entry) => entry.id === id) ?? null;
}

export type RaceRow = { slug: string; name: string; documentSlug: string; data: Record<string, unknown> };

const BUNDLED_DOCUMENTS = new Set(["wotc-srd", "odm-expanded", "srd-2024"]);

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
    // The subrace is the parent's "choose one of these" already answered.
    traitNames: [
      ...parent.traitNames.filter((name) => !parent.choiceTraitNames.includes(name)),
      ...sub.traitNames,
    ],
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
  // A gearforged's two picks and its human chassis's one are three picks.
  if (sub.asiChoice && parent.asiChoice && sub.asiChoice.amount === parent.asiChoice.amount) {
    merged.asiChoice = { count: sub.asiChoice.count + parent.asiChoice.count, amount: sub.asiChoice.amount };
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
    traitNames: parsed.traitNames,
    choiceTraitNames: parsed.choiceTraitNames,
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
  const parentSlugs = new Set(rows.map((row) => String(row.data.parent_slug ?? "")));
  const needsSubrace = (row: RaceRow) =>
    parentSlugs.has(row.slug) && (row.documentSlug === "wotc-srd" || mechanicsFor(row).choiceTraitNames.length > 0);
  return rows.filter((row) => !needsSubrace(row)).map((row) => {
    let mechanics = mechanicsFor(row);
    const parentSlug = String(row.data.parent_slug ?? "");
    const parent = parentSlug && parentSlug !== row.slug ? bySlug.get(parentSlug) : undefined;
    if (parent) {
      mechanics = withParent(mechanics, row.data, mechanicsFor(parent));
    }
    const srd = BUNDLED_DOCUMENTS.has(row.documentSlug) ? srdRaceFor(row.slug) : null;
    if (srd) {
      mechanics = withSrd(mechanics, srd);
    }
    if (!mechanics.languages.length) {
      mechanics = { ...mechanics, languages: ["Common"] };
    }
    return { id: row.slug, name: row.name, ...mechanics, note: mechanics.traitsSummary };
  });
}
