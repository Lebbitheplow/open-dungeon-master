// One spelling for a race id, whichever list it came from: bundled ids are
// snake_case (hill_dwarf), content-pack slugs kebab-case (hill-dwarf), and
// the pack's own copies of bundled rows carry an "odm-" prefix
// (odm-hill-dwarf). Kept free of imports so src/lib/srd/features.ts, the
// HP rule in src/lib/srd/index.ts and src/lib/content/race-options.ts can all
// share it without a cycle.

import { textKey } from "@/lib/language/text-logic";
import { EDITION_2024_DOCUMENTS } from "@/lib/content/edition";

// A sheet saved while the pack still carried 2024 species holds its row's
// id with the document in front ("srd-2024-goliath"). That species is the
// same people in the 2014 rules, so the id reads as the 2014 row's; any other
// document's prefix stays, because its row is a species of its own
// ("toh-drow", issue #115).
const REVISED_PREFIX = new RegExp(`^(?:${[...EDITION_2024_DOCUMENTS].map((slug) => slug.replace(/[^a-z0-9]+/g, "_")).join("|")})_`);

// The SRD names its halfling subrace "lightfoot"; the bundled row, like the
// expanded pack's, is "lightfoot_halfling".
const ALIASES: Record<string, string> = { lightfoot: "lightfoot_halfling" };

export function srdRaceId(raceId: string): string {
  const id = raceId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^odm_/, "")
    .replace(REVISED_PREFIX, "")
    .replace(/^_|_$/g, "");
  return ALIASES[id] ?? id;
}

// What the engines read off a species the bundled list does not carry (a
// content-pack Derro, a workshop copy of the Hill Dwarf): its size, whether
// heavy armor slows it, and the names of its traits, which the rules keyed
// to a bundled race's id fall back on (Dwarven Toughness, Infernal Legacy's
// spells, Draconic Ancestry). The server reads the pack and the workshop
// (src/lib/characters/species-rules.ts, registered by src/lib/db/sheets.ts);
// the builder passes the option it holds. Without one a species is Medium
// and none of these apply, which is what every non-bundled species was.
export type SpeciesRules = {
  size?: string;
  heavyArmorSpeed?: boolean;
  traitNames: string[];
};

let speciesReader: ((raceId: string) => SpeciesRules | null) | null = null;

export function registerSpeciesReader(reader: (raceId: string) => SpeciesRules | null): void {
  speciesReader = reader;
}

// The browser's: the species a page was sent (the campaign snapshot's
// `species`, the builder's list). Never filled on the server, where the
// reader answers.
const browserSpecies = new Map<string, SpeciesRules>();

// A sign-out forgets what the browser was told.
export function forgetBrowserSpecies(): void {
  browserSpecies.clear();
}

export function registerBrowserSpecies(entries: Record<string, SpeciesRules> | null | undefined): void {
  if (typeof window === "undefined" || !entries) {
    return;
  }
  for (const [raceId, rules] of Object.entries(entries)) {
    browserSpecies.set(raceId, rules);
  }
}

export function speciesRulesFor(raceId: string, given?: SpeciesRules | null): SpeciesRules | null {
  if (given) {
    return given;
  }
  const id = raceId.trim();
  if (!id) {
    return null;
  }
  return (speciesReader ? speciesReader(id) : null) ?? browserSpecies.get(id) ?? null;
}

// Whether the species holds a trait of this name ("Dwarven Toughness" also
// as the bundled list's "+1 HP per level (Dwarven Toughness)").
export function speciesHoldsTrait(rules: SpeciesRules | null, name: string): boolean {
  const wanted = textKey(name);
  return (rules?.traitNames ?? []).some((trait) => {
    const note = /\(([^()]*)\)\s*$/.exec(trait)?.[1] ?? "";
    return [trait, trait.replace(/\s*\(.*$/, ""), note].some((form) => textKey(form) === wanted);
  });
}

// The 2024 species a stored character was made as, or null. A 2024 copy
// of a species ODM also has saved its document in the id
// ("srd-2024-goliath"); the 2024 Orc saved the bare "orc" the 2014 Orc now
// has, so it is told apart by the 2014 trait it never had. The builder says
// so when the character is edited: the scores stay, the traits become the
// 2014 species'.
const REVISED_SPECIES_SIGN: Record<string, string> = { orc: "Aggressive" };

export function revisedSpecies(raceId: string, raceTraitNames: readonly string[]): string | null {
  const id = raceId.trim();
  for (const document of EDITION_2024_DOCUMENTS) {
    if (id.startsWith(`${document}-`)) {
      return id.slice(document.length + 1);
    }
  }
  const sign = REVISED_SPECIES_SIGN[id];
  return sign && raceTraitNames.length && !speciesHoldsTrait({ traitNames: [...raceTraitNames] }, sign) ? id : null;
}

// The bundled dwarves under every spelling of their ids, and a race written
// "Dwarf": never a species whose id only holds the word (Tome of Heroes'
// Dwarf Chassis answers by its own rules).
const DWARVES = new Set(["dwarf", "hill_dwarf", "mountain_dwarf"]);
export function isDwarf(raceId: string): boolean {
  return DWARVES.has(srdRaceId(raceId));
}

// Dwarven Toughness: +1 hit point per level, under every Hill Dwarf id and
// for any species that carries the trait.
export function hpBonusPerLevel(raceId: string, rules?: SpeciesRules | null): number {
  if (srdRaceId(raceId) === "hill_dwarf") {
    return 1;
  }
  return speciesHoldsTrait(speciesRulesFor(raceId, rules), "dwarven toughness") ? 1 : 0;
}

// Only the variant human is handed a feat by its race, under every spelling
// of its id. The server's feat check and the builder's step gate both ask.
export function racialFeatCount(raceId: string): number {
  return srdRaceId(raceId) === "variant_human" ? 1 : 0;
}
