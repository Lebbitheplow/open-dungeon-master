import { forecastAttack, roundsToDrop, averageOf } from "@/lib/srd/odds";
import {
  encounterMultiplier,
  evaluateEncounter,
  thresholdsForParty,
  xpForCr,
  type EncounterVerdict,
  type XpThresholds,
} from "@/lib/srd/encounter-math";
import { effectiveHp, crLabel } from "@/lib/bestiary/derive-cr";
import type { EnemyStats } from "@/lib/bestiary/statblock";

// The encounter workbench: what a roster costs, and what it is likely to do.
//
// The XP half is the DMG's budget, which the engine already enforces. The
// other half is the question the budget cannot answer, and the one a DM
// actually asks: how long will this take, and is anybody going to die. That
// is attrition, and it is arithmetic the codebase already owns
// (src/lib/srd/odds.ts) pointed at both sides of the fight at once.
//
// Every number carries its parts. A difficulty rating a DM cannot audit is a
// rating they will not trust, and the ones that matter are the ones that
// disagree with their instinct, which is exactly when they need to see the
// working.
//
// Pure: no DB, no dice, no model. The rim that fetches the roster is the
// workbench route.

export type WorkbenchPart = {
  label: string;
  value: string;
  detail: string;
};

// ---- the stand-in party ----

// What one adventurer of a given level is, mechanically, for the purpose of
// estimating a fight. Every row is an ASSUMPTION, and the panel shows it and
// lets a DM overwrite it, because the honest thing about a baseline is not
// its accuracy but its visibility.
//
// Hit points are a d8-or-d10 hit die with a decent Constitution. Armour class
// tracks the tiers a real party actually reaches. The attack is a damage
// dealer's: a maxed primary stat and the Extra Attack ladder, expressed as
// dice rather than a flat number so the crit rules apply to it the same way
// they apply to the monsters (src/lib/dm/encounter-logic.ts owns what a crit
// is; nothing here reimplements it).
export type PartyBaseline = {
  hp: number;
  ac: number;
  attackBonus: number;
  attacks: number;
  damage: string;
};

export const PARTY_BASELINE: readonly PartyBaseline[] = [
  { hp: 11, ac: 14, attackBonus: 5, attacks: 1, damage: "2d6+3" },
  { hp: 18, ac: 14, attackBonus: 5, attacks: 1, damage: "2d6+4" },
  { hp: 25, ac: 15, attackBonus: 5, attacks: 1, damage: "2d6+5" },
  { hp: 32, ac: 15, attackBonus: 6, attacks: 1, damage: "3d6+5" },
  { hp: 39, ac: 16, attackBonus: 7, attacks: 2, damage: "2d6+4" },
  { hp: 46, ac: 16, attackBonus: 7, attacks: 2, damage: "2d6+5" },
  { hp: 53, ac: 16, attackBonus: 7, attacks: 2, damage: "3d6+4" },
  { hp: 60, ac: 17, attackBonus: 8, attacks: 2, damage: "3d6+5" },
  { hp: 67, ac: 17, attackBonus: 8, attacks: 2, damage: "3d6+6" },
  { hp: 74, ac: 17, attackBonus: 8, attacks: 2, damage: "4d6+5" },
  { hp: 81, ac: 18, attackBonus: 9, attacks: 3, damage: "3d6+5" },
  { hp: 88, ac: 18, attackBonus: 9, attacks: 3, damage: "3d6+5" },
  { hp: 95, ac: 18, attackBonus: 9, attacks: 3, damage: "3d6+6" },
  { hp: 102, ac: 18, attackBonus: 10, attacks: 3, damage: "4d6+5" },
  { hp: 109, ac: 19, attackBonus: 10, attacks: 3, damage: "4d6+5" },
  { hp: 116, ac: 19, attackBonus: 10, attacks: 3, damage: "4d6+6" },
  { hp: 123, ac: 19, attackBonus: 11, attacks: 4, damage: "3d6+6" },
  { hp: 130, ac: 19, attackBonus: 11, attacks: 4, damage: "4d6+5" },
  { hp: 137, ac: 20, attackBonus: 11, attacks: 4, damage: "4d6+5" },
  { hp: 145, ac: 20, attackBonus: 12, attacks: 4, damage: "4d6+6" },
];

export function baselineFor(level: number): PartyBaseline {
  return PARTY_BASELINE[Math.min(20, Math.max(1, Math.round(level))) - 1];
}

export type VariantRules = { powerfulCritical?: boolean; multiplyNumeric?: boolean };

export type WorkbenchRosterEntry = {
  name: string;
  count: number;
  stats: EnemyStats;
};

export type WorkbenchInput = {
  // One level per character, the shape encounter-math already takes.
  partyLevels: number[];
  roster: WorkbenchRosterEntry[];
  variantRules?: VariantRules;
  // The DMG ceiling this campaign refuses fights above.
  ceiling?: number;
};

// ---- the budget ----

