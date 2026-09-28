// The two subclasses that cast at a third of a full caster's pace: the
// fighter's Eldritch Knight and the rogue's Arcane Trickster. Neither is in
// SRD 5.1; ODM ships both (src/lib/srd/subclasses.json), so their tables are
// here in the SRD's own shape. Import-free, so src/lib/srd/index.ts and the
// multiclass table can both read it without a cycle.

const THIRD_CASTERS: Record<string, string> = {
  fighter: "eldritch knight",
  rogue: "arcane trickster",
};

// Index = class level - 1; each row is slot levels 1 to 4.
const THIRD_SLOTS: number[][] = [
  [], [], [2], [3], [3], [3], [4, 2], [4, 2], [4, 2], [4, 3],
  [4, 3], [4, 3], [4, 3, 2], [4, 3, 2], [4, 3, 2], [4, 3, 3],
  [4, 3, 3], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 1],
];

// Spells known by class level, index = level - 1.
const THIRD_SPELLS_KNOWN = [0, 0, 3, 4, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 11, 11, 12, 13];

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

// Whether this class and subclass cast as a third caster.
export function isThirdCaster(classId: string, subclass: string | undefined | null): boolean {
  const wanted = THIRD_CASTERS[normalize(classId)];
  return Boolean(wanted) && normalize(subclass ?? "") === wanted;
}

// Spell slots {level: max} at a class level; empty below 3rd.
export function thirdCasterSlots(level: number): Record<string, number> {
  const row = THIRD_SLOTS[Math.max(1, Math.min(20, Math.floor(level))) - 1] ?? [];
  return Object.fromEntries(row.map((max, index) => [String(index + 1), max]));
}

export function thirdCasterSpellsKnown(level: number): number {
  return THIRD_SPELLS_KNOWN[Math.max(1, Math.min(20, Math.floor(level))) - 1] ?? 0;
}

// Cantrips known: two from 3rd level and a third at 10th. The Arcane
// Trickster's Mage Hand is one more, on top.
export function thirdCasterCantrips(classId: string, level: number): number {
  if (level < 3) {
    return 0;
  }
  const base = level >= 10 ? 3 : 2;
  return normalize(classId) === "rogue" ? base + 1 : base;
}

// Both cast with Intelligence from the wizard's list.
export const THIRD_CASTER_ABILITY = "int" as const;
export const THIRD_CASTER_LIST = "wizard";
