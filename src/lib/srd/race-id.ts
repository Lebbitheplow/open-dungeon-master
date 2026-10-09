// One spelling for a race id, whichever list it came from: bundled ids are
// snake_case (hill_dwarf), content-pack slugs kebab-case (hill-dwarf), and
// the pack's own copies of bundled rows carry an "odm-" prefix
// (odm-hill-dwarf). Kept free of imports so src/lib/srd/features.ts, the
// HP rule in src/lib/srd/index.ts and src/lib/content/race-options.ts can all
// share it without a cycle.

// The SRD names its halfling subrace "lightfoot"; the bundled row, like the
// expanded pack's, is "lightfoot_halfling".
const ALIASES: Record<string, string> = { lightfoot: "lightfoot_halfling" };

export function srdRaceId(raceId: string): string {
  const id = raceId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^odm_/, "")
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
  const wanted = name.toLowerCase();
  return (rules?.traitNames ?? []).some((trait) => {
    const held = trait.toLowerCase();
    return held === wanted || held.startsWith(`${wanted} (`) || held.endsWith(`(${wanted})`);
  });
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
