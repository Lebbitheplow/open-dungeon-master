// What a thrown flask leaves on a creature, and what that mark does after
// (SRD 5.1 Adventuring Gear; the flasks themselves are
// src/lib/srd/gear-weapons.ts). Alchemist's fire sets it burning: 1d4 fire
// at the start of each of its turns until it spends its action on a DC 10
// Dexterity check (take_action escape). Oil covers it for a minute: the next
// fire damage it takes deals 5 more (enemy-damage.ts reads the mark). Holy
// water on a creature that is neither fiend nor undead does nothing.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getEnemy, listEnemies, patchEnemyConditions, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { allocateSeq } from "@/lib/db/campaigns";
import { insertRoll } from "@/lib/db/rolls";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { rollExpression } from "@/lib/dice";
import { publicDie } from "@/lib/dm/between-io";
import { removeConditions } from "@/lib/dm/condition-logic";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { isUndeadOrFiend } from "@/lib/dm/attack-rules";
import { withOpportunityTurn } from "@/lib/dm/opportunity-strike";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { applyRiderCondition } from "@/lib/dm/pc-attack-riders";
import { abilityMod } from "@/lib/srd";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { BURNING, COVERED_IN_OIL, type GearWeapon } from "@/lib/srd/gear-weapons";
import type { ToolResult } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Alchemist's Fire: "A creature can end this damage by using its action to
// make a DC 10 Dexterity check to extinguish the flames."
const EXTINGUISH_DC = 10;
// Oil dries "after 1 minute".
const OIL_ROUNDS = 10;

const holds = (conditions: string[], name: string) => conditions.some((entry) => isConditionNamed(entry, name));

// A hit that deals no damage at once: the mark it leaves and the sentence
// for the table, or null for a hit whose dice are rolled as usual.
export function gearHitWithoutDamage(campaign: Campaign, enemy: EncounterEnemy, gear: GearWeapon): string | null {
  if (gear.fiendsAndUndeadOnly && !isUndeadOrFiend(enemy)) {
    return `The holy water splashes over ${enemy.displayName} and does nothing: it harms only a fiend or an undead creature. The flask is spent.`;
  }
  if (gear.dice) {
    return null;
  }
  if (gear.leaves === "burning") {
    const lit = applyRiderCondition(campaign, enemy, BURNING, { meta: { source: gear.name } });
    return lit.applied
      ? `${enemy.displayName} catches fire: it takes 1d4 fire damage at the start of each of its turns (the server rolls it) until it uses its action on a DC 10 Dexterity check to put the flames out (take_action escape). No damage now. The flask is spent.`
      : `The flask bursts on ${enemy.displayName} and does not catch: ${lit.reason} The flask is spent.`;
  }
  if (gear.leaves === "oiled") {
    applyRiderCondition(campaign, enemy, COVERED_IN_OIL, { meta: { rounds: OIL_ROUNDS, source: gear.name } });
    return `${enemy.displayName} is covered in oil for a minute: the next fire damage it takes deals 5 more fire damage (the server adds it). No damage now. The flask is spent.`;
  }
  return null;
}

// The 1d4 fire of alchemist's fire, at the start of a burning creature's
// turn (src/lib/dm/turn-start-effects.ts).
export function burningTurnStart(campaign: Campaign, encounter: Encounter, id: string, enemy: EncounterEnemy | undefined): string[] {
  if (enemy) {
    if (enemy.status !== "alive" || !holds(enemy.conditions, BURNING)) {
      return [];
    }
    const burn = publicDie(campaign, null, "1d4", `${enemy.displayName}: alchemist's fire`);
    const sheets = listSheets(campaign.id);
    const applied = withOpportunityTurn(campaign.id, (turn) =>
      applyEnemyDamage(campaign, turn, encounter, enemy, burn, sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])), "fire", { holdVictory: true }),
    );
    const taken = typeof applied?.damageApplied === "number" ? applied.damageApplied : burn;
    const left = listEnemies(encounter.id).filter((entry) => entry.status === "alive").length;
    return [`${enemy.displayName} starts its turn burning and takes ${taken} fire damage (alchemist's fire).${left ? "" : " No enemy is left standing; end the encounter."}`];
  }
  const sheet = getSheetById(id);
  if (!sheet || sheet.currentHp <= 0 || !holds(sheet.conditions, BURNING)) {
    return [];
  }
  const burn = publicDie(campaign, sheet, "1d4", `${sheet.name}: alchemist's fire`);
  withOpportunityTurn(campaign.id, (turn) => applyPcDamage(campaign, turn.id, sheet, { amount: burn, type: "fire", reason: "alchemist's fire" }));
  return [`${sheet.name} starts their turn burning and takes ${burn} fire damage (alchemist's fire) before resistances; their action on a DC 10 Dexterity check puts it out (take_action escape).`];
}

export function sheetBurning(sheet: CharacterSheet): boolean {
  return holds(sheet.conditions, BURNING);
}

export function enemyBurning(enemy: EncounterEnemy): boolean {
  return holds(enemy.conditions, BURNING);
}

// A character's action against the flames. The caller priced the action;
// `spend` pays it.
export function characterExtinguish(campaign: Campaign, turn: DmTurn, sheet: CharacterSheet, spend: () => void): ToolResult {
  spend();
  const check = rollCharacterCheck(campaign, sheet, { ability: "dex", dc: EXTINGUISH_DC }, `${sheet.name}: DEX check to put out the alchemist's fire (DC ${EXTINGUISH_DC})`);
  if (check.rollId) {
    turn.rollIds.push(check.rollId);
  }
  const out = !check.autoFailed && check.total >= EXTINGUISH_DC;
  if (out) {
    const fresh = getSheetById(sheet.id) ?? sheet;
    const cleared = removeConditions(fresh.conditions, fresh.conditionMeta, [BURNING]);
    const updated = patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  return {
    ok: true,
    action: "escape",
    check: `${check.total} vs DC ${EXTINGUISH_DC}`,
    success: out,
    note: out ? `${sheet.name} puts out the flames; the server cleared burning.` : `${sheet.name} spends their action and is still burning.`,
  };
}

// An enemy's action against the flames: a d20 and its Dexterity modifier.
// The caller has checked the enemy may act and spends the action.
export function enemyExtinguish(campaign: Campaign, turn: DmTurn, enemy: EncounterEnemy): ToolResult {
  const outcome = rollExpression(`1d20${signed(abilityMod(enemy.stats.abilities?.dex ?? 10))}`);
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: null,
    requestedBy: "dm",
    kind: "ability_check",
    detail: `${enemy.displayName}: DEX check to put out the alchemist's fire (DC ${EXTINGUISH_DC})`,
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
  turn.rollIds.push(roll.id);
  const out = outcome.total >= EXTINGUISH_DC;
  if (out) {
    const fresh = getEnemy(enemy.id) ?? enemy;
    const cleared = removeConditions(fresh.conditions, fresh.conditionMeta, [BURNING]);
    patchEnemyConditions(enemy.id, cleared.conditions, cleared.meta);
    publishEncounter(campaign.id);
  }
  return {
    ok: true,
    action: "escape",
    check: `${outcome.total} vs DC ${EXTINGUISH_DC}`,
    success: out,
    note: out ? `${enemy.displayName} puts out the flames with its action.` : `${enemy.displayName} spends its action and is still burning.`,
  };
}

const signed = (mod: number) => (mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : "");
