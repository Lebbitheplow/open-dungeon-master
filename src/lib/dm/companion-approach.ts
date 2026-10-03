import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef, listTokens } from "@/lib/db/battle-maps";
import { listEnemies, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { footprintForSize } from "@/lib/battlemap/footprint";
import { chebyshev, inBounds, tileIndex } from "@/lib/battlemap/types";
import { footprintLookup, occupiedTiles } from "@/lib/battlemap/view";
import { walkCharacter } from "@/lib/dm/token-rules";
import type { CharacterSheet } from "@/lib/schemas/sheet";

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
  const tokens = listTokens(map.id);
  const enemiesById = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  const occupied = occupiedTiles(map, tokens, me, footprintLookup(enemiesById));
  const squares: Array<{ x: number; y: number }> = [];
  for (let x = them.x - 1; x <= them.x + size; x += 1) {
    for (let y = them.y - 1; y <= them.y + size; y += 1) {
      const inside = x >= them.x && x < them.x + size && y >= them.y && y < them.y + size;
      if (!inside && inBounds(map.width, map.height, x, y) && !occupied.has(tileIndex(map.width, x, y))) {
        squares.push({ x, y });
      }
    }
  }
  squares.sort((a, b) => chebyshev(me.x, me.y, a.x, a.y) - chebyshev(me.x, me.y, b.x, b.y));
  for (const square of squares) {
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
