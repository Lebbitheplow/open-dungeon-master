import type { Campaign } from "@/lib/db/campaigns";
import { listEnemies, patchEnemyConditions, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef, listTokens, moveToken, resetTurnBudgets } from "@/lib/db/battle-maps";
import { findPath, walkPathWithBudget } from "@/lib/battlemap/movement";
import { hasLineOfSight } from "@/lib/battlemap/los";
import { bestFiringPosition } from "@/lib/battlemap/tactics";
import { occupiedTiles } from "@/lib/battlemap/view";
import { chebyshev, climbsFrom, swimsFrom, type BattleToken, type MoveTraits } from "@/lib/battlemap/types";
import { footprintForSize } from "@/lib/battlemap/footprint";
import { passableTiles } from "@/lib/battlemap/passage";
import { getSheetById } from "@/lib/db/sheets";
import { sizeForRace } from "@/lib/srd";
import { isIncapacitated, removeConditions } from "@/lib/dm/condition-logic";
import { resolvePcOpportunityAttacks } from "@/lib/dm/opportunity";
import { publishEphemeral } from "@/lib/events";
import { swingMode, type EnemyAttackProfile } from "@/lib/dm/enemy-profile";
import { enemySpeedTiles } from "@/lib/dm/enemy-speed";
import { endsOwedTurn, markEnemyActed } from "@/lib/dm/can-act";
import { missileProblem, zoneStepsFor } from "@/lib/dm/zone-rules";
import { zonesAfterMove } from "@/lib/dm/zone-triggers";

// An enemy getting to where its attack reaches, on its own turn (SRD 5.1,
// Movement and Position): it stands up from prone for half its speed, walks
// no farther than its speed, stops as soon as its reach or its range covers
// the target, never walks closer to what it is frightened of, and draws the
// opportunity attacks of whoever it walks away from. A model that never
// calls move_token still gets spatially honest enemies. Must not import
// encounter-tools or map-tools (they import this).

type XY = { x: number; y: number };

export type Approach = {
  // The refusal, when the attack cannot be made this turn.
  blocked?: Record<string, unknown>;
  movedTo?: string;
  opportunityAttacks?: string[];
  // Squares between the two after the approach; null with no board.
  distance: number | null;
};

// Where the creature it fears stands, when it fears one on the board.
export function fearSourceAt(
  mapId: string,
  conditions: string[],
  meta: Record<string, { source?: string } | undefined>,
): XY | null {
  const frightened = conditions.find((entry) => entry.toLowerCase() === "frightened");
  const source = frightened ? meta?.[frightened]?.source : undefined;
  if (!source) {
    return null;
  }
  const token = getTokenByRef(mapId, source);
  return token ? { x: token.x, y: token.y } : null;
}

// The steps of a walk a frightened creature may take: it stops before the
// first square that is closer to the source of its fear than where it began.
export function awayFromFear(from: XY, steps: XY[], source: XY | null): XY[] {
  if (!source) {
    return steps;
  }
  const start = chebyshev(from.x, from.y, source.x, source.y);
  const allowed: XY[] = [];
  for (const step of steps) {
    if (chebyshev(step.x, step.y, source.x, source.y) < start) {
      break;
    }
    allowed.push(step);
  }
  return allowed;
}

// An enemy spends its action. When that closes the turn it was owed and its
// own turn follows (can-act.ts endsOwedTurn), the own turn walks on fresh
// movement. The caller saves the encounter.
export function spendEnemyAction(encounter: Encounter, enemyId: string) {
  const ownTurnFollows = endsOwedTurn(encounter, enemyId);
  markEnemyActed(encounter, enemyId);
  const map = ownTurnFollows ? getBattleMapForEncounter(encounter.id) : null;
  if (map) {
    resetTurnBudgets(map.id, [enemyId]);
  }
}

