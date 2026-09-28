// A saving throw the server rolls for somebody: the save an enemy's spell, a
// trap or an area effect forces on a character, and the save a creature
// makes against what a character does to it. One place, so every such save
// reads the same things a requested roll reads: the conditions that decide
// it outright, a paladin's aura, the lasting effects on saves, exhaustion,
// and an inspiration die, which is spent by the roll it is added to.
//
// request_roll (src/lib/dm/invoke-roll.ts), group_check and aoe_damage call
// in here; cast_at_player and cast_at_enemy are meant to.

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { insertRoll } from "@/lib/db/rolls";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { saveModFor, type SaveAbility } from "@/lib/bestiary/statblock";
import { allySaveAura } from "@/lib/dm/aura";
import { mergeAdvantage, removeConditions, rollDerivation } from "@/lib/dm/condition-logic";
import { effectOutcome, rollEffectExtras } from "@/lib/dm/effect-tools";
import { resolveRollExpression, type RollArgs } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { conditionRollRiders } from "@/lib/srd/condition-effects";

// Everything resolveRollExpression cannot read for itself, for one roll of
// one character: the aura over them (saves only), the lasting effects on
// this kind of roll, and the table's encumbrance rule.
export function rollExtrasFor(campaign: Campaign, sheet: CharacterSheet, kind: string) {
  const aura = kind === "saving_throw" ? allySaveAura(campaign.id, sheet) : null;
  return {
    ...(aura ? { saveBonus: aura.bonus, saveNote: aura.note } : {}),
    ...rollEffectExtras(campaign.id, sheet.id, kind),
    encumbrance: campaign.gameSettings.variantRules.encumbrance,
  };
}

// Clears what a roll spent: an inspiration die, a held Help, a one-shot
// rider. `spent` is resolveRollExpression's spendInspiration.
export function spendRollCarriers(campaignId: string, sheetId: string, spent: string | undefined) {
  if (!spent) {
    return;
  }
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return;
  }
  const { conditions, meta } = removeConditions(
    sheet.conditions,
    sheet.conditionMeta,
    spent.split("|"),
  );
  const updated = patchSheet(sheet.id, { conditions, conditionMeta: meta });
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
}

export type ForcedSave = {
  success: boolean;
  // Null when a condition failed the save with no die rolled.
  total: number | null;
  autoFailed: boolean;
  notes: string[];
};

// A character's forced save, rolled, published as a dice card and recorded
// on the turn.
export function rollCharacterSave(
  campaign: Campaign,
  turn: DmTurn,
  stale: CharacterSheet,
  ability: SaveAbility,
  dc: number,
  detail: string,
  against?: string,
): ForcedSave {
  const sheet = getSheetById(stale.id) ?? stale;
  const resolved = resolveRollExpression(
    { kind: "saving_throw", ability, dc, ...(against ? { against } : {}) } as RollArgs,
    sheet,
    rollExtrasFor(campaign, sheet, "saving_throw"),
  );
  if ("error" in resolved) {
    return { success: false, total: null, autoFailed: true, notes: [resolved.error] };
  }
  if ("autoFail" in resolved) {
    return { success: false, total: null, autoFailed: true, notes: resolved.notes };
  }
  spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
  const outcome = rollExpression(resolved.expression);
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "saving_throw",
    detail,
    dc,
    result: outcome,
  });
  turn.rollIds.push(roll.id);
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll,
    source: "digital",
  });
  return {
    success: outcome.total >= dc,
    total: outcome.total,
    autoFailed: false,
    notes: resolved.conditionNotes ?? [],
  };
}

// A creature's save from its stat block, with its conditions honoured: a
// paralyzed, stunned, unconscious or petrified creature fails Strength and
// Dexterity saves with no die rolled, a restrained one rolls Dexterity saves
// at disadvantage, and a lasting effect on its saves counts. Rolled
// silently, as enemy saves are; the caller reports the result.
export function rollEnemySave(
  campaignId: string,
  enemy: EncounterEnemy,
  ability: SaveAbility,
  dc: number,
): ForcedSave {
  const derivation = rollDerivation(enemy.conditions, "saving_throw", ability);
  if (derivation.autoFail) {
    return { success: false, total: null, autoFailed: true, notes: derivation.notes };
  }
  const effect = effectOutcome(campaignId, { kind: "enemy", id: enemy.id }, "save");
  // A spell a character left on the creature (Bane's d4 off, Bless's d4 on)
  // counts on its saves exactly as it would on a character's.
  const riders = conditionRollRiders(enemy.conditions, "save", ability);
  const advantage = mergeAdvantage([
    derivation.advantage,
    ...(effect.advantage ? ["advantage" as const] : []),
    ...(effect.disadvantage ? ["disadvantage" as const] : []),
    ...riders.advantageSources,
  ]);
  const outcome = rollExpression(
    `${d20Expression(saveModFor(enemy.stats, ability) + effect.bonus, advantage)}${riders.diceSuffix}`,
  );
  return {
    success: outcome.total >= dc,
    total: outcome.total,
    autoFailed: false,
    notes: [...derivation.notes, ...effect.sources, ...riders.notes],
  };
}
