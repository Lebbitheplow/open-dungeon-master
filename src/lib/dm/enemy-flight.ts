// A creature that has to run, run for it (issue #621). A turned undead, a
// creature fleeing Fear or Command's flee spends its turn on the Dash and
// running from what it flees (src/lib/dm/flee-logic.ts); a turn the model
// skipped used to play its attack instead, which its condition refuses, so
// the turn passed with the creature standing still. The backstop
// (encounter-tools.ts autoActSkippedEnemies) and the console's "run the
// monsters" helper (delegate.ts) play it here, through the same take_action
// and move_token every other caller uses: the turn order, the Dash's
// movement, the opportunity attacks it draws, the spell areas it crosses.
//
// Must not be imported by map-tools or enemy-actions (it imports them).

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, listEnemies, type EncounterEnemy } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef, listTokens } from "@/lib/db/battle-maps";
import { reachableTiles } from "@/lib/battlemap/movement";
import { footprintLookup, occupiedTiles } from "@/lib/battlemap/view";
import { chebyshev } from "@/lib/battlemap/types";
import { enemyMoveTraits, fearSourceAt } from "@/lib/dm/enemy-approach";
import { handleEnemyTakeAction } from "@/lib/dm/enemy-actions";
import { enemyMoveBudget } from "@/lib/dm/enemy-speed";
import { farthestFrom, fleeHold, nearerSquares, TURNED } from "@/lib/dm/flee-logic";
import { handleMoveToken } from "@/lib/dm/map-tools";
import { otherSide } from "@/lib/dm/combat-sides-logic";
import { sideOf, standingOn } from "@/lib/dm/combatant";
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type XY = { x: number; y: number };

// What it runs from: the one it fears or was turned by, else the nearest
// creature of the other side.
function runFrom(campaignId: string, enemy: EncounterEnemy, mapId: string, at: XY): XY | null {
  const feared = fearSourceAt(mapId, enemy.conditions, enemy.conditionMeta as Record<string, { source?: string }>);
  if (feared) {
    return feared;
  }
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return null;
  }
  const foes = standingOn(campaignId, encounter, otherSide(sideOf(encounter, "enemy", enemy.id, enemy)));
  let nearest: XY | null = null;
  for (const foe of foes) {
    const token = getTokenByRef(mapId, foe.id);
    if (token && (!nearest || chebyshev(at.x, at.y, token.x, token.y) < chebyshev(at.x, at.y, nearest.x, nearest.y))) {
      nearest = { x: token.x, y: token.y };
    }
  }
  return nearest;
}

// The square it can reach this turn farthest from `source`, or null when
// nowhere is farther than where it stands.
function escapeSquare(enemy: EncounterEnemy, source: XY, extraTiles: number): XY | null {
  const encounter = getActiveEncounter(enemy.campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, enemy.id) : null;
  if (!encounter || !map || !token) {
    return null;
  }
  const tokens = listTokens(map.id);
  const enemiesById = new Map(listEnemies(encounter.id).map((entry) => [entry.id, entry]));
  const footprints = footprintLookup(enemiesById);
  // Never through a square nearer what it runs from: move_token takes the
  // same way round (map-tools.ts), so the square picked is one it reaches.
  const occupied = new Set([...occupiedTiles(map, tokens, token, footprints), ...nearerSquares(map.width, map.height, token, source)]);
  const budget = enemyMoveBudget(encounter, enemy, token).tilesLeft + extraTiles;
  const reached = reachableTiles(map.terrain, map.width, map.height, occupied, token, budget, footprints(token), token.movement === "fly", enemyMoveTraits(map.width, tokens, token, encounter.id));
  const squares = [...reached.entries()].map(([index, cost]) => ({ x: index % map.width, y: Math.floor(index / map.width), cost }));
  return farthestFrom(token, source, squares);
}

function outcome(result: Record<string, unknown>): string {
  return typeof result.error === "string" ? result.error : "";
}

// Dash, then run to the farthest square it reaches from what it runs from.
// The line for the table, or the reason it could not.
export function runAway(
  campaign: Campaign,
  turn: DmTurn,
  enemy: EncounterEnemy,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  why: string,
): string {
  const encounter = getActiveEncounter(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, enemy.id) : null;
  const source = map && token ? runFrom(campaign.id, enemy, map.id, token) : null;
  const speed = encounter && token ? enemyMoveBudget(encounter, enemy, token).speedTiles : 0;
  // Turn Undead: "If there's nowhere to move, the creature can use the Dodge
  // action"; held fast, it tries to escape what holds it.
  if (map && token && source && speed > 0 && !escapeSquare(enemy, source, speed)) {
    if (enemy.conditions.some((entry) => isConditionNamed(entry, TURNED))) {
      const dodged = handleEnemyTakeAction(campaign, turn, { enemyId: enemy.id, action: "dodge" });
      return dodged.error ? `${enemy.displayName} is cornered and cannot run: ${outcome(dodged)}` : `${enemy.displayName} is ${why}, cornered with nowhere to run: it takes the Dodge action.`;
    }
    return `${enemy.displayName} is ${why} but has nowhere to run.`;
  }
  if (speed <= 0 && encounter && token && enemy.conditions.some((entry) => isConditionNamed(entry, "grappled", "restrained"))) {
    const freed = handleEnemyTakeAction(campaign, turn, { enemyId: enemy.id, action: "escape" });
    return freed.error ? `${enemy.displayName} is ${why} and held fast: ${outcome(freed)}` : `${enemy.displayName} is ${why} and held fast: it tries to escape (${freed.success ? "and breaks free" : "and fails"}).`;
  }
  const dashed = handleEnemyTakeAction(campaign, turn, { enemyId: enemy.id, action: "dash" });
  if (!map || !token || !source) {
    return dashed.error ? `${enemy.displayName} is ${why} but cannot run: ${outcome(dashed)}` : `${enemy.displayName} is ${why}: it takes the Dash action and runs.`;
  }
  const live = getEnemy(enemy.id) ?? enemy;
  const to = escapeSquare(live, source, 0);
  if (!to) {
    return dashed.error ? `${enemy.displayName} is ${why} but cannot run: ${outcome(dashed)}` : `${enemy.displayName} is ${why}: it Dashes, but no square takes it farther away.`;
  }
  const walked = handleMoveToken(campaign, JSON.stringify({ token: enemy.id, x: to.x, y: to.y }), sheets, sheetsById, turn);
  if (walked.error) {
    return `${enemy.displayName} is ${why} but cannot run: ${outcome(walked)}`;
  }
  const struck = Array.isArray(walked.opportunityAttacks) ? ` ${(walked.opportunityAttacks as string[]).join(" ")}` : "";
  return `${enemy.displayName} is ${why}: it ${dashed.error ? "runs" : "takes the Dash action and runs"} to ${String(walked.at)}.${struck}`;
}

// A creature whose condition makes it run takes its turn running: the line
// for the table, or null for one that does not have to.
export function fleeTurn(
  campaign: Campaign,
  turn: DmTurn,
  enemy: EncounterEnemy,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): string | null {
  const hold = fleeHold(enemy.conditions);
  return hold ? runAway(campaign, turn, enemy, sheets, sheetsById, hold) : null;
}