export type BudgetReadout = {
  totalXp: number;
  adjustedXp: number;
  multiplier: number;
  monsterCount: number;
  thresholds: XpThresholds;
  verdict: EncounterVerdict;
  overCeiling: boolean;
  parts: WorkbenchPart[];
};

function budget(input: WorkbenchInput): BudgetReadout {
  const crs = input.roster.flatMap((entry) =>
    Array.from({ length: entry.count }, () => entry.stats.cr),
  );
  const evaluation = evaluateEncounter(input.partyLevels, crs);
  const multiplier = encounterMultiplier(crs.length, input.partyLevels.length);
  const thresholds = thresholdsForParty(input.partyLevels);
  const sizeNote =
    input.partyLevels.length < 3
      ? " A party of one or two feels a pack one band harder, so the multiplier is a step up."
      : input.partyLevels.length > 5
        ? " A party of six or more feels a pack one band easier, so the multiplier is a step down."
        : "";
  return {
    totalXp: evaluation.totalXp,
    adjustedXp: evaluation.adjustedXp,
    multiplier,
    monsterCount: crs.length,
    thresholds,
    verdict: evaluation.verdict,
    overCeiling: input.ceiling !== undefined && evaluation.adjustedXp > input.ceiling,
    parts: [
      {
        label: "Raw XP",
        value: String(evaluation.totalXp),
        detail: input.roster
          .map(
            (entry) =>
              `${entry.count} x ${entry.name} at CR ${crLabel(entry.stats.cr)} is ${
                entry.count * xpForCr(entry.stats.cr)
              }`,
          )
          .join("; "),
      },
      {
        label: "Group multiplier",
        value: `x${multiplier}`,
        detail: `${crs.length} creature${crs.length === 1 ? "" : "s"} against ${
          input.partyLevels.length
        } character${input.partyLevels.length === 1 ? "" : "s"}.${sizeNote}`,
      },
      {
        label: "Adjusted XP",
        value: String(evaluation.adjustedXp),
        detail: `${evaluation.totalXp} x ${multiplier}. The thresholds for this party are ${thresholds.easy} easy, ${thresholds.medium} medium, ${thresholds.hard} hard, ${thresholds.deadly} deadly.`,
      },
    ],
  };
}

// ---- attrition ----

export type SideForecast = {
  // Total hit points on this side, after resistances are priced in.
  hitPoints: number;
  damagePerRound: number;
  // Rounds to remove the other side entirely, or null when nothing lands.
  rounds: number | null;
  parts: WorkbenchPart[];
};

export type AttritionReadout = {
  party: SideForecast;
  monsters: SideForecast;
  // The side that runs out first, and by how much.
  outcome: string;
  warnings: string[];
};

// The party's swings against the roster's average armour class. Real dice
// expressions on both sides, through the same forecast the odds panel uses,
// so the optional crit rules move these numbers exactly as far as they will
// move them at the table.
function partySide(
  input: WorkbenchInput,
  monsterAc: number,
  monsterHp: number,
): SideForecast {
  const rules = input.variantRules ?? {};
  let damagePerRound = 0;
  const lines: string[] = [];
  for (const level of input.partyLevels) {
    const baseline = baselineFor(level);
    const forecast = forecastAttack({
      attackBonus: baseline.attackBonus,
      ac: monsterAc,
      damage: baseline.damage,
      variantRules: rules,
    });
    const perCharacter = forecast.perAttack * baseline.attacks;
    damagePerRound += perCharacter;
    lines.push(
      `level ${level}: ${baseline.attacks} x ${baseline.damage} at +${
        baseline.attackBonus
      } is ${perCharacter.toFixed(1)}`,
    );
  }
  const hitPoints = input.partyLevels.reduce((total, level) => total + baselineFor(level).hp, 0);
  return {
    hitPoints,
    damagePerRound,
    rounds: roundsToDrop(monsterHp, damagePerRound),
    parts: [
      {
        label: "Party output",
        value: `${damagePerRound.toFixed(1)} a round`,
        detail: `${lines.join("; ")}. Misses and crits are already counted, against the roster's average AC ${monsterAc}.`,
      },
      {
        label: "Party hit points",
        value: String(hitPoints),
        detail: `The baseline for ${input.partyLevels.length} character${
          input.partyLevels.length === 1 ? "" : "s"
        } at ${[...new Set(input.partyLevels)].sort((a, b) => a - b).join(", ")}.`,
      },
    ],
  };
}

