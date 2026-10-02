import type { EnemyStats } from "@/lib/bestiary/statblock";
import { speedToTiles } from "@/lib/battlemap/movement";
import { effectiveSpeed } from "@/lib/dm/condition-logic";
import { exhaustedTiles } from "@/lib/dm/monster-abilities";

// The squares an enemy may walk on a turn: its stat-block speed in feet
// through the condition effects a character's goes through (pcMoveBudget,
// src/lib/battlemap/view.ts), so slowed halves it, hasted doubles it and
// Longstrider adds 10 feet, then exhaustion. Pure, so the enemy's own walk
// (enemy-approach.ts, map-tools.ts) and the board's guess at its next move
// (intent.ts) read the same number.
export function enemySpeedTiles(enemy: { stats: Pick<EnemyStats, "speed">; conditions: string[] }): number {
  const feet = effectiveSpeed(enemy.conditions, speedToTiles(enemy.stats.speed) * 5);
  return feet === 0 ? 0 : exhaustedTiles(enemy.conditions, speedToTiles(feet));
}
