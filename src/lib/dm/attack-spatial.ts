// What the battle map says about an attack beyond range and cover: who
// stands next to whom. Reads the live board; the geometry itself is pure
// and lives in attack-rules.ts. With no map (theatre of the mind) every
// answer is "nothing to add", never a guess.
//
// Must not import encounter-tools, pc-attack or action-tools: all three
// call in here.

import { getBattleMapForEncounter, getTokenByRef, listTokens } from "@/lib/db/battle-maps";
import { listEnemies, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { coverBetween, hasLineOfSight } from "@/lib/battlemap/los";
import { footprintTiles } from "@/lib/battlemap/footprint";
import { nearestSquares, spotOf, tilesApart, tokenFootprint } from "@/lib/dm/board-reach";
import { isIncapacitated } from "@/lib/dm/condition-logic";

import { hostileWithinFiveFeet, isFlanking } from "@/lib/dm/attack-rules";
import { zoneCoverBetween, zoneHidesFrom } from "@/lib/dm/zone-rules";
import { enemySenses } from "@/lib/dm/attack-light";

const lowered = (conditions: string[]) => conditions.map((entry) => entry.toLowerCase());
const blind = (conditions: string[]) => lowered(conditions).includes("blinded");
const unseen = (conditions: string[]) =>
  lowered(conditions).some((entry) => entry === "invisible" || entry === "hidden");

// A creature that threatens: alive, able to act, and able to see.
const enemyThreatens = (enemy: EncounterEnemy) =>
  enemy.status === "alive" && !isIncapacitated(enemy.conditions) && !blind(enemy.conditions);

function characterThreatens(characterId: string): boolean {
  const sheet = getSheetById(characterId);
  return Boolean(
    sheet &&
      sheet.currentHp > 0 &&
      !sheet.deathSaves?.dead &&
      !isIncapacitated(sheet.conditions) &&
      !blind(sheet.conditions),
  );
}

// Tiles between two combatants, nearest square to nearest square (an ogre
// fills four, src/lib/dm/board-reach.ts), or null when either is off the
// board.
export function tilesBetween(encounterId: string, refA: string, refB: string): number | null {
  const map = getBattleMapForEncounter(encounterId);
  const a = map ? getTokenByRef(map.id, refA) : null;
  const b = map ? getTokenByRef(map.id, refB) : null;
  return map && a && b ? tilesApart(a, b) : null;
}


// A wall between two combatants on the board. Melee inside its reach never
// asked this before, so a glaive reached through a wall square.
export function wallBetween(encounterId: string, refA: string, refB: string): boolean {
  const map = getBattleMapForEncounter(encounterId);
  const a = map ? getTokenByRef(map.id, refA) : null;
  const b = map ? getTokenByRef(map.id, refB) : null;
  if (!map || !a || !b) {
    return false;
  }
  const line = nearestSquares(a, b);
  return !hasLineOfSight(map.terrain, map.width, map.height, line.from.x, line.from.y, line.to.x, line.to.y);
}


// A character shooting with a hostile creature within 5 feet that can see
// them and can act.
export function characterShootsInMelee(
  encounterId: string,
  characterId: string,
  attackerConditions: string[],
): boolean {
  const map = getBattleMapForEncounter(encounterId);
  const attacker = map ? getTokenByRef(map.id, characterId) : null;
  if (!map || !attacker || unseen(attackerConditions)) {
    return false;
  }
  const hostiles = listEnemies(encounterId)
    .filter(enemyThreatens)
    .map((enemy) => getTokenByRef(map.id, enemy.id))
    .filter((token): token is NonNullable<typeof token> => token !== null)
    .map(spotOf);
  return hostileWithinFiveFeet(spotOf(attacker), hostiles);
}


// The same for an enemy with a bow and a character at its elbow.
export function enemyShootsInMelee(
  encounterId: string,
  enemyId: string,
  attackerConditions: string[],
): boolean {
  const map = getBattleMapForEncounter(encounterId);
  const attacker = map ? getTokenByRef(map.id, enemyId) : null;
  if (!map || !attacker || unseen(attackerConditions)) {
    return false;
  }
  const hostiles = listTokens(map.id).filter(
    (token) => token.kind === "pc" && characterThreatens(token.refId),
  );
  return hostileWithinFiveFeet(spotOf(attacker), hostiles.map(spotOf));
}


// The Flanking variant for a character's melee attack: another character
// who can act stands on the far side of the target.
export function characterFlanks(
  encounterId: string,
  characterId: string,
  enemyId: string,
): boolean {
  const map = getBattleMapForEncounter(encounterId);
  const attacker = map ? getTokenByRef(map.id, characterId) : null;
  const target = map ? getTokenByRef(map.id, enemyId) : null;
  if (!map || !attacker || !target) {
    return false;
  }
  const allies = listTokens(map.id).filter(
    (token) =>
      token.kind === "pc" && token.refId !== characterId && characterThreatens(token.refId),
  );
  return isFlanking(spotOf(attacker), spotOf(target), allies.map(spotOf));
}


// And for an enemy's melee attack on a character.
export function enemyFlanks(encounterId: string, enemyId: string, characterId: string): boolean {
  const map = getBattleMapForEncounter(encounterId);
  const attacker = map ? getTokenByRef(map.id, enemyId) : null;
  const target = map ? getTokenByRef(map.id, characterId) : null;
  if (!map || !attacker || !target) {
    return false;
  }
  const allies = listEnemies(encounterId)
    .filter((enemy) => enemy.id !== enemyId && enemyThreatens(enemy))
    .map((enemy) => getTokenByRef(map.id, enemy.id))
    .filter((token): token is NonNullable<typeof token> => token !== null)
    .map(spotOf);
  return isFlanking(spotOf(attacker), spotOf(target), allies);
}


// Cover a target has against an attacker, as the AC bonus: 0, +2 (half) or
// +5 (three-quarters). The terrain's (a wall, a low wall), and a creature
// standing in the line between them, which gives half cover (SRD 5.1,
// Cover); covers do not add up, the best one counts. The same reading
// pc_attack takes for an enemy behind a wall, asked for a character.
export function coverFor(encounterId: string, attackerRef: string, targetRef: string): 0 | 2 | 5 {
  const map = getBattleMapForEncounter(encounterId);
  const attacker = map ? getTokenByRef(map.id, attackerRef) : null;
  const target = map ? getTokenByRef(map.id, targetRef) : null;
  if (!map || !attacker || !target) {
    return 0;
  }
  const line = nearestSquares(attacker, target);
  const terrain = coverBetween(
    map.terrain,
    map.width,
    map.height,
    line.from.x,
    line.from.y,
    line.to.x,
    line.to.y,
  );

  // Blade Barrier gives three-quarters cover to what stands behind it (zone-rules.ts).
  const blades = zoneCoverBetween(encounterId, attackerRef, targetRef);
  return terrain === 5 || blades === 5 ? 5 : creatureCover(encounterId, attackerRef, targetRef) ? 2 : terrain;
}

// Every square strictly between two on a straight line (Bresenham), the
// squares a creature would have to stand on to be in the way.
export function squaresBetween(
  from: { x: number; y: number },
  to: { x: number; y: number },
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const dy = -Math.abs(to.y - from.y);
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    if (x === to.x && y === to.y) {
      break;
    }
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
    if (x === to.x && y === to.y) {
      break;
    }
    out.push({ x, y });
  }
  return out;
}

