// What the exploration rules say about a check before it is rolled: whether
// the party's march allows it at all, and what it must beat when a creature
// contests it. request_roll (src/lib/dm/invoke-roll.ts), group_check and
// check_notice (src/lib/dm/check-tools.ts) ask here.
//
// SRD 5.1, Travel Pace: only a slow pace makes it possible to use stealth;
// a normal or fast pace does not.
// SRD 5.1, Contests: both sides make the check appropriate to their effort
// and compare totals; the higher wins, and a tie leaves the situation as it
// was. A monster's check uses its stat block: a skill it lists, else the
// ability's modifier. A character fighting on the other side (issue 503)
// makes the check as the character it is, the roll any check of theirs is
// (contest-roll.ts rollCharacterCheck: proficiency and expertise, its
// advantage and conditions, its features and effects).

import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { isSheetFoe } from "@/lib/dm/combat-sides-logic";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { charmedBy } from "@/lib/dm/enemy-profile";
import { getSheetById } from "@/lib/db/sheets";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { enemyExhaustion } from "@/lib/dm/monster-abilities";
import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import { getClock } from "@/lib/db/clock";
import { getActiveEncounter, type EncounterEnemy } from "@/lib/db/encounters";
import { insertRoll } from "@/lib/db/rolls";
import type { DmTurn } from "@/lib/db/dm-turns";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { resolveMonster } from "@/lib/bestiary";
import type { EnemyStats, SaveAbility } from "@/lib/bestiary/statblock";
import { mergeAdvantage, rollDerivation } from "@/lib/dm/condition-logic";
import { unknownEnemyRef } from "@/lib/dm/enemy-damage";
import { effectOutcome } from "@/lib/dm/effect-tools";
import { redactRoll } from "@/lib/dm/viewer";
import { findSkill } from "@/lib/srd";
import type { ToolError } from "@/lib/dm/tool-errors";

// The check a creature makes against a character's, by the character's
// skill: a lie is met by Insight, a sneak by Perception, a shove by
// Athletics. The character's own skill when nothing pairs better.
const OPPOSED: Record<string, string> = {
  deception: "insight",
  persuasion: "insight",
  intimidation: "insight",
  performance: "insight",
  stealth: "perception",
  sleight_of_hand: "perception",
  insight: "deception",
  perception: "stealth",
  investigation: "stealth",
  athletics: "athletics",
  acrobatics: "athletics",
};

// Skills with which a character answers what a creature is trying: noticing
// its hiding, seeing through its lie. The creature is the one acting, so a
// tie (nothing changes) goes the character's way.
const ANSWERING = new Set(["insight", "perception", "investigation"]);

