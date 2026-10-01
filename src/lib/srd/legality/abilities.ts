// Are these six ability scores ones a character could have?
//
// SRD 5.1: scores come from the standard array, a 27 point buy, or six throws
// of 4d6 with the lowest die dropped; the race's increase is added after; an
// Ability Score Improvement adds two points and never takes a score past 20.
// So the check works backwards: take off the race's increase and the
// improvements on record, and what is left must be something one of the
// three methods gives.
import {
  ABILITIES,
  type Ability,
  type AbilityScores,
  type AsiChoice,
} from "@/lib/schemas/sheet";
import { ABILITY_SCORE_CAP } from "@/lib/srd/asi";
import { POINT_BUY_BUDGET, POINT_BUY_MAX, POINT_BUY_MIN, pointBuyCost } from "@/lib/srd/point-buy";
import { ABILITY_NAMES } from "@/lib/srd/legality/types";

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const ROLL_MIN = 3;
export const ROLL_MAX = 18;

export type AbilityCheck = {
  scores: AbilityScores;
  // The race's increase, fixed and chosen, per ability.
  racial: Partial<Record<Ability, number>>;
  // Improvements the sheet records, already inside `scores`.
  recorded: AsiChoice[];
  // Half-feat points already inside `scores`, one ability per point (a
  // stored sheet's Actor or Resilient; src/lib/srd/legality/half-feats.ts).
  halfFeats?: Ability[];
  // Points that improvements taken in play may account for: two for every
  // improvement the character has earned and the sheet does not record.
  freePoints: number;
  // "method": held to the array, the point buy or a pool the server rolled.
  // "bounds": held to what the dice can give, for a character whose dice
  // were thrown somewhere this server cannot see.
  mode: "method" | "bounds";
  // Pools of six the base scores may be: the server's roll for this player,
  // the stored character's own scores on an edit.
  pools: number[][];
  // Points a feature adds to a score and the cap it lifts by as much:
  // Primal Champion's +4 STR and CON, to 24 (src/lib/srd/trait-rules.ts).
  // A sheet from before the feature was applied may not hold them yet, so
  // the base is a span that allows either.
  grants?: Partial<Record<Ability, number>>;
};

type Span = { lo: number; hi: number };

function recordedPoints(recorded: AsiChoice[]): Record<Ability, number> {
  const points = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  for (const choice of recorded) {
    if (choice.mode === "plus2") {
      points[choice.ability] += 2;
    } else if (choice.mode === "plus1x2") {
      for (const ability of choice.abilities) {
        points[ability] += 1;
      }
    }
  }
  return points;
}

// What each score was before the race and the recorded improvements. A
// score sitting on the cap may have lost points to it, so its base is a span.
export function baseSpans(check: AbilityCheck): Record<Ability, Span> {
  const improved = recordedPoints(check.recorded);
  for (const ability of check.halfFeats ?? []) {
    improved[ability] += 1;
  }
  const spans = {} as Record<Ability, Span>;
  for (const ability of ABILITIES) {
    const granted = check.grants?.[ability] ?? 0;
    const lo = check.scores[ability] - (check.racial[ability] ?? 0) - improved[ability] - granted;
    const lost = check.scores[ability] >= ABILITY_SCORE_CAP ? improved[ability] : 0;
    spans[ability] = { lo, hi: lo + lost + granted };
  }
  return spans;
}

function permutations(values: number[]): number[][] {
  if (values.length <= 1) {
    return [values];
  }
  const out: number[][] = [];
  const seen = new Set<number>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    const rest = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const tail of permutations(rest)) {
      out.push([value, ...tail]);
    }
  });
  return out;
}

// Whether six given numbers, placed in some order, explain the spans with no
// more than `freePoints` added on top.
function fitsPool(pool: number[], spans: Span[], freePoints: number): boolean {
  if (pool.length !== spans.length) {
    return false;
  }
  return permutations(pool).some((placed) => {
    let added = 0;
    for (let index = 0; index < spans.length; index += 1) {
      if (placed[index] > spans[index].hi) {
        return false;
      }
      added += Math.max(0, spans[index].lo - placed[index]);
    }
    return added <= freePoints;
  });
}

function fitsPointBuy(spans: Span[], freePoints: number): boolean {
  const search = (index: number, spent: number, added: number): boolean => {
    if (spent > POINT_BUY_BUDGET || added > freePoints) {
      return false;
    }
    if (index === spans.length) {
      return true;
    }
    const top = Math.min(POINT_BUY_MAX, spans[index].hi);
    // The dearest score first: it needs the fewest added points.
    for (let score = top; score >= POINT_BUY_MIN; score -= 1) {
      const needs = Math.max(0, spans[index].lo - score);
      if (search(index + 1, spent + pointBuyCost(score), added + needs)) {
        return true;
      }
    }
    return false;
  };
  return search(0, 0, 0);
}

function fitsBounds(spans: Span[], freePoints: number): boolean {
  let added = 0;
  for (const span of spans) {
    if (span.hi < ROLL_MIN) {
      return false;
    }
    added += Math.max(0, span.lo - ROLL_MAX);
  }
  return added <= freePoints;
}

export function abilityProblems(check: AbilityCheck): string[] {
  const problems: string[] = [];
  for (const ability of ABILITIES) {
    const cap = ABILITY_SCORE_CAP + (check.grants?.[ability] ?? 0);
    if (check.scores[ability] > cap) {
      problems.push(
        `${ABILITY_NAMES[ability]} is ${check.scores[ability]}; no score passes ${cap} without a feature or an item that says so. Lower it to ${cap} or less.`,
      );
    }
  }
  if (problems.length) {
    return problems;
  }
  const spans = baseSpans(check);
  const ordered = ABILITIES.map((ability) => spans[ability]);
  const written = ABILITIES.map((ability) => spans[ability].lo).join(", ");
  if (check.mode === "bounds") {
    if (!fitsBounds(ordered, check.freePoints)) {
      problems.push(
        `Before the race's increase and the improvements earned, the ability scores are ${written}. No method gives a score under ${ROLL_MIN} or over ${ROLL_MAX}; bring each inside that range.`,
      );
    }
    return problems;
  }
  const fits =
    fitsPool(STANDARD_ARRAY, ordered, check.freePoints) ||
    check.pools.some((pool) => fitsPool(pool, ordered, check.freePoints)) ||
    fitsPointBuy(ordered, check.freePoints);
  if (!fits) {
    problems.push(
      `Before the race's increase the ability scores are ${written}. They must be the standard array (${STANDARD_ARRAY.join(", ")}), a ${POINT_BUY_BUDGET} point buy of scores from ${POINT_BUY_MIN} to ${POINT_BUY_MAX}, or the six totals the server rolled for this character.`,
    );
  }
  return problems;
}