// A prone enemy stands at the start of what it does on its turn, paying
// half its speed; with less than that left it stays down (and crawls, which
// the walk below does not attempt). Returns the enemy as it now stands.
export function standUpIfProne(encounterId: string, enemy: EncounterEnemy): { enemy: EncounterEnemy; stood: boolean } {
  const prone = enemy.conditions.find((entry) => entry.toLowerCase() === "prone");
  if (!prone) {
    return { enemy, stood: false };
  }
  const full = enemySpeedTiles(enemy);
  if (full <= 0) {
    return { enemy, stood: false };
  }
  const half = Math.floor(full / 2);
  const map = getBattleMapForEncounter(encounterId);
  const token = map ? getTokenByRef(map.id, enemy.id) : null;
  if (token) {
    if (full - token.movedThisRound < half) {
      return { enemy, stood: false };
    }
    moveToken(token.id, token.x, token.y, token.movedThisRound + half);
  }
  const stood = removeConditions(enemy.conditions, enemy.conditionMeta, [prone]);
  patchEnemyConditions(enemy.id, stood.conditions, stood.meta);
  return { enemy: { ...enemy, conditions: stood.conditions, conditionMeta: stood.meta }, stood: true };
}

// The squares of a path up to and including the one landed on.
function walkedPart(path: XY[], landing: XY) {
  const at = path.findIndex((step) => step.x === landing.x && step.y === landing.y);
  return at >= 0 ? path.slice(0, at + 1) : path;
}

export function approachTarget(
  campaign: Campaign,
  encounterId: string,
  enemy: EncounterEnemy,
  targetRef: string,
  profile: EnemyAttackProfile,
): Approach {
  const map = getBattleMapForEncounter(encounterId);
  const attacker = map ? getTokenByRef(map.id, enemy.id) : null;
  const target = map ? getTokenByRef(map.id, targetRef) : null;
  if (!map || !attacker || !target) {
    return { distance: null };
  }
  const sightFrom = (at: XY) =>
    hasLineOfSight(map.terrain, map.width, map.height, at.x, at.y, target.x, target.y);
  const reachesFrom = (at: XY) => {
    const distance = chebyshev(at.x, at.y, target.x, target.y);
    if (profile.melee && distance <= profile.reachTiles && (distance <= 1 || sightFrom(at))) {
      return true;
    }
    return profile.ranged && distance <= profile.longRangeTiles && sightFrom(at);
  };
  const origin = { x: attacker.x, y: attacker.y };
  const startDistance = chebyshev(origin.x, origin.y, target.x, target.y);
  if (reachesFrom(origin)) {
    return { distance: startDistance };
  }

  const budget = Math.max(0, enemySpeedTiles(enemy) - attacker.movedThisRound);
  const fear = fearSourceAt(map.id, enemy.conditions, enemy.conditionMeta as Record<string, { source?: string }>);
  const occupied = occupiedTiles(map, listTokens(map.id), attacker);
  let landing: XY = origin;
  let cost = 0;
  let walked: XY[] = [];
  if (budget > 0 && profile.melee) {
    // Toward the target, stopping at the first square its reach covers.
    // Through its allies' spaces, and a character's two sizes apart.
    const swims = enemyMoveTraits(map.width, listTokens(map.id), attacker, enemy.encounterId);
    const path = findPath(map.terrain, map.width, map.height, occupied, attacker, target, 1, false, swims);
    const approach = path ? path.slice(0, -1) : [];
    const stopAt = approach.findIndex((step) => reachesFrom(step));
    const wanted = awayFromFear(origin, stopAt >= 0 ? approach.slice(0, stopAt + 1) : approach, fear);
    const walk = walkPathWithBudget(map.terrain, map.width, wanted, budget, swims, origin);
    if (walk.at) {
      landing = walk.at;
      cost = walk.spent;
      walked = walkedPart(wanted, walk.at);
    }
  } else if (budget > 0 && profile.ranged) {
    // A shooter out of range or sight steps to the nearest square with both.
    const spot =
      bestFiringPosition(map.terrain, map.width, map.height, occupied, attacker, target, budget, profile.rangeTiles) ??
      bestFiringPosition(map.terrain, map.width, map.height, occupied, attacker, target, budget, profile.longRangeTiles);
    const allowed =
      spot && (!fear || chebyshev(spot.at.x, spot.at.y, fear.x, fear.y) >= chebyshev(origin.x, origin.y, fear.x, fear.y));
    if (spot && allowed) {
      landing = spot.at;
      cost = spot.cost;
      walked = findPath(map.terrain, map.width, map.height, occupied, attacker, spot.at) ?? [];
    }
  }
  let provoked: string[] = [];
  if (landing.x !== origin.x || landing.y !== origin.y) {
    moveToken(attacker.id, landing.x, landing.y, attacker.movedThisRound + cost);
    publishEphemeral(campaign.id, "battle_map_updated", {});
    // Walking is walking: whoever it leaves behind gets their opportunity
    // attack, however it came to move.
    provoked = resolvePcOpportunityAttacks(campaign, enemy.id, origin, landing, walked.length ? walked : undefined);
    // The spell areas it walked into (src/lib/dm/zone-triggers.ts).
    provoked.push(...zonesAfterMove(campaign, encounterId, { kind: "enemy", refId: enemy.id }, origin, walked.length ? walked : [landing]));
  }
  const distance = chebyshev(landing.x, landing.y, target.x, target.y);
  const moved = landing.x !== origin.x || landing.y !== origin.y;
  const base = {
    distance,
    ...(moved ? { movedTo: `(${landing.x},${landing.y})` } : {}),
    ...(provoked.length ? { opportunityAttacks: provoked } : {}),
  };
  if (reachesFrom(landing) && swingMode(profile, distance)) {
    // A Wind Wall between them turns its arrows (zone-rules.ts).
    const blown = swingMode(profile, distance)?.ranged ? missileProblem(encounterId, enemy.id, targetRef, target.name) : null;
    return blown ? { ...base, blocked: { error: blown } } : base;
  }
  const why = fear
    ? `${attacker.name} is frightened and will not move closer to what it fears`
    : profile.melee
      ? `${attacker.name} is ${distance * 5} ft from ${target.name} and cannot reach them this turn`
      : sightFrom(landing)
        ? `${attacker.name} is ${distance * 5} ft from ${target.name}, beyond this attack's ${profile.longRangeTiles * 5} ft range, and cannot close the gap this turn`
        : `${attacker.name} has no line of sight to ${target.name} and cannot reach a firing position this turn`;
  return {
    ...base,
    blocked: {
      error: `${why}${moved ? `; it moved to (${landing.x},${landing.y})` : ""}. Use a ranged option, a different target, or another action.`,
    },
  };
}