const skillId = (text: string | undefined) => (text ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

// Whether the party's march forbids stealth right now: a normal or fast
// pace on the clock, and no fight running. The refusal sentence, or null.
export function marchStealthProblem(campaignId: string, skill: string | undefined): ToolError | null {
  if (skillId(skill) !== "stealth") {
    return null;
  }
  const pace = getClock(campaignId).travelPace;
  if (!pace || pace === "slow" || getActiveEncounter(campaignId)) {
    return null;
  }
  return { error: `The party is marching at a ${pace} pace, which leaves no room for stealth (SRD 5.1, Travel Pace). Travel at a slow pace to move stealthily, or let the march end (pass_time or a rest) before the Stealth check.`, refused: "rules" };
}

// A creature's modifier for a check: the skill its block lists, else the
// ability's modifier.
export function creatureCheckMod(stats: EnemyStats, skill: string | null, ability: SaveAbility): number {
  if (skill) {
    const listed = stats.skills?.[skill.replace(/_/g, " ")] ?? stats.skills?.[skill];
    if (typeof listed === "number") {
      return listed;
    }
  }
  const score = stats.abilities?.[ability];
  if (typeof score === "number") {
    return Math.floor((score - 10) / 2);
  }
  return ability === "dex" ? stats.dexMod ?? 0 : 0;
}

export type Opponent = { name: string; stats: EnemyStats; conditions: string[]; enemyId?: string; sheetId?: string };

// The creature a contest names: an enemy of the running fight, or a monster
// by name from the bestiary when there is no fight to find it in.
export function contestOpponent(
  campaign: Campaign,
  ref: { enemyId?: string; monster?: string },
): Opponent | ToolError {
  if (ref.enemyId) {
    const encounter = getActiveEncounter(campaign.id);
    const enemy: EncounterEnemy | null = encounter ? resolveTargetFoe(encounter.campaignId, encounter, ref.enemyId) : null;
    if (!enemy) {
      return encounter
        ? unknownEnemyRef(encounter.id, "againstEnemyId", ref.enemyId, "Out of a fight, send againstMonster with the creature's name.")
        : { error: "No fight is running: againstEnemyId names an enemy of a fight. Out of one, send againstMonster with the creature's name.", retry: true };
    }
    if (enemy.status !== "alive") {
      return { error: `${enemy.displayName} is ${enemy.status} and contests nothing.`, retry: true };
    }
    return { name: enemy.displayName, stats: enemy.stats, conditions: enemy.conditions, enemyId: enemy.id, ...(isSheetFoe(enemy) ? { sheetId: enemy.id } : {}) };
  }
  const monster = resolveMonster(ref.monster ?? "", campaign.gameSettings, { userIds: spellAuthorsFor(campaign) });
  if (!monster) {
    return { error: `No stat block for "${ref.monster ?? ""}"; name a monster the bestiary knows (an SRD creature, or an NPC stat block such as guard, noble or spy).`, retry: true };
  }
  return { name: monster.reskinName ?? monster.baseName, stats: monster.stats, conditions: [] };
}

export type ContestRoll = { name: string; skill: string; total: number; dc: number; answering: boolean };

// The character a contest is against, as charm reads them.
export type Charmable = { name: string; conditions: string[]; conditionMeta?: unknown };
type CharmMeta = Parameters<typeof charmedBy>[1];

// Rolls the opponent's side of a contest and returns the DC the character's
// check must reach: the opponent's total, plus one when the character is
// the one trying to change things (a tie leaves them as they were).
export function rollContest(
  campaign: Campaign,
  turn: DmTurn | null,
  opponent: Opponent,
  // `roller`: the character on the other side of the contest, whose charm
  // by the opponent gives the opponent's social check advantage.
  input: { skill?: string; ability?: SaveAbility; contestSkill?: string; hiding?: boolean; roller?: Charmable | null },
): ContestRoll {
  const mine = skillId(input.skill) || null;
  const theirs = skillId(input.contestSkill) || (input.hiding ? "stealth" : mine ? OPPOSED[mine] ?? mine : null);
  const ability = ((theirs ? findSkill(theirs)?.ability : null) ?? input.ability ?? "str") as SaveAbility;
  const label = theirs ? (findSkill(theirs)?.name ?? theirs) : ability.toUpperCase();
  const answering = input.hiding ? true : mine ? ANSWERING.has(mine) : false;
  // "The charmer has advantage on any ability check to interact socially
  // with the creature" (SRD 5.1, Charmed): the opponent's Charisma side of
  // the contest, when it charmed the character it contests. Before, only
  // the character's own check against a creature they charmed counted.
  const opponentRef = opponent.sheetId ?? opponent.enemyId;
  const charmer = Boolean(input.roller && opponentRef && charmedBy(input.roller.conditions, input.roller.conditionMeta as CharmMeta, opponentRef));
  const asSheet = opponent.sheetId ? getSheetById(opponent.sheetId) : null;
  if (asSheet) {
    const checked = rollCharacterCheck(
      campaign,
      asSheet,
      { ...(theirs ? { skill: theirs } : { ability }), ...(charmer && input.roller ? { charmedTarget: input.roller.name } : {}) },
      `${opponent.name}: ${label} (contest)`,
    );
    if (checked.rollId) {
      turn?.rollIds.push(checked.rollId);
    }
    const total = checked.autoFailed ? 0 : checked.total;
    return { name: opponent.name, skill: label, total, dc: Math.max(1, answering ? total : total + 1), answering };
  }
  const derivation = rollDerivation(opponent.conditions, "skill_check", ability);
  // Exhaustion's first level costs every ability check disadvantage, a
  // creature's as a character's (src/lib/dm/monster-abilities.ts).
  const worn = enemyExhaustion(opponent.conditions) >= 1;
  // A check effect set on an enemy of the fight (set_effect) rides its side.
  const effect = opponent.enemyId ? effectOutcome(campaign.id, { kind: "enemy", id: opponent.enemyId }, "check") : null;
  const advantage = mergeAdvantage([
    ...derivation.sources,
    ...(charmer && ability === "cha" ? ["advantage" as const] : []),
    ...(worn ? ["disadvantage" as const] : []),
    ...(effect?.advantage ? ["advantage" as const] : []),
    ...(effect?.disadvantage ? ["disadvantage" as const] : []),
  ]);
  const modifier = creatureCheckMod(opponent.stats, theirs, ability) + (effect?.bonus ?? 0);
  const outcome = derivation.autoFail ? null : rollExpression(d20Expression(modifier, advantage));
  const total = outcome?.total ?? 0;
  if (outcome) {
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: null,
      requestedBy: "dm",
      kind: "skill_check",
      detail: `${opponent.name}: ${label} (contest)`.slice(0, 200),
      ...(advantage === "none" ? {} : { advantage }),
      result: outcome,
      visibility: "dm",
    });
    turn?.rollIds.push(roll.id);
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll: redactRoll(roll), source: "digital" });
  }
  return { name: opponent.name, skill: label, total, dc: Math.max(1, answering ? total : total + 1), answering };
}

// request_roll's gate: a Stealth check refused during a normal or fast
// march, and a contested check given the DC its opponent's roll sets.
export function applyRollGates<A extends {
  kind: string;
  skill?: string;
  ability?: SaveAbility;
  dc?: number;
  againstEnemyId?: string;
  againstMonster?: string;
  contestSkill?: string;
}>(
  campaign: Campaign,
  turn: DmTurn | null,
  args: A,
  // The character rolling, for the charm the opponent may hold over them.
  roller: Charmable | null = null,
): { args: A; contest?: ContestRoll } | ToolError {
  if (args.kind === "skill_check") {
    const marching = marchStealthProblem(campaign.id, args.skill);
    if (marching) {
      return marching;
    }
  }
  if (!args.againstEnemyId && !args.againstMonster) {
    return { args };
  }
  if (args.kind !== "skill_check" && args.kind !== "ability_check") {
    return { error: "A contest is a skill or ability check: send kind skill_check (or ability_check) with againstEnemyId or againstMonster.", retry: true };
  }
  const opponent = contestOpponent(campaign, { enemyId: args.againstEnemyId, monster: args.againstMonster });
  if ("error" in opponent) {
    return opponent;
  }
  const contest = rollContest(campaign, turn, opponent, {
    skill: args.kind === "skill_check" ? args.skill : undefined,
    ability: args.ability,
    contestSkill: args.contestSkill,
    roller,
  });
  return { args: { ...args, dc: contest.dc }, contest };
}
