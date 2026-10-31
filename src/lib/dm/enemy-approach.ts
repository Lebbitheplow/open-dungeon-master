import type { Campaign } from "@/lib/db/campaigns";
import { tokenSides } from "@/lib/dm/combatant";
import { allyBeside } from "@/lib/dm/side-allies";
import { getEncounter, listEnemies, patchEnemyConditions, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef, listTokens, moveToken, resetTurnBudgets } from "@/lib/db/battle-maps";
import { findPath, walkPathWithBudget } from "@/lib/battlemap/movement";
import { hasLineOfSight } from "@/lib/battlemap/los";
import { bestFiringPosition } from "@/lib/battlemap/tactics";
import { occupiedTiles } from "@/lib/battlemap/view";
import { chebyshev, climbsFrom, swimsFrom, type BattleToken, type MoveTraits } from "@/lib/battlemap/types";
import { footprintDistance, footprintForSize, nearestFootprintTile } from "@/lib/battlemap/footprint";
import { tokenFootprint } from "@/lib/dm/board-reach";

import { passableTiles } from "@/lib/battlemap/passage";
import { getSheetById } from "@/lib/db/sheets";
import { sizeForRace } from "@/lib/srd";
import { removeConditions } from "@/lib/dm/condition-logic";
import { resolvePcOpportunityAttacks } from "@/lib/dm/opportunity";
import { publishEphemeral } from "@/lib/events";
import { swingMode, type EnemyAttackProfile } from "@/lib/dm/enemy-profile";
import { enemyMoveBudget, enemySpeedTiles } from "@/lib/dm/enemy-speed";
import { endsOwedTurn, markEnemyActed } from "@/lib/dm/can-act";
import { forgetEnemyTurns } from "@/lib/dm/enemy-turn-logic";
import { FLEEING, TURNED } from "@/lib/dm/flee-logic";
import { aggressiveSteps } from "@/lib/dm/enemy-aggressive";
import { missileDeflection, zoneStepsFor } from "@/lib/dm/zone-rules";
import { zonesAfterMove } from "@/lib/dm/zone-triggers";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { AttackStop } from "@/lib/dm/turn-lines-logic";

// An enemy getting to where its attack reaches, on its own turn (SRD 5.1,
// Movement and Position): it stands up from prone for half its speed, walks
// no farther than its speed, stops as soon as its reach or its range covers
// the target, never walks closer to what it is frightened of, and draws the
// opportunity attacks of whoever it walks away from (none after a
// Disengage this turn). A model that never calls move_token still gets
// spatially honest enemies. Must not import encounter-tools or map-tools
// (they import this).

type XY = { x: number; y: number };

export type Approach = {
  // The refusal, when the attack cannot be made this turn, tagged with why
  // (turn-lines-logic.ts), so the backstop's line names it (issue #666).
  blocked?: ToolError & { heldGround?: string; stop: AttackStop };
  // A Wind Wall between them: why a ranged weapon swing misses.
  deflected?: string;
  movedTo?: string;
  opportunityAttacks?: string[];
  // Squares between the two after the approach; null with no board.
  distance: number | null;
};

// Where the creature it fears stands, when it fears one on the board: the
// source of its frightened, the cleric who turned it, or the caster it flees
// at Command's word (none of them walks closer, SRD 5.1; issue #621).
export function fearSourceAt(
  mapId: string,
  conditions: string[],
  meta: Record<string, { source?: string } | undefined>,
): XY | null {
  const held = ["frightened", TURNED, FLEEING].map((name) => conditions.find((entry) => entry.toLowerCase() === name)).filter((entry): entry is string => Boolean(entry));
  const source = held.map((name) => meta?.[name]?.source).find(Boolean);
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
  if (!ownTurnFollows) {
    return;
  }
  // The own turn starts clean: a Disengage or a Dash of the owed turn is
  // no part of it (src/lib/dm/enemy-turn-logic.ts).
  forgetEnemyTurns(encounter, [enemyId]);
  const map = getBattleMapForEncounter(encounter.id);
  if (map) {
    resetTurnBudgets(map.id, [enemyId]);
  }
}

