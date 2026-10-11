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

// Squares between two creatures of any size: the Chebyshev distance between
// the nearest squares each occupies, zero when they overlap. Anchor to anchor
// put a Large creature's far side two squares from a character standing
// against it, and refused the rapier (issue #186).
export function footprintDistance(a: XY, aFootprint: Footprint, b: XY, bFootprint: Footprint): number {
  const gap = (lo: number, loSize: number, hi: number, hiSize: number) =>
    Math.max(0, hi - (lo + loSize - 1), lo - (hi + hiSize - 1));
  return Math.max(gap(a.x, aFootprint, b.x, bFootprint), gap(a.y, aFootprint, b.y, bFootprint));
}

// The square of a footprint nearest to a point: where a sight line or a
// cover reading to a large creature is drawn to.
export function nearestFootprintTile(at: XY, footprint: Footprint, toward: XY): XY {
  const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
  return {
    x: clamp(toward.x, at.x, at.x + footprint - 1),
    y: clamp(toward.y, at.y, at.y + footprint - 1),
  };
}

// Which side of a creature's space another creature lies on, per axis: -1
// before it, 0 level with it, 1 past it. Two creatures flank a third when
// their sides are opposite: opposite edges or opposite corners of its space.
export function footprintSide(spot: XY, spotFootprint: Footprint, at: XY, footprint: Footprint): XY {
  const side = (lo: number, size: number, otherLo: number, otherSize: number) =>
    lo + size - 1 < otherLo ? -1 : lo > otherLo + otherSize - 1 ? 1 : 0;
  return {
    x: side(spot.x, spotFootprint, at.x, footprint),
    y: side(spot.y, spotFootprint, at.y, footprint),
  };
}
