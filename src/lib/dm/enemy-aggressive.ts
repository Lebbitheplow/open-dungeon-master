// The walks a creature is driven along: Aggressive (the SRD orc: "As a bonus action, the orc can move up to its
// speed toward a hostile creature that it can see"), held on the walk that
// bonus action pays for (issue #621). The Dash it buys is counted like any
// other (enemy-actions.ts), but its speed may only carry the orc toward a
// hostile creature it can see: the walk spends the orc's own movement first,
// and from there each step must not end farther from the nearest such
// creature (enemy-turn-logic.ts towardSteps). move_token and enemy_attack's
// walk-up both ask here. Must not import map-tools or enemy-approach.

import type { Encounter, EncounterEnemy } from "@/lib/db/encounters";
import { getTokenByRef, listHiddenRefIds, listTokens, type BattleMap } from "@/lib/db/battle-maps";
import { APPROACHING } from "@/lib/dm/flee-logic";
import { walkPathWithBudget } from "@/lib/battlemap/movement";
import { hasLineOfSight } from "@/lib/battlemap/los";
import { chebyshev, type BattleToken, type MoveTraits } from "@/lib/battlemap/types";
import { otherSide } from "@/lib/dm/combat-sides-logic";
import { sideOf, standingOn } from "@/lib/dm/combatant";
import { enemyMoveBudget } from "@/lib/dm/enemy-speed";
import { enemyTurnEntry, towardSteps } from "@/lib/dm/enemy-turn-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";

type XY = { x: number; y: number };

// The squares of the hostile creatures it can see from `from`: the other
// side's, standing, on the board, not hidden by the GM, in its line of sight.
// A blinded creature sees none.
export function hostilesInSight(encounter: Encounter, map: BattleMap, enemy: EncounterEnemy, from: XY): XY[] {
  if (enemy.conditions.some((entry) => isConditionNamed(entry, "blinded"))) {
    return [];
  }
  const hidden = new Set(listHiddenRefIds(map.id));
  const foes = new Set(standingOn(enemy.campaignId, encounter, otherSide(sideOf(encounter, "enemy", enemy.id, enemy))).map((foe) => foe.id));
  return listTokens(map.id)
    .filter((token) => foes.has(token.refId) && !hidden.has(token.refId))
    .filter((token) => hasLineOfSight(map.terrain, map.width, from.x, from.y, token.x, token.y))
    .map((token) => ({ x: token.x, y: token.y }));
}

// The steps of a walk it may take, and whether Aggressive's limit cut it.
// Unchanged for a creature whose turn holds no Aggressive Dash.
export function aggressiveSteps<T extends XY>(
  encounter: Encounter,
  map: BattleMap,
  enemy: EncounterEnemy,
  mover: BattleToken,
  steps: T[],
  traits: MoveTraits,
): { steps: T[]; cut: boolean } {
  if (!enemyTurnEntry(encounter, enemy.id).aggressive) {
    return { steps, cut: false };
  }
  const budget = enemyMoveBudget(encounter, enemy, mover);
  // Its own movement is spent first; what is left of Aggressive's speed is
  // the last of the count.
  const own = Math.max(0, budget.tilesLeft - budget.speedTiles);
  const ownWalk = walkPathWithBudget(map.terrain, map.width, steps, own, traits, mover);
  const paidFrom = ownWalk.at ? steps.findIndex((step) => step.x === ownWalk.at?.x && step.y === ownWalk.at?.y) + 1 : 0;
  if (ownWalk.reachedEnd && ownWalk.at) {
    return { steps, cut: false };
  }
  const seen = hostilesInSight(encounter, map, enemy, mover);
  const nearest = (at: XY) => (seen.length ? Math.min(...seen.map((foe) => chebyshev(at.x, at.y, foe.x, foe.y))) : Number.POSITIVE_INFINITY);
  // With nobody in sight, no step of Aggressive's speed is toward anyone.
  const allowed = seen.length ? towardSteps(mover, steps, paidFrom, nearest) : steps.slice(0, paidFrom);
  return { steps: allowed, cut: allowed.length < steps.length };
}

// Where the caster of Command's Approach stands, when the creature has to
// walk to them and they are on the board.
export function approachSourceAt(map: BattleMap, enemy: Pick<EncounterEnemy, "conditions" | "conditionMeta">): XY | null {
  const held = enemy.conditions.find((entry) => isConditionNamed(entry, APPROACHING));
  const source = held ? (enemy.conditionMeta as Record<string, { source?: string } | undefined>)[held]?.source : undefined;
  const token = source ? getTokenByRef(map.id, source) : null;
  return token ? { x: token.x, y: token.y } : null;
}

// The steps of a walk Command's Approach allows: none that ends farther
// from the caster than the square before it (SRD 5.1: "toward you by the
// shortest and most direct route"). Unchanged for a creature not commanded.
export function approachSteps<T extends XY>(map: BattleMap, enemy: Pick<EncounterEnemy, "conditions" | "conditionMeta">, mover: XY, steps: T[]): { steps: T[]; cut: boolean } {
  const caster = approachSourceAt(map, enemy);
  if (!caster) {
    return { steps, cut: false };
  }
  const allowed = towardSteps(mover, steps, 0, (at) => chebyshev(at.x, at.y, caster.x, caster.y));
  return { steps: allowed, cut: allowed.length < steps.length };
}
