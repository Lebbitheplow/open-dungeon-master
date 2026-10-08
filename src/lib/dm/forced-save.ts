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
import { INSPIRATION_SPEND, spendInspirationCounter } from "@/lib/dm/roll-riders";
import { inDirectSunlight } from "@/lib/dm/sunlight";
import { obscuredFor } from "@/lib/dm/zone-rules";
import { hasSunlightSensitivity, holdsFeature } from "@/lib/srd/trait-rules";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { pcMoveBudget } from "@/lib/battlemap/view";
import { speedToTiles } from "@/lib/battlemap/movement";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { conditionRollRiders } from "@/lib/srd/condition-effects";
import { enemyExhaustion, hasTrait } from "@/lib/dm/monster-abilities";
import { authoredEnemySave } from "@/lib/dm/authored-saves";
import { authoredSaveDieVs } from "@/lib/srd/authored-effects-more";
import { moteAfterRoll, moteOf } from "@/lib/dm/authored-mote";

// Everything resolveRollExpression cannot read for itself, for one roll of
// one character: the aura over them (saves only), the lasting effects on
// this kind of roll, and the table's encumbrance rule.
export function rollExtrasFor(campaign: Campaign, sheet: CharacterSheet, kind: string) {
  const aura = kind === "saving_throw" ? allySaveAura(campaign.id, sheet) : null;
  return {
    ...(aura ? { saveBonus: aura.bonus, saveNote: aura.note } : {}),
    ...rollEffectExtras(campaign.id, sheet.id, kind),
    encumbrance: campaign.gameSettings.variantRules.encumbrance,
    // Sunlight Sensitivity reads the board's sky (src/lib/dm/sunlight.ts).
    sunlight: hasSunlightSensitivity(sheet) && inDirectSunlight(campaign.id),
    // Standing in a fog cloud, a web, magical darkness (src/lib/dm/zone-rules.ts).
    obscured: obscuredFor(campaign.id, sheet.id),
    // Supreme Sneak reads how far the rogue walked this turn.
    movedLittle: holdsFeature(sheet, "supreme sneak") ? movedLittle(campaign.id, sheet) : false,
  };
}

// No more than half their speed walked this turn, on the board; off it the
// character is taken at their word and moves slowly.
function movedLittle(campaignId: string, sheet: CharacterSheet): boolean {
  const encounter = getActiveEncounter(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!encounter || !map || !token) {
    return true;
  }
  const { speed } = pcMoveBudget(campaignId, encounter, map, sheet, token);
  return token.movedThisRound <= Math.floor(speedToTiles(speed) / 2);
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
  // Inspiration is a counter, not a condition (src/lib/dm/roll-riders.ts).
  const resources = spent.split("|").includes(INSPIRATION_SPEND)
    ? spendInspirationCounter(sheet.resources)
    : undefined;
  const updated = patchSheet(sheet.id, { conditions, conditionMeta: meta, ...(resources ? { resources } : {}) });
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
  // The creature forcing the save, for the features that answer it
  // (Supernatural Defense against the Monster Slayer's prey).
  from?: EncounterEnemy | null,
  // Advantage or disadvantage the engine itself has established (Mage
  // Slayer against an adjacent caster, Dungeon Delver against a trap).
  claim?: { advantage: "advantage" | "disadvantage"; reason: string } | null,
): ForcedSave {
  const sheet = getSheetById(stale.id) ?? stale;
  const resolved = resolveRollExpression(
    {
      kind: "saving_throw",
      ability,
      dc,
      ...(against ? { against } : {}),
      ...(claim ? { advantage: claim.advantage, advantageReason: claim.reason } : {}),
    } as RollArgs,
    sheet,
    rollExtrasFor(campaign, sheet, "saving_throw"),
  );
  if ("error" in resolved) {
    return { success: false, total: null, autoFailed: true, notes: [resolved.error] };
  }
  if ("autoFail" in resolved) {
    return { success: false, total: null, autoFailed: true, notes: resolved.notes };
  }
  const mote = moteOf(sheet, resolved.spendInspiration);
  spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
  const versus = authoredSaveDieVs(sheet, sheet.id, from ? { conditions: from.conditions, meta: from.conditionMeta as Record<string, { source?: string }> } : null);
  const outcome = rollExpression(`${resolved.expression}${versus ? `+${versus.die}` : ""}`);
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
  const moteLine = moteAfterRoll(campaign, sheet, mote, "saving_throw", outcome);
  return {
    success: outcome.total >= dc,
    total: outcome.total,
    autoFailed: false,
    notes: [
      ...(resolved.conditionNotes ?? []),
      ...(versus ? [`${versus.feature}: +${versus.die} against its prey`] : []),
      ...(moteLine ? [moteLine] : []),
    ],
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
  // The save is against a spell or another magical effect, which Magic
  // Resistance answers with advantage (SRD 5.1). `advantage` and
  // `disadvantage` are the spell's own say (Charm Person in a fight, Blight
  // on a plant). `record` keeps the roll as a row only the DM sees, so an
  // enemy's save is on the record like every other roll.
  options: {
    magical?: boolean;
    advantage?: boolean;
    disadvantage?: boolean;
    record?: { turn?: DmTurn; detail: string };
  } = {},
): ForcedSave {
  const derivation = rollDerivation(enemy.conditions, "saving_throw", ability);
  if (derivation.autoFail) {
    return { success: false, total: null, autoFailed: true, notes: derivation.notes };
  }
  const effect = effectOutcome(campaignId, { kind: "enemy", id: enemy.id }, "save");
  // A spell a character left on the creature (Bane's d4 off, Bless's d4 on)
  // counts on its saves exactly as it would on a character's.
  const riders = conditionRollRiders(enemy.conditions, "save", ability);
  // Authored subclass features (Magical Ambush, Hound of Ill Omen, Unsettling Words): authored-saves.ts.
  const authored = authoredEnemySave(campaignId, enemy, { magical: options.magical });
  const resistsMagic = options.magical === true && hasTrait(enemy.stats, "magicResistance");
  const worn = enemyExhaustion(enemy.conditions) >= 3;
  const advantage = mergeAdvantage([
    ...(worn ? ["disadvantage" as const] : []),
    derivation.advantage,
    ...(effect.advantage ? ["advantage" as const] : []),
    ...(effect.disadvantage ? ["disadvantage" as const] : []),
    ...(resistsMagic ? ["advantage" as const] : []),
    ...(options.advantage ? ["advantage" as const] : []),
    ...(options.disadvantage ? ["disadvantage" as const] : []),
    ...riders.advantageSources,
    ...authored.sources,
  ]);
  const outcome = rollExpression(
    `${d20Expression(saveModFor(enemy.stats, ability) + effect.bonus, advantage)}${riders.diceSuffix}`,
  );
  if (options.record) {
    const roll = insertRoll({
      campaignId,
      characterId: null,
      requestedBy: "dm",
      kind: "saving_throw",
      detail: options.record.detail.slice(0, 200),
      dc,
      ...(advantage === "none" ? {} : { advantage }),
      result: outcome,
      visibility: "dm",
    });
    options.record.turn?.rollIds.push(roll.id);
  }
  return {
    success: outcome.total >= dc,
    total: outcome.total,
    autoFailed: false,
    notes: [
      ...derivation.notes,
      ...effect.sources,
      ...(resistsMagic ? ["Magic Resistance: advantage against magic"] : []),
      ...(worn ? ["exhaustion: disadvantage on saving throws"] : []),
      ...riders.notes,
      ...authored.notes,
    ],
  };
}
