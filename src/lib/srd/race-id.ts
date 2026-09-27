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

// Dwarven Toughness: +1 hit point per level, under every Hill Dwarf id.
export function hpBonusPerLevel(raceId: string): number {
  return srdRaceId(raceId) === "hill_dwarf" ? 1 : 0;
}
