// A check a character makes inside another tool: the Stealth of a Hide, the
// Athletics of a grapple or a shove, the side of a contest the server rolls
// for them. It is built by the same resolver a requested check is
// (src/lib/dm/rolls.ts), so everything that rides a check rides this one
// too: Reliable Talent's floor, Halfling Lucky's reroll, a held Bardic
// Inspiration die (spent by the roll), Guidance, the lasting effects on
// checks, conditions, exhaustion, armor, and the items that ride checks.
// The roll is stored and published like any other.

import { rollCard } from "@/lib/dm/roll-card";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { insertRoll } from "@/lib/db/rolls";
import { getSheetById } from "@/lib/db/sheets";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { rollExtrasFor, spendRollCarriers } from "@/lib/dm/forced-save";
import { resolveRollExpression, type RollArgs } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

export type CharacterCheck = {
  total: number;
  expression: string;
  notes: string[];
  rollId: string | null;
  // Set when a condition decided the check with no die rolled; the total is
  // then the lowest a check can be.
  autoFailed?: boolean;
};

export function rollCharacterCheck(
  campaign: Campaign,
  stale: CharacterSheet,
  check: { skill?: string; ability?: Ability; advantage?: "advantage" | "disadvantage"; dc?: number },
  detail: string,
): CharacterCheck {
  const sheet = getSheetById(stale.id) ?? stale;
  const args = (
    check.skill
      ? { kind: "skill_check", skill: check.skill }
      : { kind: "ability_check", ability: check.ability ?? "str" }
  ) as RollArgs;
  const resolved = resolveRollExpression(
    { ...args, ...(check.advantage ? { advantage: check.advantage } : {}) },
    sheet,
    rollExtrasFor(campaign, sheet, args.kind),
  );
  if ("error" in resolved) {
    // An unknown skill: fall back to the plain ability, never to nothing.
    const outcome = rollCard(campaign, null, sheet.id, check.skill ? "skill_check" : "ability_check", `${detail}: ${check.skill ?? check.ability ?? "check"}`, d20Expression(0, check.advantage ?? "none"), null);
    return { total: outcome.total, expression: "1d20", notes: [resolved.error], rollId: null };
  }
  if ("autoFail" in resolved) {
    return { total: 1, expression: "", notes: resolved.notes, rollId: null, autoFailed: true };
  }
  spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
  const outcome = rollExpression(resolved.expression);
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: check.skill ? "skill_check" : "ability_check",
    detail: `${detail}: ${resolved.detail}`.slice(0, 120),
    ...(check.dc ? { dc: check.dc } : {}),
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll,
    source: "digital",
  });
  return {
    total: outcome.total,
    expression: resolved.expression,
    notes: resolved.conditionNotes ?? [],
    rollId: roll.id,
  };
}

// A saving throw a feature makes the character roll outside any tool that
// holds a DM turn (Relentless Rage inside the damage path, Indomitable's
// reroll): the same resolver and the same record as a forced save.
export function rollFeatureSave(
  campaign: Campaign,
  stale: CharacterSheet,
  ability: Ability,
  dc: number,
  detail: string,
  against?: string,
): { success: boolean; total: number | null; notes: string[] } {
  const sheet = getSheetById(stale.id) ?? stale;
  const args = {
    kind: "saving_throw",
    ability,
    dc,
    ...(against ? { against } : {}),
  } as RollArgs;
  const resolved = resolveRollExpression(args, sheet, rollExtrasFor(campaign, sheet, "saving_throw"));
  if ("error" in resolved) {
    return { success: false, total: null, notes: [resolved.error] };
  }
  if ("autoFail" in resolved) {
    return { success: false, total: null, notes: resolved.notes };
  }
  spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
  const outcome = rollExpression(resolved.expression);
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "saving_throw",
    detail: `${sheet.name}: ${ability.toUpperCase()} save, ${detail}`.slice(0, 120),
    dc,
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll,
    source: "digital",
  });
  return { success: outcome.total >= dc, total: outcome.total, notes: resolved.conditionNotes ?? [] };
}

// A character's initiative as request_roll would build it (src/lib/dm/rolls.ts):
// Alert, Feral Instinct's advantage, exhaustion, a halfling's Lucky, lasting
// effects on initiative. For the rolls a tool makes itself (a late arrival, a
// recruited companion). A held die it spends is spent here.
export function characterInitiativeExpression(campaign: Campaign, sheet: CharacterSheet, fallbackModifier: number): string {
  const resolved = resolveRollExpression({ kind: "initiative" } as RollArgs, sheet, rollExtrasFor(campaign, sheet, "initiative"));
  if ("error" in resolved || "autoFail" in resolved) {
    return d20Expression(fallbackModifier);
  }
  spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
  return resolved.expression;
}