// The creature standing in the line between an attacker and its target,
// which gives the target half cover (SRD 5.1: "another creature"), or null.
// Toe to toe nothing stands between them.
export function creatureCover(encounterId: string, attackerRef: string, targetRef: string): string | null {
  const map = getBattleMapForEncounter(encounterId);
  const attacker = map ? getTokenByRef(map.id, attackerRef) : null;
  const target = map ? getTokenByRef(map.id, targetRef) : null;
  if (!map || !attacker || !target || tilesApart(attacker, target) <= 1) {
    return null;
  }
  const ends = nearestSquares(attacker, target);
  const line = squaresBetween(ends.from, ends.to);
  const blocker = listTokens(map.id).find(
    (token) =>
      token.refId !== attackerRef &&
      token.refId !== targetRef &&
      (token.kind === "pc" || token.kind === "enemy" || token.kind === "npc") &&
      footprintTiles(token, tokenFootprint(token)).some((tile) =>
        line.some((square) => square.x === tile.x && square.y === tile.y),
      ),
  );

  return blocker ? blocker.name : null;
}

// Whether any enemy that can see has a clear view of the character: a
// sight line and no cover between them. Hiding needs this to be false.
export function seenClearlyBy(encounterId: string, characterId: string): string | null {
  const map = getBattleMapForEncounter(encounterId);
  const hider = map ? getTokenByRef(map.id, characterId) : null;
  if (!map || !hider) {
    return null;
  }
  for (const enemy of listEnemies(encounterId)) {
    if (enemy.status !== "alive" || blind(enemy.conditions)) {
      continue;
    }
    const token = getTokenByRef(map.id, enemy.id);
    if (!token) {
      continue;
    }
    const line = nearestSquares(token, hider);
    const sighted = hasLineOfSight(
      map.terrain,
      map.width,
      map.height,
      line.from.x,
      line.from.y,
      line.to.x,
      line.to.y,
    );
    const cover = coverBetween(
      map.terrain,
      map.width,
      map.height,
      line.from.x,
      line.from.y,
      line.to.x,
      line.to.y,
    );

    const dark = map.ambient === "dark" && hider.lightRadius <= 0;
    // A fog cloud or magical darkness between them hides as darkness does.
    if (sighted && cover === 0 && !dark && !zoneHidesFrom(map, token, hider, enemySenses(enemy))) {
      return enemy.displayName;
    }
  }
  return null;
}
