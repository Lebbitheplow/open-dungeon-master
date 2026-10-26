// Laying a condition on an enemy once nothing stops it: the instance with its
// lifetime, the creature's concentration and grapples an incapacitation ends,
// and the token's flash. set_condition's enemy branch (encounter-tools-extra.ts)
// and an area that lays a condition on a failed save (aoe-damage.ts) share it;
// the save, the immunity and the refusals stay with each caller.

import type { Campaign } from "@/lib/db/campaigns";
import { patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { addConditionInstance, isIncapacitated, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { onEnemyIncapacitated } from "@/lib/dm/enemy-conditions";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { planConditionFx } from "@/lib/battlemap/fx-plan";
import { publishFx, tokenPosition } from "@/lib/dm/fx";

// Null when the enemy already held it exactly so; else who it let go of.
export function layEnemyConditionInstance(
  campaign: Campaign,
  enemy: EncounterEnemy,
  condition: string,
  incoming: ConditionMeta | undefined,
): { released: string[] } | null {
  // A second source of a condition it holds holds it too, each with its
  // own lifetime (src/lib/dm/condition-logic.ts).
  const laid = addConditionInstance(enemy.conditions, enemy.conditionMeta as ConditionMetaMap, condition, incoming);
  if (JSON.stringify(laid.meta) === JSON.stringify(enemy.conditionMeta) && laid.conditions.length === enemy.conditions.length) {
    return null;
  }
  patchEnemyConditions(enemy.id, laid.conditions, laid.meta);
  // An incapacitated creature loses its concentration (and the spell's
  // hold on its targets) and lets go of whoever it grapples.
  const released = isIncapacitated([condition]) ? onEnemyIncapacitated(campaign, enemy) : [];
  publishEncounter(campaign.id);
  const pos = tokenPosition(campaign.id, enemy.id);
  if (pos && !pos.hidden) {
    publishFx(campaign.id, planConditionFx({ to: pos.at, toTokenId: pos.tokenId, condition, applied: true }));
  }
  return { released };
}
