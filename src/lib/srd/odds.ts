import { expressionDice, rollExpressionWithDice, type Advantage } from "@/lib/dice";
import { critDamageExpression } from "@/lib/dm/encounter-logic";

// Consequence preview: what a plan is actually likely to do, before anyone
// commits to it. Pure math, no model and no dice.
//
// This exists because a human DM makes the calls an AI DM never had to
// explain: is this ogre a fight or an execution, is DC 18 reachable for this
// party, how many rounds does the boss last. The engine already knows; it
// just never told anyone.
//
// The d20 rules here are the two different ones 5e actually has. An ATTACK
// auto-hits on a natural 20 and auto-misses on a natural 1, so its odds are
// never 0% and never 100%. A CHECK or SAVE has no such rule, so a DC far
// enough out of reach is genuinely impossible and the preview says so.

// P(one d20 lands at or above `needed`), with `needed` already clamped by the
// caller to whatever that roll's rules allow.
function singleRoll(needed: number): number {
  return Math.max(0, Math.min(1, (21 - needed) / 20));
}

// Advantage rolls two dice and keeps the better, so it fails only when both
// fail; disadvantage is the mirror.
function withAdvantage(chance: number, advantage: Advantage): number {
  if (advantage === "advantage") {
    return 1 - (1 - chance) ** 2;
  }
  if (advantage === "disadvantage") {
    return chance ** 2;
  }
  return chance;
}

// A check or a save: no natural-20 rule, so this reaches 0 and 1 honestly.
export function checkChance(
  modifier: number,
  dc: number,
  advantage: Advantage = "none",
): number {
  return withAdvantage(singleRoll(dc - modifier), advantage);
}

export type AttackOdds = {
  // Includes crits: this is the chance the attack lands at all.
  hit: number;
  crit: number;
  miss: number;
};

// `critRange` is the lowest natural roll that crits (20 normally, 19 with
// Improved Critical, 18 with Superior).
export function attackOdds(input: {
  attackBonus: number;
  ac: number;
  advantage?: Advantage;
  critRange?: number;
}): AttackOdds {
  const advantage = input.advantage ?? "none";
  const critRange = Math.max(2, Math.min(20, input.critRange ?? 20));
  // A natural 1 always misses and a natural 20 always hits, which is exactly
  // what clamping the needed roll to 2..20 expresses.
  const needed = Math.max(2, Math.min(20, input.ac - input.attackBonus));
  const hit = withAdvantage(singleRoll(needed), advantage);
  const crit = withAdvantage(singleRoll(critRange), advantage);
  return { hit, crit, miss: 1 - hit };
}

// How many dice-value combinations this module will enumerate to get an exact
// average out of a non-linear expression. 2d20kh1 is 400, 4d6kh3 is 1296; a
// pool big enough to blow past this is not something a DM types into a
// preview box.
const ENUMERATION_CAP = 20_000;

// The reroll modifier ("1d20r1", Halfling Lucky) makes the NUMBER of dice
// rolled depend on what they roll, so a fixed list of die values cannot
// reproduce it and enumeration would be quietly wrong.
const HAS_REROLL = /\dr\d/i;

export type ExpressionAverage = {
  average: number;
  // False when the number could not be computed honestly: an unparseable
  // expression, or a non-linear one too large to enumerate. The panel shows
  // nothing rather than a number that is merely plausible.
  exact: boolean;
};

const UNKNOWN: ExpressionAverage = { average: 0, exact: false };

function enumerateAverage(expression: string, faces: number[]): ExpressionAverage {
  const combinations = faces.reduce((product, sides) => product * sides, 1);
  if (combinations > ENUMERATION_CAP) {
    return UNKNOWN;
  }
  const values = faces.map(() => 1);
  let total = 0;
  for (let index = 0; index < combinations; index += 1) {
    total += rollExpressionWithDice(expression, values).total;
    // Odometer over the die faces.
    for (let die = 0; die < values.length; die += 1) {
      if (values[die] < faces[die]) {
        values[die] += 1;
        break;
      }
      values[die] = 1;
    }
  }
  return { average: total / combinations, exact: true };
}

// The average total of a dice expression.
//
// Most expressions are linear in their dice, so the average is the flat part
// plus (sides + 1) / 2 per die. Keep-highest and keep-lowest are not, and the
// linear shortcut is wrong for them by a wide margin: "2d20kh1" averages
// 13.825, and pretending it is 21 would make every number beside it a lie.
// So linearity is TESTED rather than assumed, by scoring the expression with
// every die at its floor and again at its ceiling: if the gap is not exactly
// what the dice could contribute, something is keeping or dropping, and the
// answer comes from enumerating the outcomes instead.
export function averageDetail(expression: string): ExpressionAverage {
  try {
    const faces = expressionDice(expression);
    const floor = rollExpressionWithDice(expression, faces.map(() => 1)).total;
    if (!faces.length) {
      return { average: floor, exact: true };
    }
    const ceiling = rollExpressionWithDice(expression, faces).total;
    const span = faces.reduce((sum, sides) => sum + sides, 0) - faces.length;
    if (ceiling - floor === span) {
      const dice = faces.reduce((sum, sides) => sum + (sides + 1) / 2, 0);
      return { average: floor - faces.length + dice, exact: true };
    }
    if (HAS_REROLL.test(expression)) {
      return UNKNOWN;
    }
    return enumerateAverage(expression, faces);
  } catch {
    return UNKNOWN;
  }
}

export function averageOf(expression: string): number {
  return averageDetail(expression).average;
}

export type DamageForecast = {
  odds: AttackOdds;
  // Average damage on a landed hit, and on a crit.
  onHit: number;
  onCrit: number;
  // Averaged over hits, misses and crits: what one attack is worth.
  perAttack: number;
  // False when the damage expression could not be averaged honestly.
  exact: boolean;
};

export function forecastAttack(input: {
  attackBonus: number;
  ac: number;
  damage: string;
  advantage?: Advantage;
  critRange?: number;
  // Extra dice on a crit: Brutal Critical, Savage Attacks.
  extraCritDice?: number;
  // The table's optional crit rules. Passed through to the engine's own
  // critDamageExpression rather than reimplemented here, so the preview and
  // the roll it predicts can never disagree about what a crit is.
  variantRules?: { powerfulCritical?: boolean; multiplyNumeric?: boolean };
}): DamageForecast {
  const odds = attackOdds(input);
  const hit = averageDetail(input.damage);
  const crit = averageDetail(
    critDamageExpression(input.damage, input.extraCritDice ?? 0, input.variantRules ?? {}),
  );
  const exact = hit.exact && crit.exact;
  // A crit IS a hit, so the only thing it adds on top of what the hit chance
  // already counts is the difference between the two.
  const perAttack = odds.hit * hit.average + odds.crit * (crit.average - hit.average);
  return {
    odds,
    onHit: hit.average,
    onCrit: crit.average,
    perAttack: exact ? perAttack : 0,
    exact,
  };
}

// Rounds of the same output before a pool of hit points is gone. Returns null
// when nothing is getting through, which reads better than Infinity.
export function roundsToDrop(hitPoints: number, perRound: number): number | null {
  if (perRound <= 0) {
    return null;
  }
  return Math.max(1, Math.ceil(hitPoints / perRound));
}

// Percentages for display. One decimal would suggest a precision the
// underlying assumptions do not have.
export function asPercent(chance: number): string {
  return `${Math.round(chance * 100)}%`;
}
