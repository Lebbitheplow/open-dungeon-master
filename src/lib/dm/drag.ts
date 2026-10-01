// Dragging a grappled creature (SRD 5.1, Grappling: Moving a Grappled
// Creature): "When you move, you can drag or carry the grappled creature
// with you, but your speed is halved, unless the creature is two or more
// sizes smaller than you." On the board the grappler asks for the drag with
// its move; every square then costs double, and each creature it holds is
// set down behind it, next to where it stops, so the grapple holds. A move
// without the drag lets go as before (grapple.ts).

import { footprintFits, footprintTiles, type Footprint } from "@/lib/battlemap/footprint";
import { blocksMoveFor, chebyshev, tileAt, tileIndex, type BattleToken, type XY } from "@/lib/battlemap/types";
import { sizeRank } from "@/lib/bestiary/statblock";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";

export type Held = { refId: string; name: string; size?: string };

type Gripped = { id: string; conditions: string[]; conditionMeta?: ConditionMetaMap };

// Whether `creature` is grappled by `grapplerId`.
export function grappledBy(creature: Gripped, grapplerId: string): boolean {
  const name = creature.conditions.find((entry) => entry.trim().toLowerCase() === "grappled");
  return Boolean(name && creature.conditionMeta?.[name]?.source === grapplerId);
}

// Half speed (every square doubled) unless every creature dragged is two or
// more sizes smaller than the grappler.
export function dragCostFactor(grapplerSize: string | undefined, held: Held[]): 1 | 2 {
  const mine = sizeRank(grapplerSize);
  return held.every((creature) => sizeRank(creature.size) <= mine - 2) ? 1 : 2;
}

// Where each dragged creature is set down: the squares walked, nearest the
// landing first, then any square beside the landing; every square of its
// footprint free, walkable, and within 5 feet of the grappler. Null when one
// of them has nowhere to go.
export function dragPlacements(input: {
  terrain: string;
  width: number;
  height: number;
  // Squares held by everyone but the dragged, the grappler at its landing.
  occupied: Set<number>;
  landing: XY;
  walked: XY[];
  dragged: Array<{ token: BattleToken; footprint: Footprint }>;
}): Array<{ token: BattleToken; at: XY }> | null {
  const { terrain, width, height, landing } = input;
  const taken = new Set(input.occupied);
  const placements: Array<{ token: BattleToken; at: XY }> = [];
  const near: XY[] = [];
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      near.push({ x: landing.x + dx, y: landing.y + dy });
    }
  }
  near.sort((a, b) => chebyshev(a.x, a.y, landing.x, landing.y) - chebyshev(b.x, b.y, landing.x, landing.y));
  const trail = [...input.walked].reverse().filter((step) => step.x !== landing.x || step.y !== landing.y);
  for (const { token, footprint } of input.dragged) {
    const fits = (at: XY) => {
      if (!footprintFits(width, height, at, footprint)) {
        return false;
      }
      const tiles = footprintTiles(at, footprint);
      const beside = tiles.some((tile) => chebyshev(tile.x, tile.y, landing.x, landing.y) === 1);
      return (
        beside &&
        tiles.every(
          (tile) =>
            (tile.x !== landing.x || tile.y !== landing.y) &&
            !blocksMoveFor(tileAt(terrain, width, tile.x, tile.y), false) &&
            !taken.has(tileIndex(width, tile.x, tile.y)),
        )
      );
    };
    const at = [...trail, ...near].find(fits);
    if (!at) {
      return null;
    }
    for (const tile of footprintTiles(at, footprint)) {
      taken.add(tileIndex(width, tile.x, tile.y));
    }
    placements.push({ token, at });
  }
  return placements;
}
