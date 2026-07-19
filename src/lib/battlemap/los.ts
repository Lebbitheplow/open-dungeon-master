import {
  blocksSight,
  chebyshev,
  inBounds,
  tileAt,
  tileIndex,
  type AmbientLight,
  type BattleToken,
  type MapLight,
} from "@/lib/battlemap/types";

// Field of view via recursive shadowcasting over 8 octants (the classic
// Bjorn Bergstrom algorithm). Walls are opaque; a blocking tile is itself
// visible so players can see the wall that stops their sight.

const OCTANTS: Array<[number, number, number, number]> = [
  [1, 0, 0, 1],
  [0, 1, 1, 0],
  [0, -1, 1, 0],
  [-1, 0, 0, 1],
  [-1, 0, 0, -1],
  [0, -1, -1, 0],
  [0, 1, -1, 0],
  [1, 0, 0, -1],
];

export function computeFov(
  terrain: string,
  width: number,
  height: number,
  originX: number,
  originY: number,
  radius: number,
): Set<number> {
  const visible = new Set<number>();
  if (!inBounds(width, height, originX, originY)) {
    return visible;
  }
  visible.add(tileIndex(width, originX, originY));

  function castOctant(
    row: number,
    startSlope: number,
    endSlope: number,
    xx: number,
    xy: number,
    yx: number,
    yy: number,
  ) {
    if (startSlope < endSlope) {
      return;
    }
    let nextStart = startSlope;
    for (let i = row; i <= radius; i += 1) {
      let blocked = false;
      for (let dx = -i; dx <= 0; dx += 1) {
        const dy = -i;
        const leftSlope = (dx - 0.5) / (dy + 0.5);
        const rightSlope = (dx + 0.5) / (dy - 0.5);
        if (rightSlope > nextStart) {
          continue;
        }
        if (leftSlope < endSlope) {
          break;
        }
        const currentX = originX + dx * xx + dy * xy;
        const currentY = originY + dx * yx + dy * yy;
        if (!inBounds(width, height, currentX, currentY)) {
          continue;
        }
        if (chebyshev(originX, originY, currentX, currentY) <= radius) {
          visible.add(tileIndex(width, currentX, currentY));
        }
        const opaque = blocksSight(tileAt(terrain, width, currentX, currentY));
        if (blocked) {
          if (opaque) {
            nextStart = rightSlope;
          } else {
            blocked = false;
          }
        } else if (opaque && i < radius) {
          blocked = true;
          castOctant(i + 1, nextStart, leftSlope, xx, xy, yx, yy);
          nextStart = rightSlope;
        }
      }
      if (blocked) {
        break;
      }
    }
  }

  for (const [xx, xy, yx, yy] of OCTANTS) {
    castOctant(1, 1, 0, xx, xy, yx, yy);
  }
  return visible;
}

// Pairwise line of sight along a Bresenham ray between tile centers.
// Endpoints never block themselves: the attacker's own tile is ignored and
// a target standing in a doorway is still visible.
export function hasLineOfSight(
  terrain: string,
  width: number,
  height: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean {
  let x = fromX;
  let y = fromY;
  const dx = Math.abs(toX - fromX);
  const dy = Math.abs(toY - fromY);
  const sx = fromX < toX ? 1 : -1;
  const sy = fromY < toY ? 1 : -1;
  let err = dx - dy;
  while (x !== toX || y !== toY) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    if (x === toX && y === toY) {
      break;
    }
    if (blocksSight(tileAt(terrain, width, x, y))) {
      return false;
    }
  }
  return true;
}

export type Viewer = {
  x: number;
  y: number;
  // Darkvision range in tiles (feet / 5); 0 = none.
  darkvisionTiles: number;
};

export type MapForVision = {
  terrain: string;
  width: number;
  height: number;
  ambient: AmbientLight;
};

// How far a viewer can perceive unlit tiles under dim ambient light: dim
// light is workable at short range even without darkvision.
const DIM_SELF_RADIUS = 6;

// Every tile lit by static lights and carried token lights. A light only
// lights tiles it can itself "see" (no glow through walls); light FOVs are
// computed per call and shared across viewers by the caller when batching.
export function litTiles(map: MapForVision, tokens: BattleToken[], lights: MapLight[]): Set<number> {
  const lit = new Set<number>();
  const sources: MapLight[] = [
    ...lights,
    ...tokens
      .filter((token) => token.lightRadius > 0)
      .map((token) => ({
        x: token.x,
        y: token.y,
        brightRadius: token.lightRadius,
        dimRadius: token.lightRadius * 2,
      })),
  ];
  for (const source of sources) {
    const glow = computeFov(map.terrain, map.width, map.height, source.x, source.y, source.dimRadius);
    for (const idx of glow) {
      lit.add(idx);
    }
  }
  return lit;
}

// Tiles this viewer can currently see: line of sight intersected with what
// the ambient light level allows them to perceive.
export function visibleTiles(
  map: MapForVision,
  viewer: Viewer,
  tokens: BattleToken[],
  lights: MapLight[],
  precomputedLit?: Set<number>,
): Set<number> {
  const maxRadius = Math.max(map.width, map.height);
  const los = computeFov(map.terrain, map.width, map.height, viewer.x, viewer.y, maxRadius);
  if (map.ambient === "bright") {
    return los;
  }
  const lit = precomputedLit ?? litTiles(map, tokens, lights);
  const visible = new Set<number>();
  const selfRadius = map.ambient === "dim" ? DIM_SELF_RADIUS : 0;
  for (const idx of los) {
    const x = idx % map.width;
    const y = Math.floor(idx / map.width);
    const distance = chebyshev(viewer.x, viewer.y, x, y);
    if (
      lit.has(idx) ||
      distance <= viewer.darkvisionTiles ||
      distance <= selfRadius
    ) {
      visible.add(idx);
    }
  }
  return visible;
}

// "Darkvision 60 ft" style feature/trait text to a tile radius. A bare
// "Darkvision" with no range defaults to the common 60 ft.
export function darkvisionTilesFromText(texts: string[]): number {
  let bare = false;
  for (const text of texts) {
    if (!/darkvision/i.test(text)) {
      continue;
    }
    const match = /darkvision\s*\(?\s*(\d+)/i.exec(text);
    if (match) {
      return Math.floor(Number(match[1]) / 5);
    }
    bare = true;
  }
  return bare ? 12 : 0;
}
