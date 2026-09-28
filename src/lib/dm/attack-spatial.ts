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
import { chebyshev } from "@/lib/battlemap/types";
import { isIncapacitated } from "@/lib/dm/condition-logic";
import { hostileWithinFiveFeet, isFlanking } from "@/lib/dm/attack-rules";

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

// Tiles between two combatants, or null when either is off the board.
export function tilesBetween(encounterId: string, refA: string, refB: string): number | null {
  const map = getBattleMapForEncounter(encounterId);
  const a = map ? getTokenByRef(map.id, refA) : null;
  const b = map ? getTokenByRef(map.id, refB) : null;
  return map && a && b ? chebyshev(a.x, a.y, b.x, b.y) : null;
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
  return !hasLineOfSight(map.terrain, map.width, map.height, a.x, a.y, b.x, b.y);
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
    .filter((token): token is NonNullable<typeof token> => token !== null);
  return hostileWithinFiveFeet(attacker, hostiles);
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
  return hostileWithinFiveFeet(attacker, hostiles);
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
  return isFlanking(attacker, target, allies);
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
    .filter((token): token is NonNullable<typeof token> => token !== null);
  return isFlanking(attacker, target, allies);
}

// Cover the terrain gives a target against an attacker, as the AC bonus:
// 0, +2 (half) or +5 (three-quarters). The same reading pc_attack takes for
// an enemy behind a wall, asked for a character behind one.
export function coverFor(encounterId: string, attackerRef: string, targetRef: string): 0 | 2 | 5 {
  const map = getBattleMapForEncounter(encounterId);
  const attacker = map ? getTokenByRef(map.id, attackerRef) : null;
  const target = map ? getTokenByRef(map.id, targetRef) : null;
  if (!map || !attacker || !target) {
    return 0;
  }
  return coverBetween(
    map.terrain,
    map.width,
    map.height,
    attacker.x,
    attacker.y,
    target.x,
    target.y,
  );
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
    const sighted = hasLineOfSight(
      map.terrain,
      map.width,
      map.height,
      token.x,
      token.y,
      hider.x,
      hider.y,
    );
    const cover = coverBetween(
      map.terrain,
      map.width,
      map.height,
      token.x,
      token.y,
      hider.x,
      hider.y,
    );
    const dark = map.ambient === "dark" && hider.lightRadius <= 0;
    if (sighted && cover === 0 && !dark) {
      return enemy.displayName;
    }
  }
  return null;
}
