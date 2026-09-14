import {
  blocksSight,
  chebyshev,
  inBounds,
  tileAt,
  tileIndex,
  type AmbientLight,
  type BattleToken,
  type MapLight,
  TERRAIN,
} from "@/lib/battlemap/types";
import { ambientAt, magicalDarknessAt, type LightZone } from "@/lib/battlemap/scene";

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
  // The other senses (src/lib/srd/senses.ts), in tiles; absent means none.
  blindsightTiles?: number;
  tremorsenseTiles?: number;
  truesightTiles?: number;
  devilsSightTiles?: number;
};

export type MapForVision = {
  terrain: string;
  width: number;
  height: number;
  ambient: AmbientLight;
  // Patches where the light is not the map's own: a lit shrine in a dark
  // crypt, a dark alcove in a bright hall (src/lib/battlemap/scene.ts).
  zones?: LightZone[];
  // Weather: beyond this many tiles from the viewer the light reads as dim
  // at best (heavy rain, fog). Infinity or absent when the air is clear
  // (src/lib/srd/weather.ts).
  obscureBeyond?: number;
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
  const zones = map.zones ?? [];
  const obscureBeyond = map.obscureBeyond ?? Infinity;
  if (map.ambient === "bright" && !zones.length && !Number.isFinite(obscureBeyond)) {
    return los;
  }
  const lit = precomputedLit ?? litTiles(map, tokens, lights);
  const visible = new Set<number>();
  for (const idx of los) {
    const x = idx % map.width;
    const y = Math.floor(idx / map.width);
    // The light on THIS tile decides whether it can be seen, so a dark
    // alcove stays dark inside a bright hall and a lit shrine shows in a
    // dark crypt.
    const distance = chebyshev(viewer.x, viewer.y, x, y);
    // Blindsight needs no light at all, only a clear line.
    if (distance <= (viewer.blindsightTiles ?? 0)) {
      visible.add(idx);
      continue;
    }
    // Magical darkness: no light and no darkvision reach into it; only
    // truesight and Devil's Sight do (src/lib/battlemap/scene.ts).
    if (zones.length && magicalDarknessAt(zones, x, y)) {
      if (distance <= (viewer.truesightTiles ?? 0) || distance <= (viewer.devilsSightTiles ?? 0)) {
        visible.add(idx);
      }
      continue;
    }
    const local = zones.length ? ambientAt(zones, x, y, map.ambient) : map.ambient;
    // Rain and fog: past the obscurement radius a bright tile reads as dim.
    const ambient = distance > obscureBeyond && local === "bright" ? "dim" : local;
    if (ambient === "bright") {
      visible.add(idx);
      continue;
    }
    const selfRadius = ambient === "dim" ? DIM_SELF_RADIUS : 0;
    if (
      lit.has(idx) ||
      distance <= viewer.darkvisionTiles ||
      distance <= (viewer.devilsSightTiles ?? 0) ||
      distance <= (viewer.truesightTiles ?? 0) ||
      distance <= selfRadius
    ) {
      visible.add(idx);
    }
  }
  return visible;
}

// Whether a viewer perceives a creature: the tile is in view, or a sense
// reaches it. Tremorsense feels anything on the ground within reach, walls
// or not, and misses whatever flies; blindsight is already in `visible`.
export function perceivesToken(
  map: MapForVision,
  viewer: Viewer,
  target: { x: number; y: number; movement?: "walk" | "fly" | "burrow" },
  visible: Set<number>,
): boolean {
  if (visible.has(tileIndex(map.width, target.x, target.y))) {
    return true;
  }
  const distance = chebyshev(viewer.x, viewer.y, target.x, target.y);
  if (distance <= (viewer.tremorsenseTiles ?? 0) && target.movement !== "fly") {
    return true;
  }
  return false;
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

// Cover from terrain, as the AC bonus the SRD grants the target: 0 for none,
// +2 for half cover, +5 for three-quarters. A target with total cover cannot
// be attacked at all, which hasLineOfSight already refuses.
//
// The approximation: a blocking tile orthogonally adjacent to the target and
// lying on the ATTACKER'S side of it is something the target is tucked
// behind. One such tile is half cover; two (a corner) is three-quarters.
// Cheap, deterministic, and it matches what players expect from fighting
// someone around a corner or out of an arrow slit.
export function coverBetween(
  terrain: string,
  width: number,
  height: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): 0 | 2 | 5 {
  if (chebyshev(fromX, fromY, toX, toY) <= 1) {
    // Toe to toe: nothing is between them.
    return 0;
  }
  const towardX = Math.sign(fromX - toX);
  const towardY = Math.sign(fromY - toY);
  let shields = 0;
  let lowwalls = 0;
  for (const [dx, dy] of [
    [towardX, 0],
    [0, towardY],
  ]) {
    if (dx === 0 && dy === 0) {
      continue;
    }
    const x = toX + dx;
    const y = toY + dy;
    if (!inBounds(width, height, x, y)) {
      continue;
    }
    const between = tileAt(terrain, width, x, y);
    if (blocksSight(between)) {
      shields += 1;
    } else if (between === TERRAIN.lowwall) {
      // A fence or ledge directly in front: half cover, never more.
      lowwalls += 1;
    }
  }
  if (shields === 0) {
    return lowwalls > 0 ? 2 : 0;
  }
  return shields === 1 ? 2 : 5;
}