// Pack Tactics' condition: another enemy of the target, standing and able to
// act, within 5 feet of it (SRD 5.1).
export function enemyAllyNear(encounterId: string, enemyId: string, targetRef: string): boolean {
  const map = getBattleMapForEncounter(encounterId);
  const target = map ? getTokenByRef(map.id, targetRef) : null;
  if (!map || !target) {
    return false;
  }
  return listEnemies(encounterId).some((ally) => {
    if (ally.id === enemyId || ally.status !== "alive" || isIncapacitated(ally.conditions)) {
      return false;
    }
    const token = getTokenByRef(map.id, ally.id);
    return Boolean(token && chebyshev(token.x, token.y, target.x, target.y) <= 1);
  });
}

// An enemy's walking traits on the board: a swimming or climbing speed from
// its stat block, whose spaces it may pass through (its allies', a
// character's two sizes apart, src/lib/battlemap/passage.ts), and, for a
// creature larger than one square, squeezing where one size smaller fits.
export function enemyMoveTraits(width: number, tokens: BattleToken[], mover: BattleToken, encounterId: string): MoveTraits {
  const enemies = new Map(listEnemies(encounterId).map((entry) => [entry.id, entry]));
  const sizeOf = (token: BattleToken): string | undefined => {
    if (token.kind === "enemy") {
      return enemies.get(token.refId)?.stats.size;
    }
    if (token.kind === "pc") {
      const sheet = getSheetById(token.refId);
      return sheet ? sizeForRace(sheet.race) : undefined;
    }
    return undefined;
  };
  const footprintOf = (token: BattleToken) =>
    token.kind === "enemy" ? footprintForSize(enemies.get(token.refId)?.stats.size) : 1;
  const speed = enemies.get(mover.refId)?.stats.speed;
  // And what the spell areas on the board make of each step (zone-rules.ts).
  return zoneStepsFor({
    swims: swimsFrom(speed),
    climbs: climbsFrom(speed),
    passable: passableTiles({ width, tokens, mover, footprintOf, sizeOf }),
    squeeze: footprintOf(mover) > 1,
  }, encounterId, "enemy", mover.refId);
}
