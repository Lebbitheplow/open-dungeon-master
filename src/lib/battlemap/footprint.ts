// How many squares a creature takes up. A Large ogre is two by two and
// cannot squeeze down a one-tile corridor; the pathfinder, the projection
// and the renderer all ask this module rather than each guessing from the
// size word. Pure and dependency-free.

import { tileIndex, type XY } from "@/lib/battlemap/types";

export type Footprint = 1 | 2 | 3 | 4;

export function footprintForSize(size: string | undefined | null): Footprint {
  switch ((size ?? "").trim().toLowerCase()) {
    case "large":
      return 2;
    case "huge":
      return 3;
    case "gargantuan":
      return 4;
    default:
      return 1;
  }
}

// The tiles a creature standing at (x, y) with this footprint occupies. The
// anchor is the top-left square; a footprint of 1 is the tile itself.
export function footprintTiles(at: XY, footprint: Footprint): XY[] {
  const tiles: XY[] = [];
  for (let dy = 0; dy < footprint; dy += 1) {
    for (let dx = 0; dx < footprint; dx += 1) {
      tiles.push({ x: at.x + dx, y: at.y + dy });
    }
  }
  return tiles;
}

export function footprintIndexes(width: number, at: XY, footprint: Footprint): number[] {
  return footprintTiles(at, footprint).map((tile) => tileIndex(width, tile.x, tile.y));
}

// Whether every tile of the footprint is inside the map.
export function footprintFits(
  width: number,
  height: number,
  at: XY,
  footprint: Footprint,
): boolean {
  return at.x >= 0 && at.y >= 0 && at.x + footprint <= width && at.y + footprint <= height;
}

// The centre of a footprint in tile units, for drawing and for distance.
export function footprintCentre(at: XY, footprint: Footprint): XY {
  return { x: at.x + (footprint - 1) / 2, y: at.y + (footprint - 1) / 2 };
}
