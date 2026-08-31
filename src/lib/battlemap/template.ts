import { blocksMove, chebyshev, inBounds, tileIndex, type XY } from "@/lib/battlemap/types";
import { hasLineOfSight } from "@/lib/battlemap/los";

// Measured templates: the cone, sphere, line and cube a spell is written in,
// resolved onto the tile grid so a DM can drop a fireball on the board and
// see exactly who is standing in it before anyone rolls.
//
// Pure (no DB) so scripts/test-map-template.mjs can drive it, and so the
// client can draw the same tiles the server counts. The client's copy is a
// preview; the tiles that decide who takes damage are recomputed server-side
// from the real terrain, because the projection a player holds is fogged.
//
// The geometry is the grid approximation every table already uses, not exact
// Euclidean areas: distance is counted in squares (the DMG's optional rule
// this codebase already follows in chebyshev()), and a cone is as wide at
// its end as it is long.

export const TEMPLATE_SHAPES = ["sphere", "cone", "line", "cube"] as const;
export type TemplateShape = (typeof TEMPLATE_SHAPES)[number];

export const SHAPE_LABELS: Record<TemplateShape, string> = {
  sphere: "Sphere",
  cone: "Cone",
  line: "Line",
  cube: "Cube",
};

// What the number beside the shape means, because "20" is a radius for one
// shape and a full length for the next.
export const SHAPE_MEASURES: Record<TemplateShape, string> = {
  sphere: "radius",
  cone: "length",
  line: "length",
  cube: "side",
};

// Bigger than any SRD area, and small enough that the tile sweep below stays
// trivial on a 24x18 board.
export const MAX_TEMPLATE_FEET = 120;
export const MIN_TEMPLATE_FEET = 5;

export type TemplateSpec = {
  shape: TemplateShape;
  // Where the effect is anchored: the caster's tile for a cone, the burst
  // point for a sphere.
  origin: XY;
  // The tile the DM aimed at. For a sphere this is ignored; every other
  // shape takes its direction from it.
  target: XY;
  sizeFeet: number;
};

export type TemplateMap = { terrain: string; width: number; height: number };

function feetToTiles(feet: number): number {
  return Math.max(1, Math.round(feet / 5));
}

// The eight-way heading from origin to target. A component more than twice
// the other reads as a straight line; anything else is a diagonal, so a DM
// aiming roughly north-east gets the diagonal cone they were pointing at.
function heading(origin: XY, target: XY): { sx: number; sy: number; diagonal: boolean } {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax === 0 && ay === 0) {
    return { sx: 1, sy: 0, diagonal: false };
  }
  if (ax > ay * 2) {
    return { sx: Math.sign(dx), sy: 0, diagonal: false };
  }
  if (ay > ax * 2) {
    return { sx: 0, sy: Math.sign(dy), diagonal: false };
  }
  return { sx: Math.sign(dx) || 1, sy: Math.sign(dy) || 1, diagonal: true };
}

// Offsets covered by a cone of `reach` tiles pointing along a heading. The
// cone is as wide at distance k as k itself, which is the 5e cone on a grid.
function coneOffsets(reach: number, sx: number, sy: number, diagonal: boolean): XY[] {
  const out: XY[] = [];
  for (let k = 1; k <= reach; k += 1) {
    const halfWidth = k / 2;
    if (diagonal) {
      for (let a = 0; a <= k; a += 1) {
        for (let b = 0; b <= k; b += 1) {
          if (Math.max(a, b) !== k || Math.abs(a - b) > halfWidth) {
            continue;
          }
          out.push({ x: a * sx, y: b * sy });
        }
      }
      continue;
    }
    // Straight cone: k tiles out along the axis, spreading sideways.
    const spread = Math.floor(halfWidth);
    for (let side = -spread; side <= spread; side += 1) {
      out.push(sx === 0 ? { x: side, y: k * sy } : { x: k * sx, y: side });
    }
  }
  return out;
}

