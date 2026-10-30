import type { EnemyStats } from "@/lib/bestiary/statblock";
import { speedToTiles } from "@/lib/battlemap/movement";
import { flyingSpeedOf, type BattleToken } from "@/lib/battlemap/types";
import { effectiveSpeed } from "@/lib/dm/condition-logic";
import { exhaustedTiles } from "@/lib/dm/monster-abilities";
import { listEffects } from "@/lib/db/active-effects";
import { applyField, resolveField } from "@/lib/dm/effects-logic";
import { dashesOf, enemyTilesLeft, enemyTurnEntry, type EnemyTurns } from "@/lib/dm/enemy-turn-logic";

type SpeedEnemy = { stats: Pick<EnemyStats, "speed">; conditions: string[]; id?: string; campaignId?: string };

// The squares an enemy may walk on a turn: its stat-block speed in feet
// through the condition effects a character's goes through (pcMoveBudget,
// src/lib/battlemap/view.ts), so slowed halves it, hasted doubles it and
// Longstrider adds 10 feet, then exhaustion; an active effect on its speed
// (set_effect) moves the base first. One function, so the enemy's own walk
// (enemy-approach.ts, map-tools.ts) and the board's guess at its next move
// (intent.ts) read the same number.
//
// Aloft (`flying`), it moves at its flying speed, as a character aloft does
// (issue #621): a hawk whose block prints "10 ft., fly 60 ft." walked ten.
export function enemySpeedTiles(enemy: SpeedEnemy, options: { flying?: boolean } = {}): number {
  const flies = options.flying ? flyingSpeedOf({ speedText: String(enemy.stats.speed ?? ""), conditions: enemy.conditions }) : null;
  const printed = flies ?? speedToTiles(enemy.stats.speed) * 5;
  const base = enemy.id && enemy.campaignId
    ? applyField(printed, resolveField(listEffects(enemy.campaignId, { kind: "enemy", id: enemy.id }), "speed"))
    : printed;
  const feet = effectiveSpeed(enemy.conditions, Math.max(0, base));
  return feet === 0 ? 0 : exhaustedTiles(enemy.conditions, speedToTiles(feet));
}

export type EnemyMoveBudget = {
  // Its speed this turn, in squares, before any Dash.
  speedTiles: number;
  // What it may still walk: the speed once more for each Dash, less what it
  // has walked (src/lib/dm/enemy-turn-logic.ts enemyTilesLeft).
  tilesLeft: number;
  dashes: number;
  disengaged: boolean;
};

// An enemy's movement this turn, the one count every walk of its own reads
// (move_token, enemy_attack's walk-up, standing from prone, the flight a
// turned creature makes), as pcMoveBudget is a character's.
export function enemyMoveBudget(
  encounter: { round: number; legendary?: { turns?: EnemyTurns } } | null,
  enemy: SpeedEnemy & { id: string },
  token: Pick<BattleToken, "movement" | "movedThisRound">,
): EnemyMoveBudget {
  const speedTiles = enemySpeedTiles(enemy, { flying: token.movement === "fly" });
  const entry = enemyTurnEntry(encounter, enemy.id);
  return {
    speedTiles,
    tilesLeft: enemyTilesLeft(speedTiles, entry, token.movedThisRound),
    dashes: dashesOf(entry),
    disengaged: entry.disengaged === true,
  };
}

// What GAME STATE says of an enemy's movement, or null while it is its plain
// speed: the GM read "speed 30 ft." from the block and walked a goblin that
// had Dashed, or one already spent, as if it had all of it (issue #621).
export function enemyMovementNote(budget: EnemyMoveBudget): string | null {
  if (budget.tilesLeft === budget.speedTiles && !budget.disengaged) {
    return null;
  }
  const flags = [budget.dashes ? (budget.dashes === 1 ? "Dashed" : `Dashed ${budget.dashes}x`) : "", budget.disengaged ? "Disengaged" : ""].filter(Boolean);
  return `${budget.tilesLeft * 5} ft left this turn${flags.length ? ` (${flags.join(", ")})` : ""}`;
}
