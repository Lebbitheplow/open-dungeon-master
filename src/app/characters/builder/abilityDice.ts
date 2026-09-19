// The arithmetic and the timing behind the dice grid. Pure apart from the
// injectable random source, so scripts/test-ability-dice.mjs can pin every
// rule: which die is set aside, how long a toss lasts, which tier a total
// lands in (docs/visual-overhaul-plan.md 7.2).

export type Rng = () => number;

export type DieRest = { dx: string; dy: string; dr: string };

export type FourDice = {
  dice: [number, number, number, number];
  // The die set aside: the first of the lowest, so a tie marks one die only.
  dropIndex: number;
  total: number;
};

export type AbilityRoll = FourDice & {
  // Where each die comes to rest, so a settled row looks tossed, not gridded.
  rest: DieRest[];
  phase: "rolling" | "settled";
};

function rollDie(rng: Rng): number {
  return 1 + Math.floor(rng() * 6);
}

// Four d6, drop the lowest, sum the rest. The faces are kept so the grid can
// show them, and the dropped die is marked rather than hidden.
export function rollFourDice(rng: Rng = Math.random): FourDice {
  const dice: [number, number, number, number] = [rollDie(rng), rollDie(rng), rollDie(rng), rollDie(rng)];
  let dropIndex = 0;
  for (let index = 1; index < 4; index += 1) {
    if (dice[index] < dice[dropIndex]) {
      dropIndex = index;
    }
  }
  const total = dice.reduce((sum, value, index) => (index === dropIndex ? sum : sum + value), 0);
  return { dice, dropIndex, total };
}

export function restOffsets(rng: Rng = Math.random): DieRest[] {
  return Array.from({ length: 4 }, () => ({
    dx: `${(rng() * 7 - 3.5).toFixed(1)}px`,
    dy: `${(rng() * 7 - 3.5).toFixed(1)}px`,
    dr: `${(rng() * 26 - 13).toFixed(1)}deg`,
  }));
}

// Each die's toss lasts a little longer than the one to its left, which is
// what staggers the settle across a row off one timer instead of four.
export function tossMs(index: number): number {
  return 820 + index * 90;
}

// When the row counts as landed: the last die's toss plus a breath.
export const ROW_SETTLE_MS = tossMs(3) + 240;
export const TOTAL_POP_MS = tossMs(3) + 150;
// Roll all starts each row a beat after the one above it.
export const ROW_STAGGER_MS = 110;

// Colour tier for a rolled total: 1 is grim, 5 is heroic. The colours
// themselves live in creator.css so the day theme can restate them.
export function rollTier(total: number): 1 | 2 | 3 | 4 | 5 {
  if (total <= 5) return 1;
  if (total <= 8) return 2;
  if (total <= 12) return 3;
  if (total <= 16) return 4;
  return 5;
}

// Standard d6 pip layouts on a 42-unit face: a 3x3 grid inset to 12/21/30.
const PIP_GRID = {
  tl: [12, 12], tc: [21, 12], tr: [30, 12],
  ml: [12, 21], mc: [21, 21], mr: [30, 21],
  bl: [12, 30], bc: [21, 30], br: [30, 30],
} as const;
const PIP_FACES: Record<number, Array<keyof typeof PIP_GRID>> = {
  1: ["mc"],
  2: ["tl", "br"],
  3: ["tl", "mc", "br"],
  4: ["tl", "tr", "bl", "br"],
  5: ["tl", "tr", "mc", "bl", "br"],
  6: ["tl", "tr", "ml", "mr", "bl", "br"],
};

export function pipsFor(value: number): Array<{ cx: number; cy: number }> {
  return (PIP_FACES[value] ?? []).map((key) => ({ cx: PIP_GRID[key][0], cy: PIP_GRID[key][1] }));
}

// The order the faces flicker through while a die is in the air.
export const FLICKER_FACES = [4, 2, 6, 1, 5, 3];

// Standard array: giving a value to one ability takes it from whichever
// ability held it, and picking your own value again hands it back.
export function assignStandard<K extends string>(
  scores: Record<K, number | null>,
  ability: K,
  value: number,
): Record<K, number | null> {
  const next = { ...scores };
  if (next[ability] === value) {
    next[ability] = null;
    return next;
  }
  for (const key of Object.keys(next) as K[]) {
    if (next[key] === value) {
      next[key] = null;
    }
  }
  next[ability] = value;
  return next;
}

// The one sentence over the summary table: the standout score, named plainly.
export function summaryLine({
  method,
  best,
  who,
}: {
  method: "standard" | "pointbuy" | "roll";
  best: { label: string; final: number } | null;
  who: string;
}): string {
  const lead =
    method === "roll"
      ? "Four dice an ability, the lowest set aside."
      : method === "pointbuy"
        ? "Twenty-seven points, spent your way."
        : "The same six numbers every hero starts from, placed your way.";
  if (!best) {
    return lead;
  }
  const as = who ? ` As ${/^[aeiou]/i.test(who) ? "an" : "a"} ${who}, that` : " That";
  return `${lead} Your highest is ${best.label} at ${best.final}.${as} is the shape of the character you just made.`;
}

// ---- the health explainer ----

export type HpBreakdown = {
  hitDie: number;
  conMod: number;
  firstLevel: number;
  perLevel: number;
  laterLevels: number;
  bonusPerLevel: number;
  total: number;
};

// Mirrors suggestedStartingHp in src/lib/srd/index.ts term by term, so the
// explainer can show its working; the test holds the two together.
export function hpBreakdown({
  hitDie,
  con,
  level,
  bonusPerLevel = 0,
}: {
  hitDie: number;
  con: number;
  level: number;
  bonusPerLevel?: number;
}): HpBreakdown {
  const conMod = Math.floor((con - 10) / 2);
  const firstLevel = hitDie + conMod + bonusPerLevel;
  const perLevel = Math.floor(hitDie / 2) + 1 + conMod + bonusPerLevel;
  const laterLevels = Math.max(0, (level - 1) * perLevel);
  return {
    hitDie,
    conMod,
    firstLevel,
    perLevel,
    laterLevels,
    bonusPerLevel,
    total: Math.max(1, firstLevel + laterLevels),
  };
}