// The roster's swings against the party's average armour class, read the way
// the engine runs a monster's turn: its best attack, swung as many times as
// its multiattack allows, capped at three.
function monsterSide(
  input: WorkbenchInput,
  partyAc: number,
  partyHp: number,
): { forecast: SideForecast; averageAc: number; hitPoints: number; warnings: string[] } {
  const rules = input.variantRules ?? {};
  const warnings: string[] = [];
  let hitPoints = 0;
  let acWeighted = 0;
  let bodies = 0;
  let damagePerRound = 0;
  const lines: string[] = [];

  for (const entry of input.roster) {
    // The same toughness the rating was derived from, so the fight and the
    // difficulty number agree about how hard this thing is to kill.
    const tough = effectiveHp(entry.stats, entry.stats.cr);
    hitPoints += tough.hp * entry.count;
    acWeighted += entry.stats.ac * entry.count;
    bodies += entry.count;

    const attacks = entry.stats.attacks ?? [];
    if (!attacks.length) {
      warnings.push(`${entry.name} has no attacks, so it contributes no damage to this estimate.`);
      continue;
    }
    let best = attacks[0];
    let bestAverage = averageOf(best.damage);
    for (const attack of attacks.slice(1)) {
      const average = averageOf(attack.damage);
      if (average > bestAverage) {
        best = attack;
        bestAverage = average;
      }
    }
    const swings = Math.max(1, Math.min(3, entry.stats.attacksPerTurn ?? 1));
    const forecast = forecastAttack({
      attackBonus: best.toHit,
      ac: partyAc,
      damage: best.damage,
      variantRules: rules,
    });
    const perBody = forecast.perAttack * swings;
    damagePerRound += perBody * entry.count;
    lines.push(
      `${entry.count} x ${entry.name}: ${swings} x ${best.damage} at +${best.toHit} is ${(
        perBody * entry.count
      ).toFixed(1)}`,
    );
    if ((entry.stats.traits ?? []).some((trait) => /\d+d\d+/.test(trait))) {
      warnings.push(
        `${entry.name} has dice in its traits (a breath weapon or similar) that this estimate does not count. It hits harder than the number says.`,
      );
    }
  }

  const averageAc = bodies ? Math.round(acWeighted / bodies) : 12;
  return {
    forecast: {
      hitPoints,
      damagePerRound,
      rounds: roundsToDrop(partyHp, damagePerRound),
      parts: [
        {
          label: "Roster output",
          value: `${damagePerRound.toFixed(1)} a round`,
          detail: lines.length
            ? `${lines.join("; ")}. Against the party's baseline AC ${partyAc}, misses and crits counted.`
            : "Nothing on this roster has an attack.",
        },
        {
          label: "Roster hit points",
          value: String(hitPoints),
          detail: input.roster
            .map((entry) => {
              const tough = effectiveHp(entry.stats, entry.stats.cr);
              return `${entry.count} x ${entry.stats.maxHp}${
                tough.multiplier !== 1 ? ` at x${tough.multiplier} for what it shrugs off` : ""
              }`;
            })
            .join("; "),
        },
      ],
    },
    averageAc,
    hitPoints,
    warnings,
  };
}

// ---- the whole readout ----

export type WorkbenchReadout = {
  budget: BudgetReadout;
  attrition: AttritionReadout;
};

export function workbench(input: WorkbenchInput): WorkbenchReadout {
  const partyAc = Math.round(
    input.partyLevels.reduce((total, level) => total + baselineFor(level).ac, 0) /
      Math.max(1, input.partyLevels.length),
  );
  const partyHp = input.partyLevels.reduce((total, level) => total + baselineFor(level).hp, 0);

  // The two sides need each other's armour class, so the roster is measured
  // first (its AC does not depend on the party) and the party second.
  const monsters = monsterSide(input, partyAc, partyHp);
  const party = partySide(input, monsters.averageAc, monsters.hitPoints);

  const warnings = [...monsters.warnings];
  const partyRounds = party.rounds;
  const monsterRounds = monsters.forecast.rounds;
  let outcome: string;
  if (partyRounds === null) {
    outcome = "The party cannot get through this, on these numbers.";
  } else if (monsterRounds === null) {
    outcome = `The party clears this in about ${partyRounds} round${
      partyRounds === 1 ? "" : "s"
    } and takes nothing back.`;
  } else if (partyRounds < monsterRounds) {
    const margin = monsterRounds - partyRounds;
    outcome = `The party clears this in about ${partyRounds} round${
      partyRounds === 1 ? "" : "s"
    }, with roughly ${margin} round${margin === 1 ? "" : "s"} of margin.`;
  } else {
    outcome = `On these numbers the roster drops the party first, in about ${monsterRounds} round${
      monsterRounds === 1 ? "" : "s"
    } against the party's ${partyRounds}.`;
  }

  // Both sides are assumed to concentrate fire and nobody heals, retreats or
  // uses a spell slot. Said out loud, because it is why a real fight of this
  // shape usually goes better for the party than the number does.
  warnings.push(
    "Both sides are swinging every round with nobody healing, hiding or running. A real fight of this shape usually goes a round or two longer.",
  );
  if (partyRounds !== null && partyRounds <= 1) {
    warnings.push("One round is not a fight. This roster will be gone before it acts twice.");
  }

  return {
    budget: budget(input),
    attrition: { party, monsters: monsters.forecast, outcome, warnings },
  };
}
