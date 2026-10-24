// Armor Class with every active effect folded in
// (src/lib/dm/effects-logic.ts). Every attack resolution asks here rather
// than reading the sheet or the enemy row, so a Shield of Faith and a curse
// land on the same number whichever engine rolls against it: enemy_attack,
// pc_attack, the opportunity attacks and the parked physical roll.
//
// Its own module because both sides need it: encounter-tools imports
// pc-attack, so pc-attack could not reach a helper that lived there.

import type { EncounterEnemy } from "@/lib/db/encounters";
import { effectOutcome } from "@/lib/dm/effect-tools";
import { applyField } from "@/lib/dm/effects-logic";
import { effectiveAcFor } from "@/lib/srd";
import { conditionAcRiders } from "@/lib/srd/condition-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { getSheetById } from "@/lib/db/sheets";
import { isSheetFoe } from "@/lib/dm/combat-sides-logic";

export function acWithEffects(campaignId: string, sheet: CharacterSheet): number {
  return applyField(
    effectiveAcFor(sheet),
    effectOutcome(campaignId, { kind: "character", id: sheet.id }, "ac"),
  );
}

// The same for an enemy, whose base AC is a column rather than a derivation,
// with what its conditions add or take away (its own Shield, Shield of
// Faith, Haste, a Slow).
export function enemyAcWithEffects(campaignId: string, enemy: EncounterEnemy): number {
  // A character fighting the party, seen as a foe (sheet-foe.ts): the AC is
  // the sheet's own, with what its effects add.
  const sheet = isSheetFoe(enemy) ? getSheetById(enemy.id) : null;
  if (sheet) {
    return acWithEffects(campaignId, sheet);
  }
  return applyField(
    enemy.ac + conditionAcRiders(enemy.conditions).bonus,
    effectOutcome(campaignId, { kind: "enemy", id: enemy.id }, "ac"),
  );
}
