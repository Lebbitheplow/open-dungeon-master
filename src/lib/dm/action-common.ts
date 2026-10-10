// Small pieces the action handlers share: a condition written onto a sheet
// with its duration, and an enemy's side of a contest rolled from its stat
// block. Split from action-tools.ts so the grapple, object and reaction
// modules can use them without importing the take_action handler.

import { enemyExhaustion } from "@/lib/dm/monster-abilities";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { insertRoll } from "@/lib/db/rolls";
import { patchSheet } from "@/lib/db/sheets";
import type { DmTurn } from "@/lib/db/dm-turns";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { abilityMod } from "@/lib/srd";
import { saveModFor } from "@/lib/bestiary/statblock";
import { mergeAdvantage, rollDerivation } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Adds a condition to a sheet without disturbing the ones already there. It
// lasts a count of rounds, or until the start of the named combatant's next
// turn, which is how Dodge, Help, Shield and the Protection style are worded.
// `source` records who or what the condition is about (the creature a Help
// is against, a readied trigger).
export function addSheetCondition(
  campaign: Campaign,
  sheet: CharacterSheet,
  condition: string,
  lasts: { rounds: number } | { untilTurnOf: string } | { untilTurnEndOf: string },
  source?: string,
) {
  if (sheet.conditions.some((entry) => entry.toLowerCase() === condition)) {
    return;
  }
  const meta = { ...lasts, ...(source?.trim() ? { source: source.trim().slice(0, 80) } : {}) };
  const updated = patchSheet(sheet.id, {
    conditions: [...sheet.conditions, condition],
    conditionMeta: { ...sheet.conditionMeta, [condition]: meta },
  });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// What an enemy contests a grapple, a shove or an escape with. `either`:
// the better of Strength (Athletics) and Dexterity (Acrobatics), which is
// the defender's choice against a grapple or shove and the escaper's own
// choice; `athletics`: Strength (Athletics) only, which is what a grappler
// holds an escape with. A printed skill bonus when the stat block has one,
// the bare ability modifier otherwise; a block with no ability scores (an
// old snapshot) falls back to its save modifiers.
export function contestModifier(
  stats: EncounterEnemy["stats"],
  which: "either" | "athletics" = "either",
): number {
  const skills = stats.skills ?? {};
  const bare = (ability: "str" | "dex") =>
    stats.abilities?.[ability] !== undefined
      ? abilityMod(stats.abilities[ability])
      : saveModFor(stats, ability);
  const athletics = skills.athletics ?? bare("str");
  return which === "athletics"
    ? athletics
    : Math.max(athletics, skills.acrobatics ?? bare("dex"));
}

// An enemy's side of a contest: the d20 with the modifier above, under the
// conditions that put its ability checks at disadvantage, stored and
// published as a dice card.
export function rollEnemyContest(
  campaign: Campaign,
  turn: DmTurn,
  enemy: EncounterEnemy,
  which: "either" | "athletics",
  detail: string,
): number {
  const worn = enemyExhaustion(enemy.conditions) >= 1;
  const advantage = mergeAdvantage([rollDerivation(enemy.conditions, "skill_check", "str").advantage, ...(worn ? ["disadvantage" as const] : [])]);
  const outcome = rollExpression(d20Expression(contestModifier(enemy.stats, which), advantage));
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: null,
    requestedBy: "dm",
    kind: "skill_check",
    detail,
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
  turn.rollIds.push(roll.id);
  return outcome.total;
}

// A die the engine rolled inside a tool, as a dice card (src/lib/dm/roll-card.ts).
export { rollCard } from "@/lib/dm/roll-card";
