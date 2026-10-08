// Hit points as the table's HP method gives them. Pure and import-free, so
// the legality check, the level-up, the library adaptation and the builder
// all show and store the same number.
//
// SRD 5.1: 1st level is the hit die's maximum plus the Constitution modifier.
// Every level after adds the die (rolled, or its fixed value: half the die
// plus one) plus the modifier, and never less than 1. A Constitution change
// is retroactive, which falls out of computing from the levels rather than
// adding to a stored total.
//
// ODM's table setting picks how the later levels are counted: "average" (the
// fixed value), "rolled" (the SERVER rolls the die) or "max" (the die's
// highest face every level).

export const HP_METHODS = ["average", "rolled", "max"] as const;
export type HpMethod = (typeof HP_METHODS)[number];

// One class's share of a character: its hit die and the levels taken in it.
// The first entry is the class the character started in, which is the one
// that took 1st level.
export type HpClass = { die: number; level: number };

export type HpInput = {
  classes: HpClass[];
  con: number;
  // Flat extra per character level: Dwarven Toughness (1), the Tough feat (2).
  perLevelBonus?: number;
  // Hit points a feature adds per level of one class, already summed for the
  // levels held: Draconic Resilience's one per sorcerer level
  // (src/lib/srd/trait-rules.ts featureHitPoints).
  extraHp?: number;
};

const conModOf = (score: number) => Math.floor((score - 10) / 2);

export function fixedDieValue(die: number): number {
  return Math.floor(die / 2) + 1;
}

// What one level after the first adds, given the face the die showed.
export function levelHpGain(face: number, con: number, perLevelBonus = 0): number {
  return Math.max(1, face + conModOf(con) + perLevelBonus);
}

// The face a level counts under a method that needs no dice.
export function methodFace(method: Exclude<HpMethod, "rolled">, die: number): number {
  return method === "max" ? die : fixedDieValue(die);
}

function firstLevelHp(die: number, con: number, perLevelBonus: number): number {
  return Math.max(1, die + conModOf(con) + perLevelBonus);
}

function laterLevels(classes: HpClass[]): number[] {
  // The dice of every level after the first, one entry per level.
  const dice: number[] = [];
  classes.forEach((entry, index) => {
    const levels = Math.max(0, Math.floor(entry.level)) - (index === 0 ? 1 : 0);
    for (let step = 0; step < levels; step += 1) {
      dice.push(entry.die);
    }
  });
  return dice;
}

// The hit point maximum under "average" or "max": one legal answer.
export function derivedMaxHp(method: Exclude<HpMethod, "rolled">, input: HpInput): number {
  const bonus = input.perLevelBonus ?? 0;
  const [first] = input.classes;
  if (!first) {
    return 1;
  }
  return (
    laterLevels(input.classes).reduce(
      (sum, die) => sum + levelHpGain(methodFace(method, die), input.con, bonus),
      firstLevelHp(first.die, input.con, bonus),
    ) + (input.extraHp ?? 0)
  );
}

// The least and the most the dice could have given: a 1 and the highest face
// on every level after the first.
export function hpRange(input: HpInput): { min: number; max: number } {
  const bonus = input.perLevelBonus ?? 0;
  const [first] = input.classes;
  if (!first) {
    return { min: 1, max: 1 };
  }
  const base = firstLevelHp(first.die, input.con, bonus) + (input.extraHp ?? 0);
  const dice = laterLevels(input.classes);
  return {
    min: dice.reduce((sum) => sum + levelHpGain(1, input.con, bonus), base),
    max: dice.reduce((sum, die) => sum + levelHpGain(die, input.con, bonus), base),
  };
}

// What a changed Constitution or per-level bonus gives back for the levels
// already held: the difference per level, floor included, for a sheet whose
// dice are not on record. Every level is counted at the fixed value, which
// is exact unless a level sat on the 1 point floor.
export function retroactiveHp(
  classes: HpClass[],
  before: { con: number; perLevelBonus?: number },
  after: { con: number; perLevelBonus?: number },
): number {
  return (
    derivedMaxHp("average", { classes, con: after.con, perLevelBonus: after.perLevelBonus }) -
    derivedMaxHp("average", { classes, con: before.con, perLevelBonus: before.perLevelBonus })
  );
}

// Flat hit points per level from race and feats. Level Up's Hardy
// Adventurer is Tough under another name (feat-effects.ts FEAT_TWINS);
// named here too, since this module stays import-free.
export function hpBonusPerLevelFor(raceHillDwarf: boolean, feats: string[]): number {
  const tough = feats.some((feat) => ["tough", "hardy adventurer"].includes(feat.trim().toLowerCase()));
  return (raceHillDwarf ? 1 : 0) + (tough ? 2 : 0);
}