// What standing up would cost a prone enemy now, in squares: half its
// speed, or null when it stays down (no speed, or less than that left, its
// Dashes counted: issue #621). 0 when it is not prone.
export function standUpCost(encounterId: string, enemy: EncounterEnemy): number | null {
  if (!enemy.conditions.some((entry) => entry.toLowerCase() === "prone")) {
    return 0;
  }
  const map = getBattleMapForEncounter(encounterId);
  const token = map ? getTokenByRef(map.id, enemy.id) : null;
  const budget = token ? enemyMoveBudget(getEncounter(encounterId), enemy, token) : null;
  const full = budget ? budget.speedTiles : enemySpeedTiles(enemy);
  const half = Math.floor(full / 2);
  if (full <= 0 || (budget && budget.tilesLeft < half)) {
    return null;
  }
  return half;
}

// A prone enemy stands at the start of what it does on its turn, paying
// half its speed; with less than that left it stays down (and crawls, which
// the walk below does not attempt). Returns the enemy as it now stands.
export function standUpIfProne(encounterId: string, enemy: EncounterEnemy): { enemy: EncounterEnemy; stood: boolean } {
  const prone = enemy.conditions.find((entry) => entry.toLowerCase() === "prone");
  const half = prone ? standUpCost(encounterId, enemy) : null;
  if (!prone || half === null) {
    return { enemy, stood: false };
  }
  const map = getBattleMapForEncounter(encounterId);
  const token = map ? getTokenByRef(map.id, enemy.id) : null;
  if (token) {
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
  // A character holding a readied action (readied-release.ts readiedHolder):
  // while one waits, an enemy out of reach is not walked in and swung in one
  // call. The DM moves it with move_token, judges the trigger, then attacks.
  holdGround: { holder: string; trigger: string } | null = null,
  // Only asks: works out the walk and whether the attack then reaches,
  // and moves nothing (reachesThisTurn).
  options: { dryRun?: boolean } = {},
): Approach {
  const map = getBattleMapForEncounter(encounterId);
  const attacker = map ? getTokenByRef(map.id, enemy.id) : null;
  const target = map ? getTokenByRef(map.id, targetRef) : null;
  if (!map || !attacker || !target) {
    return { distance: null };
  }
  // Measured between the nearest squares of the two (src/lib/battlemap/
  // footprint.ts): an ogre two squares wide reaches a character against
  // either of them, and is reached from either.
  const mine = footprintForSize(enemy.stats.size);
  const theirs = tokenFootprint(target);
  const apart = (at: XY) => footprintDistance(at, mine, target, theirs);
  const sightFrom = (at: XY) => {
    const to = nearestFootprintTile(target, theirs, at);
    const from = nearestFootprintTile(at, mine, to);
    return hasLineOfSight(map.terrain, map.width, from.x, from.y, to.x, to.y);
  };
  const reachesFrom = (at: XY) => {
    const distance = apart(at);
    if (profile.melee && distance <= profile.reachTiles && (distance <= 1 || sightFrom(at))) {
      return true;
    }
    return profile.ranged && distance <= profile.longRangeTiles && sightFrom(at);
  };
  const origin = { x: attacker.x, y: attacker.y };
  const startDistance = apart(origin);

  if (reachesFrom(origin)) {
    // A Wind Wall between them turns its arrows from where it stands too.
    const deflected = swingMode(profile, startDistance)?.ranged ? missileDeflection(encounterId, enemy.id, targetRef, target.name) : null;
    return deflected ? { distance: startDistance, deflected } : { distance: startDistance };
  }
  if (holdGround) {
    return {
      distance: startDistance,
      blocked: {
        error: `${attacker.name} is ${startDistance * 5} ft from ${target.name}, out of reach, and ${holdGround.holder} holds a readied action (${holdGround.trigger}). It does not walk in and attack in one call while someone waits on a trigger: move it with move_token, release ${holdGround.holder}'s readied action if its movement fired the trigger (or let the trigger pass), then call enemy_attack. Nothing was spent.`,
        retry: true,
        heldGround: holdGround.holder,
        stop: "held",
      },
    };
  }

  // Its movement this turn, its Dashes counted, and whether it Disengaged
  // (src/lib/dm/enemy-speed.ts enemyMoveBudget, issue #621).
  const move = enemyMoveBudget(getEncounter(encounterId), enemy, attacker);
  const budget = move.tilesLeft;
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
    const unafraid = awayFromFear(origin, stopAt >= 0 ? approach.slice(0, stopAt + 1) : approach, fear);
    // Aggressive's speed goes only toward a hostile it can see (enemy-aggressive.ts).
    const live = getEncounter(encounterId);
    const wanted = live ? aggressiveSteps(live, map, enemy, attacker, unafraid, swims).steps : unafraid;
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
    const route = spot && allowed ? (findPath(map.terrain, map.width, map.height, occupied, attacker, spot.at) ?? []) : [];
    // A firing position Aggressive's speed would carry it away from a hostile to is not taken.
    const live = getEncounter(encounterId);
    const rushed = live && route.length ? aggressiveSteps(live, map, enemy, attacker, route, enemyMoveTraits(map.width, listTokens(map.id), attacker, enemy.encounterId)) : null;
    if (spot && allowed && !rushed?.cut) {
      landing = spot.at;
      cost = spot.cost;
      walked = route;
    }
  }
  let provoked: string[] = [];
  if (!options.dryRun && (landing.x !== origin.x || landing.y !== origin.y)) {
    moveToken(attacker.id, landing.x, landing.y, attacker.movedThisRound + cost);
    publishEphemeral(campaign.id, "battle_map_updated", {});
    // Walking is walking: whoever it leaves behind gets their opportunity
    // attack, however it came to move, unless it Disengaged this turn: a
    // Nimble Escape goblin's Disengage held for move_token and was forgotten
    // by this walk-up (issue #621).
    provoked = move.disengaged ? [] : resolvePcOpportunityAttacks(campaign, enemy.id, origin, landing, walked.length ? walked : undefined);
    // The spell areas it walked into (src/lib/dm/zone-triggers.ts).
    provoked.push(...zonesAfterMove(campaign, encounterId, { kind: "enemy", refId: enemy.id }, origin, walked.length ? walked : [landing]));
  }
  const distance = apart(landing);
  const moved = landing.x !== origin.x || landing.y !== origin.y;

  const base = {
    distance,
    ...(moved ? { movedTo: `(${landing.x},${landing.y})` } : {}),
    ...(provoked.length ? { opportunityAttacks: provoked } : {}),
  };
  if (reachesFrom(landing) && swingMode(profile, distance)) {
    // A Wind Wall between them turns its arrows (zone-rules.ts): each shot
    // through it is made and misses.
    const deflected = swingMode(profile, distance)?.ranged ? missileDeflection(encounterId, enemy.id, targetRef, target.name) : null;
    return deflected ? { ...base, deflected } : base;
  }
  const why = fear
    ? `${attacker.name} is frightened and will not move closer to what it fears`
    : profile.melee
      ? `${attacker.name} is ${distance * 5} ft from ${target.name} and cannot reach them this turn`
      : sightFrom(landing)
        ? `${attacker.name} is ${distance * 5} ft from ${target.name}, beyond this attack's ${profile.longRangeTiles * 5} ft range, and cannot close the gap this turn`
        : `${attacker.name} has no line of sight to ${target.name} and cannot reach a firing position this turn`;
  const stop: AttackStop = fear ? "fear" : profile.melee ? "reach" : sightFrom(landing) ? "range" : "sight";
  // The game saying no, not a mistake in the call: the walk was made, its
  // movement spent and its opportunity attacks rolled, so a retry told the
  // model nothing had happened (issue #666).
  return {
    ...base,
    blocked: {
      error: `${why}${moved ? `; it moved to (${landing.x},${landing.y})` : ""}. Use a ranged option, a different target, or another action.`,
      refused: "rules",
      stop,
    },
  };
}

// Whether an attack with `profile` reaches the target this turn, walking as
// approachTarget would, without moving anything. True with no board.
export function reachesThisTurn(campaign: Campaign, encounterId: string, enemy: EncounterEnemy, targetRef: string, profile: EnemyAttackProfile): boolean {
  return !approachTarget(campaign, encounterId, enemy, targetRef, profile, null, { dryRun: true }).blocked;
}

// Pack Tactics' condition: another enemy of the target, standing and able to
// act, within 5 feet of it (SRD 5.1).
export function enemyAllyNear(encounterId: string, enemyId: string, targetRef: string): boolean {
  // Its side's, not its kind's (side-allies.ts, issue 503).
  return allyBeside(encounterId, { kind: "enemy", id: enemyId }, targetRef);
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
    passable: passableTiles({ width, tokens, mover, footprintOf, sizeOf, sideOf: tokenSides(getEncounter(encounterId)) }),
    squeeze: footprintOf(mover) > 1,
  }, encounterId, "enemy", mover.refId);
}
