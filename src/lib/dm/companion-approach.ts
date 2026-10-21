import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef, listTokens, type BattleMap } from "@/lib/db/battle-maps";
import { listEnemies, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { footprintForSize } from "@/lib/battlemap/footprint";
import { chebyshev, inBounds, tileIndex, type BattleToken } from "@/lib/battlemap/types";
import { footprintLookup, occupiedTiles } from "@/lib/battlemap/view";
import { walkCharacter } from "@/lib/dm/token-rules";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The open squares beside a target of the given footprint, nearest the mover
// first: where a character must stand to strike it in melee. The companion's
// walk below tries them in turn; a player's attack out of reach is refused
// with the first one named (map-tools.ts checkPcAttackRange), so a model that
// cannot count tiles still knows where to move.
export function openSquaresBeside(
  encounterId: string,
  map: BattleMap,
  mover: BattleToken,
  target: BattleToken,
  size: number,
): Array<{ x: number; y: number }> {
  const enemiesById = new Map(listEnemies(encounterId).map((enemy) => [enemy.id, enemy]));
  const occupied = occupiedTiles(map, listTokens(map.id), mover, footprintLookup(enemiesById));
  const squares: Array<{ x: number; y: number }> = [];
  for (let x = target.x - 1; x <= target.x + size; x += 1) {
    for (let y = target.y - 1; y <= target.y + size; y += 1) {
      const inside = x >= target.x && x < target.x + size && y >= target.y && y < target.y + size;
      if (!inside && inBounds(map.width, map.height, x, y) && !occupied.has(tileIndex(map.width, x, y))) {
        squares.push({ x, y });
      }
    }
  }
  return squares.sort((a, b) => chebyshev(mover.x, mover.y, a.x, a.y) - chebyshev(mover.x, mover.y, b.x, b.y));
}

// An AI companion getting into reach before its basic attack, when the
// server plays its turn (encounter-tools.ts companionAutoAct: the AI's
// backstop, and a person's "Play their turn"). The enemies the server plays
// walk to their target first (enemy-approach.ts); a companion stood where
// it was and reported it was out of reach. It walks as a character walks on
// the board (walkCharacter: its speed this turn, prone, allies' spaces,
// fear, the opportunity attacks it draws), toward the nearest open square
// beside the target, as far as its speed carries it. Returns the line for
// the table note, or null when it did not move.
export function approachForCompanion(
  campaign: Campaign,
  encounter: Encounter,
  sheet: CharacterSheet,
  target: EncounterEnemy,
): string | null {
  const map = getBattleMapForEncounter(encounter.id);
  if (!map) {
    return null;
  }
  const me = getTokenByRef(map.id, sheet.id);
  const them = getTokenByRef(map.id, target.id);
  if (!me || !them) {
    return null;
  }
  const size = footprintForSize(target.stats.size);
  const touching = (x: number, y: number) => {
    for (let dx = 0; dx < size; dx += 1) {
      for (let dy = 0; dy < size; dy += 1) {
        if (chebyshev(x, y, them.x + dx, them.y + dy) <= 1) {
          return true;
        }
      }
    }
    return false;
  };
  if (touching(me.x, me.y)) {
    return null;
  }
  for (const square of openSquaresBeside(encounter.id, map, me, them, size)) {
    const walked = walkCharacter(campaign, encounter, map, sheet, me, square);
    if ("error" in walked) {
      continue;
    }
    const now = getTokenByRef(map.id, sheet.id);
    return now && (now.x !== me.x || now.y !== me.y)
      ? `${sheet.name} moves toward ${target.displayName}.`
      : null;
  }
  return null;
}
