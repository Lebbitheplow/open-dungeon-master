import type { EnemyStats } from "@/lib/bestiary/statblock";
import { speedToTiles } from "@/lib/battlemap/movement";
import { effectiveSpeed } from "@/lib/dm/condition-logic";
import { exhaustedTiles } from "@/lib/dm/monster-abilities";
import { listEffects } from "@/lib/db/active-effects";
import { applyField, resolveField } from "@/lib/dm/effects-logic";

// The squares an enemy may walk on a turn: its stat-block speed in feet
// through the condition effects a character's goes through (pcMoveBudget,
// src/lib/battlemap/view.ts), so slowed halves it, hasted doubles it and
// Longstrider adds 10 feet, then exhaustion; an active effect on its speed
// (set_effect) moves the base first. One function, so the enemy's own walk
// (enemy-approach.ts, map-tools.ts) and the board's guess at its next move
// (intent.ts) read the same number.
export function enemySpeedTiles(enemy: { stats: Pick<EnemyStats, "speed">; conditions: string[]; id?: string; campaignId?: string }): number {
  const printed = speedToTiles(enemy.stats.speed) * 5;
  const base = enemy.id && enemy.campaignId
    ? applyField(printed, resolveField(listEffects(enemy.campaignId, { kind: "enemy", id: enemy.id }), "speed"))
    : printed;
  const feet = effectiveSpeed(enemy.conditions, Math.max(0, base));
  return feet === 0 ? 0 : exhaustedTiles(enemy.conditions, speedToTiles(feet));
}
