// The one step after conditions land on an enemy by any path (a spell's
// failed save, an area, Sleep's pool, a Stunning Strike, a poisoned blade):
// if they took it out of action, what follows does (SRD 5.1): its
// concentration ends, with the effects that spell held, and it lets go of
// whoever it grapples (enemy-conditions.ts onEnemyIncapacitated).

import { getCampaignById } from "@/lib/db/campaigns";
import { getEnemy } from "@/lib/db/encounters";
import { isIncapacitated } from "@/lib/dm/condition-logic";
import { onEnemyIncapacitated } from "@/lib/dm/enemy-conditions";

// `wasOut`: whether it was already out of action before these landed (its
// concentration went then). Returns lines for the result.
export function settleEnemyIncapacitation(enemyId: string, wasOut: boolean): string[] {
  if (wasOut) {
    return [];
  }
  const enemy = getEnemy(enemyId);
  if (!enemy || enemy.status !== "alive" || !isIncapacitated(enemy.conditions)) {
    return [];
  }
  const campaign = getCampaignById(enemy.campaignId);
  return campaign ? onEnemyIncapacitated(campaign, enemy) : [];
}
