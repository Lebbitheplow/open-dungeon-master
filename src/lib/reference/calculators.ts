import { difficultyOfDc } from "@/lib/srd/dc";
import {
  encounterMultiplier,
  evaluateEncounter,
  thresholdsForParty,
  xpForCr,
} from "@/lib/srd/encounter-math";
import { carryMultiplier, COINS_PER_POUND } from "@/lib/srd/encumbrance";
import { hoardGoldDice, hoardItemCount, treasureTierForCr } from "@/lib/srd/treasure";
import {
  forcedMarchHours,
  forcedMarchSaveDc,
  NORMAL_TRAVEL_HOURS,
  paceEffect,
  paceSpeed,
  type TravelPace,
} from "@/lib/srd/travel";
import { crLabel } from "@/lib/bestiary/derive-cr";

// Every table calculation a DM does by hand between sessions, on one screen.
//
// Not one line of arithmetic lives here. Each calculator is a set of inputs
// and a call into the pure SRD module that already owns that rule, and every
// answer comes back as PARTS rather than a single number, because a DM who
// cannot see where a figure came from cannot tell a wrong input from a wrong
// rule. `encounter-workbench.ts` made the same choice for the same reason.
//
// Pure, with no I/O: the page imports it straight into the browser, so the
// numbers move as the inputs do without a round trip, and
// scripts/test-reference-desk.mjs drives it directly.

export type CalcField =
  | {
      key: string;
      label: string;
      kind: "number";
      min: number;
      max: number;
      step?: number;
      suffix?: string;
    }
  | {
      key: string;
      label: string;
      kind: "choice";
      options: ReadonlyArray<{ value: string; label: string }>;
    };

export type CalcInput = Record<string, string | number>;

export type CalcPart = {
  label: string;
  value: string;
  // Where the number came from: the rule, the table row, or the arithmetic.
  detail?: string;
};

export type CalcResult = {
  headline: string;
  parts: CalcPart[];
  // A standing assumption the answer rests on, when it has one.
  note?: string;
};

export type Calculator = {
  id: string;
  label: string;
  blurb: string;
  fields: ReadonlyArray<CalcField>;
  defaults: CalcInput;
  run: (input: CalcInput) => CalcResult;
};

