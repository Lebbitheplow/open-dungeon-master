// The turn start of a creature lying at 0 waiting to regenerate (a troll,
// src/lib/dm/regeneration.ts): it regenerates and rises, or, when the
// damage that stops its Regeneration landed since its last turn, it dies.
// Called by the turn loop (encounter-tools.ts) before the refill of its
// legendary actions and its ordinary Regeneration, which heal only a
// creature above 0.

import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy, listEnemies, patchEnemyConditions, patchEnemyHp, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { listSheets } from "@/lib/db/sheets";
import { applyEnemyDamage } from "@/lib/dm/enemy-damage";
import { enemyHpCap, REGENERATION_STOPPED, regenerationOf } from "@/lib/dm/monster-abilities";
import { withOpportunityTurn } from "@/lib/dm/opportunity-strike";
import { fallsRegenerating, isRegeneratingDown, risenConditions } from "@/lib/dm/regeneration";

export function regenerationTurnStart(campaign: Campaign, encounter: Encounter, enemy: EncounterEnemy | undefined): string[] {
  if (!enemy || enemy.status !== "alive" || enemy.currentHp > 0 || !fallsRegenerating(enemy)) {
    return [];
  }
  const regeneration = regenerationOf(enemy.stats);
  // Chill Touch: a creature it struck cannot regain hit points.
  const stopped = enemy.conditions.includes(REGENERATION_STOPPED) || enemy.conditions.includes("chill touch");
  if (stopped || !regeneration) {
    // Its death is a blow like any other's end: the token goes, what it
    // held lets go. The fight's end waits for the next DM turn, as after an
    // opportunity attack (enemy-damage.ts holdVictory).
    const sheets = listSheets(campaign.id);
    withOpportunityTurn(campaign.id, (turn) =>
      applyEnemyDamage(campaign, turn, encounter, enemy, 1, sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])), undefined, {
        death: true,
        holdVictory: true,
      }),
    );
    const left = listEnemies(encounter.id).filter((entry) => entry.status === "alive").length;
    return [
      `${enemy.displayName} starts its turn at 0 hit points and cannot regenerate: it dies.${left ? "" : " No enemy is left standing; end the encounter."}`,
    ];
  }
  const healed = Math.min(enemyHpCap(enemy), regeneration.amount);
  patchEnemyHp(enemy.id, healed, "alive");
  const fresh = getEnemy(enemy.id) ?? enemy;
  if (isRegeneratingDown({ ...fresh, currentHp: 0 })) {
    const risen = risenConditions(fresh.conditions, fresh.conditionMeta);
    patchEnemyConditions(enemy.id, risen.conditions, risen.meta);
  }
  return [`${enemy.displayName} regenerates ${healed} hit points and stirs from 0; it is still prone until it stands.`];
}