// The tiles a line of `reach` covers, walked from the origin toward the
// target and stopped by the first wall: a lightning bolt does not turn a
// corner.
function lineTiles(map: TemplateMap, origin: XY, target: XY, reach: number): number[] {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const distance = Math.max(1, chebyshev(origin.x, origin.y, target.x, target.y));
  const ux = dx / distance;
  const uy = dy / distance;
  const out: number[] = [];
  const seen = new Set<number>();
  for (let k = 1; k <= reach; k += 1) {
    const x = Math.round(origin.x + ux * k);
    const y = Math.round(origin.y + uy * k);
    if (!inBounds(map.width, map.height, x, y)) {
      break;
    }
    if (blocksMove(map.terrain[tileIndex(map.width, x, y)] ?? "#")) {
      break;
    }
    const idx = tileIndex(map.width, x, y);
    if (!seen.has(idx)) {
      seen.add(idx);
      out.push(idx);
    }
  }
  return out;
}

// Every tile the template covers, as tile indexes in draw order.
//
// Walls are never covered and nothing is covered through one: the burst
// stops at the wall it hits, which is what makes a doorway worth standing
// in. That check is line of sight from the origin, the same ray the attack
// and cover rules already use, so a DM's template and the server's cover
// call can never disagree about what a wall does.
export function templateTiles(map: TemplateMap, spec: TemplateSpec): number[] {
  const size = Math.min(MAX_TEMPLATE_FEET, Math.max(MIN_TEMPLATE_FEET, spec.sizeFeet));
  const reach = feetToTiles(size);
  const { origin, target } = spec;
  if (!inBounds(map.width, map.height, origin.x, origin.y)) {
    return [];
  }
  if (spec.shape === "line") {
    return lineTiles(map, origin, target, reach);
  }

  const offsets: XY[] = [];
  if (spec.shape === "sphere") {
    for (let dy = -reach; dy <= reach; dy += 1) {
      for (let dx = -reach; dx <= reach; dx += 1) {
        offsets.push({ x: dx, y: dy });
      }
    }
  } else if (spec.shape === "cube") {
    // The origin sits on a face of the cube, so the square grows away from
    // it into the quarter of the map the DM aimed at.
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const sx = dx < 0 ? -1 : 1;
    const sy = dy < 0 ? -1 : 1;
    for (let i = 0; i < reach; i += 1) {
      for (let j = 0; j < reach; j += 1) {
        offsets.push({ x: i * sx, y: j * sy });
      }
    }
  } else {
    const { sx, sy, diagonal } = heading(origin, target);
    offsets.push(...coneOffsets(reach, sx, sy, diagonal));
  }

  const out: number[] = [];
  const seen = new Set<number>();
  for (const offset of offsets) {
    const x = origin.x + offset.x;
    const y = origin.y + offset.y;
    if (!inBounds(map.width, map.height, x, y)) {
      continue;
    }
    const idx = tileIndex(map.width, x, y);
    if (seen.has(idx) || blocksMove(map.terrain[idx] ?? "#")) {
      continue;
    }
    if (!hasLineOfSight(map.terrain, map.width, map.height, origin.x, origin.y, x, y)) {
      continue;
    }
    seen.add(idx);
    out.push(idx);
  }
  return out;
}

// Who is standing in it. Takes the tile set so a caller that already drew
// the template does not compute it twice.
export function tokensInTemplate<T extends { x: number; y: number }>(
  width: number,
  tiles: number[],
  tokens: T[],
): T[] {
  const covered = new Set(tiles);
  return tokens.filter((token) => covered.has(tileIndex(width, token.x, token.y)));
}

// One line a DM can read back before they commit: "Cone, 15 ft, 6 tiles".
export function describeTemplate(spec: TemplateSpec, tileCount: number): string {
  return `${SHAPE_LABELS[spec.shape]}, ${spec.sizeFeet} ft ${SHAPE_MEASURES[spec.shape]}, ${tileCount} ${
    tileCount === 1 ? "tile" : "tiles"
  }`;
}