// Inputs arrive from a text field, so everything is a string until proven
// otherwise. Same reasoning as monster-draft.ts: null, undefined and "" all
// coerce to 0, and a silent 0 at a boundary is worse than a fallback.
function num(input: CalcInput, key: string, fallback: number, min: number, max: number): number {
  const raw = input[key];
  const value =
    typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function int(input: CalcInput, key: string, fallback: number, min: number, max: number): number {
  return Math.round(num(input, key, fallback, min, max));
}

function choice<T extends string>(
  input: CalcInput,
  key: string,
  allowed: ReadonlyArray<T>,
  fallback: T,
): T {
  const raw = String(input[key] ?? "");
  return (allowed as ReadonlyArray<string>).includes(raw) ? (raw as T) : fallback;
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

// The CRs the DMG table prints, as picker values. Fractions are kept as
// numbers so xpForCr sees what it expects.
const CR_CHOICES = [
  0, 0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  22, 23, 24, 25, 26, 27, 28, 29, 30,
] as const;

const CR_OPTIONS = CR_CHOICES.map((cr) => ({ value: String(cr), label: `CR ${crLabel(cr)}` }));

const VERDICT_LABELS: Record<string, string> = {
  trivial: "Trivial",
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  deadly: "Deadly",
  beyond_deadly: "Beyond deadly",
};

const DIFFICULTY_LABELS: Record<string, string> = {
  very_easy: "very easy",
  easy: "easy",
  moderate: "moderate",
  hard: "hard",
  very_hard: "very hard",
  nearly_impossible: "nearly impossible",
};

const encounterBudget: Calculator = {
  id: "encounter-budget",
  label: "Encounter budget",
  blurb: "What a fight costs against the party's XP thresholds.",
  fields: [
    { key: "partySize", label: "Party size", kind: "number", min: 1, max: 10 },
    { key: "partyLevel", label: "Party level", kind: "number", min: 1, max: 20 },
    { key: "monsterCount", label: "Monsters", kind: "number", min: 1, max: 30 },
    { key: "monsterCr", label: "Each at", kind: "choice", options: CR_OPTIONS },
  ],
  defaults: { partySize: 4, partyLevel: 3, monsterCount: 2, monsterCr: "1" },
  run(input) {
    const partySize = int(input, "partySize", 4, 1, 10);
    const partyLevel = int(input, "partyLevel", 3, 1, 20);
    const monsterCount = int(input, "monsterCount", 2, 1, 30);
    const monsterCr = num(input, "monsterCr", 1, 0, 30);
    const levels = Array.from({ length: partySize }, () => partyLevel);
    const crs = Array.from({ length: monsterCount }, () => monsterCr);
    const evaluation = evaluateEncounter(levels, crs);
    const multiplier = encounterMultiplier(monsterCount, partySize);
    const thresholds = thresholdsForParty(levels);
    const each = xpForCr(monsterCr);
    return {
      headline: VERDICT_LABELS[evaluation.verdict] ?? evaluation.verdict,
      parts: [
        {
          label: "Raw XP",
          value: evaluation.totalXp.toLocaleString(),
          detail: `${monsterCount} x ${each.toLocaleString()} XP for CR ${crLabel(monsterCr)}`,
        },
        {
          label: "Multiplier",
          value: `x${multiplier}`,
          detail: `${monsterCount} monster${monsterCount === 1 ? "" : "s"} against ${partySize} player${partySize === 1 ? "" : "s"}`,
        },
        {
          label: "Adjusted XP",
          value: evaluation.adjustedXp.toLocaleString(),
          detail: "What the budget below is measured against",
        },
        {
          label: "Thresholds",
          value: `${thresholds.easy.toLocaleString()} / ${thresholds.medium.toLocaleString()} / ${thresholds.hard.toLocaleString()} / ${thresholds.deadly.toLocaleString()}`,
          detail: `easy, medium, hard, deadly for ${partySize} at level ${partyLevel}`,
        },
      ],
      note:
        "The multiplier counts heads, not danger: it is the DMG's way of pricing action economy, and it does not know these monsters act alike.",
    };
  },
};

const treasureByCr: Calculator = {
  id: "treasure",
  label: "Treasure by CR",
  blurb: "What a hoard at this challenge rating is worth.",
  fields: [
    { key: "cr", label: "Challenge rating", kind: "choice", options: CR_OPTIONS },
    {
      key: "kind",
      label: "Kind",
      kind: "choice",
      options: [
        { value: "hoard", label: "Hoard" },
        { value: "individual", label: "Individual" },
      ],
    },
  ],
  defaults: { cr: "5", kind: "hoard" },
  run(input) {
    const cr = num(input, "cr", 5, 0, 30);
    const kind = choice(input, "kind", ["hoard", "individual"] as const, "hoard");
    const tier = treasureTierForCr(cr);
    const hoard = hoardGoldDice(tier);
    const items = hoardItemCount(tier);
    // Individual treasure is a tenth of a hoard, which is the rule
    // src/lib/srd/treasure.ts states in its own header.
    const share = kind === "individual" ? 10 : 1;
    const low = Math.round((diceMin(hoard.dice) * hoard.mult) / share);
    const high = Math.round((diceMax(hoard.dice) * hoard.mult) / share);
    const average = Math.round((diceAverage(hoard.dice) * hoard.mult) / share);
    return {
      headline: `${average.toLocaleString()} gp on average`,
      parts: [
        { label: "Tier", value: `Tier ${tier}`, detail: TIER_RANGES[tier] },
        {
          label: "Roll",
          value: `${hoard.dice} x ${(hoard.mult / share).toLocaleString()} gp`,
          detail: `${low.toLocaleString()} to ${high.toLocaleString()} gp`,
        },
        {
          label: "Magic items",
          value: kind === "individual" ? "none" : String(items),
          detail:
            kind === "individual"
              ? "Individual treasure is coin. Items come from the hoard."
              : "A hint for how many to place, not a hard count",
        },
      ],
      note: "A simplified reading of the DMG hoard tables, tuned not to wreck a campaign's economy.",
    };
  },
};

const TIER_RANGES: Record<number, string> = {
  1: "CR 0 to 4",
  2: "CR 5 to 10",
  3: "CR 11 to 16",
  4: "CR 17 and up",
};

// The three numbers a "NdM" expression can produce. Kept here rather than
// reaching for averageOf because a treasure roll wants the whole range, and
// these expressions are always the plain form the treasure table prints.
function diceParts(expression: string): { count: number; sides: number } {
  const match = /^(\d+)d(\d+)$/i.exec(expression.trim());
  return match ? { count: Number(match[1]), sides: Number(match[2]) } : { count: 0, sides: 0 };
}

function diceMin(expression: string): number {
  return diceParts(expression).count;
}

function diceMax(expression: string): number {
  const { count, sides } = diceParts(expression);
  return count * sides;
}

function diceAverage(expression: string): number {
  const { count, sides } = diceParts(expression);
  return (count * (sides + 1)) / 2;
}

const travelTime: Calculator = {
  id: "travel",
  label: "Travel time",
  blurb: "How long a distance takes, and what pushing past a day costs.",
  fields: [
    { key: "miles", label: "Distance", kind: "number", min: 1, max: 5000, suffix: "miles" },
    {
      key: "pace",
      label: "Pace",
      kind: "choice",
      options: [
        { value: "slow", label: "Slow" },
        { value: "normal", label: "Normal" },
        { value: "fast", label: "Fast" },
      ],
    },
    { key: "hours", label: "Hours a day", kind: "number", min: 1, max: 24, suffix: "hours" },
  ],
  defaults: { miles: 60, pace: "normal", hours: 8 },
  run(input) {
    const miles = num(input, "miles", 60, 1, 5000);
    const pace = choice(input, "pace", ["slow", "normal", "fast"] as const, "normal") as TravelPace;
    const hours = int(input, "hours", NORMAL_TRAVEL_HOURS, 1, 24);
    const speed = paceSpeed(pace);
    const effect = paceEffect(pace);
    const perDay = speed.milesPerHour * hours;
    const days = Math.ceil(miles / perDay);
    const forced = forcedMarchHours(hours);
    const parts: CalcPart[] = [
      {
        label: "Pace",
        value: `${speed.milesPerHour} miles an hour`,
        detail: `${speed.feetPerMinute} feet a minute`,
      },
      {
        label: "Covered a day",
        value: `${perDay} miles`,
        detail: `${hours} hours at ${speed.milesPerHour} miles an hour`,
      },
      {
        label: "Watch",
        value: effect.canStealth
          ? "can travel stealthily"
          : effect.passivePerceptionMod
            ? `passive Perception ${signed(effect.passivePerceptionMod)}`
            : "no penalty",
        detail: "What the pace does to noticing things",
      },
    ];
    if (forced) {
      parts.push({
        label: "Forced march",
        value: `${forced} extra hour${forced === 1 ? "" : "s"}`,
        detail: `A Constitution save each hour, DC ${forcedMarchSaveDc(1)} rising to DC ${forcedMarchSaveDc(forced)}, or a level of exhaustion`,
      });
    }
    return {
      headline: `${days} day${days === 1 ? "" : "s"}`,
      parts,
      note: forced
        ? undefined
        : `A normal day is ${NORMAL_TRAVEL_HOURS} hours. Past that every hour is a forced march.`,
    };
  },
};

const spellDc: Calculator = {
  id: "spell-dc",
  label: "Spell save DC",
  blurb: "The DC a caster sets, and what the ladder calls that number.",
  fields: [
    { key: "abilityScore", label: "Casting ability", kind: "number", min: 1, max: 30 },
    { key: "level", label: "Character level", kind: "number", min: 1, max: 20 },
    { key: "bonus", label: "Other bonus", kind: "number", min: -5, max: 10 },
  ],
  defaults: { abilityScore: 16, level: 5, bonus: 0 },
  run(input) {
    const score = int(input, "abilityScore", 16, 1, 30);
    const level = int(input, "level", 5, 1, 20);
    const bonus = int(input, "bonus", 0, -5, 10);
    const modifier = Math.floor((score - 10) / 2);
    // Proficiency by level is the one line of 5e arithmetic with no home of
    // its own in src/lib/srd, and it is a closed form rather than a table.
    const proficiency = 2 + Math.floor((level - 1) / 4);
    const dc = 8 + proficiency + modifier + bonus;
    const attack = proficiency + modifier + bonus;
    return {
      headline: `DC ${dc}`,
      parts: [
        {
          label: "Ability modifier",
          value: signed(modifier),
          detail: `a score of ${score}`,
        },
        {
          label: "Proficiency",
          value: signed(proficiency),
          detail: `level ${level}`,
        },
        {
          label: "Spell attack",
          value: signed(attack),
          detail: "The same parts without the 8",
        },
        {
          label: "On the ladder",
          value: DIFFICULTY_LABELS[difficultyOfDc(dc)] ?? "",
          detail: "Where this DC sits on the DMG difficulty table",
        },
      ],
      note: bonus ? undefined : "Other bonus covers a Rod of the Pact Keeper, a cloak, a feat.",
    };
  },
};

const SIZE_OPTIONS = [
  { value: "tiny", label: "Tiny" },
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "huge", label: "Huge" },
  { value: "gargantuan", label: "Gargantuan" },
] as const;

const carryingCapacity: Calculator = {
  id: "carrying",
  label: "Carrying capacity",
  blurb: "What a character can carry before the variant rule bites.",
  fields: [
    { key: "strength", label: "Strength", kind: "number", min: 1, max: 30 },
    { key: "size", label: "Size", kind: "choice", options: SIZE_OPTIONS },
    { key: "coins", label: "Coins carried", kind: "number", min: 0, max: 100000 },
  ],
  defaults: { strength: 14, size: "medium", coins: 0 },
  run(input) {
    const strength = int(input, "strength", 14, 1, 30);
    const size = String(input.size ?? "medium");
    const coins = int(input, "coins", 0, 0, 100000);
    // The same three lines encumbranceFor derives, without inventing a pack
    // to weigh: this calculator answers "how much CAN they", not "how much
    // ARE they", so it reports the ceilings rather than a tier.
    const multiplier = carryMultiplier(size);
    const capacity = strength * 15 * multiplier;
    const encumbered = strength * 5 * multiplier;
    const heavily = strength * 10 * multiplier;
    const coinWeight = Math.round((coins / COINS_PER_POUND) * 100) / 100;
    return {
      headline: `${capacity} lb`,
      parts: [
        {
          label: "Encumbered past",
          value: `${encumbered} lb`,
          detail: "Speed drops by 10 feet",
        },
        {
          label: "Heavily encumbered past",
          value: `${heavily} lb`,
          detail: "Speed drops by 20 feet, disadvantage on STR, DEX and CON rolls",
        },
        {
          label: "Push, drag or lift",
          value: `${capacity * 2} lb`,
          detail: "Twice the carrying capacity, at half speed",
        },
        {
          label: "Coins",
          value: `${coinWeight} lb`,
          detail: `${coins.toLocaleString()} coins at ${COINS_PER_POUND} to the pound`,
        },
      ],
      note:
        multiplier === 1
          ? "The encumbered thresholds only apply at tables running the optional encumbrance rule. The capacity ceiling always does."
          : `A ${size} body carries x${multiplier} what a Medium one does.`,
    };
  },
};

export const CALCULATORS: ReadonlyArray<Calculator> = [
  encounterBudget,
  treasureByCr,
  travelTime,
  spellDc,
  carryingCapacity,
];

export function calculatorById(id: string): Calculator | null {
  return CALCULATORS.find((calculator) => calculator.id === id) ?? null;
}

export function runCalculator(id: string, input: CalcInput): CalcResult | { error: string } {
  const calculator = calculatorById(id);
  if (!calculator) {
    return { error: `There is no "${id}" calculator.` };
  }
  return calculator.run(input);
}
