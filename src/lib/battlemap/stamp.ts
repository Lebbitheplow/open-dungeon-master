// Stamping rooms instead of painting them tile by tile.
//
// The brush in paint.ts is one tile at a time, which is the right tool for
// a doorway and the wrong one for a forty-foot hall. A stamp is a shape a
// DM drops on the grid in one click: a room, a corridor, a cavern.
//
// This module compiles a stamp into ordinary brush strokes and does nothing
// else. Every stamp therefore goes through paintTerrain, so a stamp cannot
// wall a combatant in, cannot open the border, and cannot produce a picture
// the pathfinder refuses, without any of those rules being restated here.
// That is the whole design: the stamp is a shape, not a second painter.
//
// There is no stairs stamp. The terrain alphabet has five characters and
// none of them is a level change; inventing one would mean a tile the
// pathfinder, the fog and the DM prompt would all have to learn. A door is
// the crossing between two places this engine can actually run.
//
// Pure by design: no DB and no I/O, so scripts/test-map-stamp.mjs drives it
// directly. Its only imports are the shared tile primitives and the brush
// vocabulary it emits.

import { TERRAIN, TILE_FEET } from "@/lib/battlemap/types";
import type { Brush, Stroke } from "@/lib/battlemap/paint";

export const STAMPS = ["room", "hall", "cavern", "pillars", "pool", "rubble"] as const;
export type StampKind = (typeof STAMPS)[number];

// Written for a person looking at a dungeon, not for the tile alphabet.
export const STAMP_LABELS: Record<StampKind, string> = {
  room: "Room",
  hall: "Corridor",
  cavern: "Cavern",
  pillars: "Pillared hall",
  pool: "Pool",
  rubble: "Rubble",
};

// What each one does to the ground, so the palette can say it out loud
// rather than leaving the DM to discover it by stamping.
export const STAMP_EFFECTS: Record<StampKind, string> = {
  room: "Clear floor with a wall drawn around it.",
  hall: "Clear floor and no walls, so it opens into whatever it meets.",
  cavern: "A rounded chamber with a wall around it.",
  pillars: "Clear floor on a grid of pillars that block sight and give cover.",
  pool: "Standing water. Costs double to cross and does not block sight.",
  rubble: "Rough ground. Costs double to cross.",
};

// Whether the stamp draws its own wall. A room that seals itself is a room
// the DM has to cut a door into, which is correct; a corridor that sealed
// itself could never join anything.
export const STAMP_WALLS: Record<StampKind, boolean> = {
  room: true,
  hall: false,
  cavern: true,
  pillars: true,
  pool: false,
  rubble: false,
};

// 12 is wider than the widest generated map is tall (MAP_SIZE caps height at
// 18), so one stamp can fill a board and no stamp can overflow the stroke
// budget paintTerrain enforces.
export const STAMP_SIZE = { min: 1, max: 12 } as const;

export type Stamp = {
  kind: StampKind;
  // The tile the DM clicked. The shape is centred on it.
  x: number;
  y: number;
  width: number;
  height: number;
};

export type StampBox = { x0: number; y0: number; x1: number; y1: number };

function clampSize(value: number): number {
  if (!Number.isFinite(value)) {
    return STAMP_SIZE.min;
  }
  return Math.min(STAMP_SIZE.max, Math.max(STAMP_SIZE.min, Math.round(value)));
}

// The tiles the shape itself covers, before any wall is drawn around it.
// Exported so a panel can outline the footprint under the cursor and the DM
// can see what a click is about to do.
export function stampFootprint(stamp: Stamp): StampBox {
  const width = clampSize(stamp.width);
  const height = clampSize(stamp.height);
  const x = Math.round(stamp.x);
  const y = Math.round(stamp.y);
  const x0 = x - Math.floor((width - 1) / 2);
  const y0 = y - Math.floor((height - 1) / 2);
  return { x0, y0, x1: x0 + width - 1, y1: y0 + height - 1 };
}

function rectTiles(box: StampBox): Array<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = [];
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = box.x0; x <= box.x1; x += 1) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}

// Tiles inside the box's inscribed ellipse. Rounded chambers read as caves
// where a rectangle reads as masonry, and the difference is the only reason
// cavern is a separate stamp from room.
function ellipseTiles(box: StampBox): Array<{ x: number; y: number }> {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const rx = Math.max(0.5, (box.x1 - box.x0 + 1) / 2);
  const ry = Math.max(0.5, (box.y1 - box.y0 + 1) / 2);
  return rectTiles(box).filter((tile) => {
    const dx = (tile.x - cx) / rx;
    const dy = (tile.y - cy) / ry;
    return dx * dx + dy * dy <= 1;
  });
}

// Every tile touching the shape from outside it, eight-way, so a diagonal
// corner of a cavern does not leave a gap a walker could squeeze through.
function surround(tiles: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const inside = new Set(tiles.map((tile) => `${tile.x},${tile.y}`));
  const ring = new Map<string, { x: number; y: number }>();
  for (const tile of tiles) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const key = `${tile.x + dx},${tile.y + dy}`;
        if (!inside.has(key) && !ring.has(key)) {
          ring.set(key, { x: tile.x + dx, y: tile.y + dy });
        }
      }
    }
  }
  return [...ring.values()];
}

// The classic pillared hall: a block on every other tile, inset one from the
// edge so the pillars stand in the room rather than in its walls.
function pillarTiles(box: StampBox): Array<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = [];
  if (box.x1 - box.x0 < 2 || box.y1 - box.y0 < 2) {
    return tiles;
  }
  for (let y = box.y0 + 1; y <= box.y1 - 1; y += 2) {
    for (let x = box.x0 + 1; x <= box.x1 - 1; x += 2) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}

function strokesFor(tiles: Array<{ x: number; y: number }>, brush: Brush): Stroke[] {
  // Radius 0 throughout: the shape is already exact, and a radius here would
  // round the corners of a room the DM asked for square.
  return tiles.map((tile) => ({ x: tile.x, y: tile.y, brush }));
}

// A stamp compiled into brush strokes, in the order they must be applied:
// the wall first, then the floor, so a stamp overlapping an older room cuts
// into it rather than being swallowed by it.
export function stampStrokes(stamp: Stamp): Stroke[] {
  const box = stampFootprint(stamp);
  const shape =
    stamp.kind === "cavern" || stamp.kind === "pool" || stamp.kind === "rubble"
      ? ellipseTiles(box)
      : rectTiles(box);

  const fill: Brush =
    stamp.kind === "pool" ? "water" : stamp.kind === "rubble" ? "difficult" : "floor";

  const strokes: Stroke[] = [];
  if (STAMP_WALLS[stamp.kind]) {
    strokes.push(...strokesFor(surround(shape), "wall"));
  }
  strokes.push(...strokesFor(shape, fill));
  if (stamp.kind === "pillars") {
    strokes.push(...strokesFor(pillarTiles(box), "wall"));
  }
  return strokes;
}

// A one-line description of what the stamp is about to lay down, for the
// confirmation the panel shows before the click lands.
export function describeStamp(stamp: Stamp): string {
  const box = stampFootprint(stamp);
  const width = box.x1 - box.x0 + 1;
  const height = box.y1 - box.y0 + 1;
  // Tiles are five feet, the same conversion movement.ts uses, so the DM
  // reads the size in the units they will describe it in at the table.
  return `${STAMP_LABELS[stamp.kind]}, ${width * TILE_FEET} by ${height * TILE_FEET} feet.`;
}

// Guard for callers that take a stamp off the wire: sizes clamped rather
// than refused, an unknown kind refused outright.
export function normalizeStamp(input: {
  kind: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}): Stamp | null {
  if (!(STAMPS as readonly string[]).includes(input.kind)) {
    return null;
  }
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) {
    return null;
  }
  return {
    kind: input.kind as StampKind,
    x: Math.round(input.x),
    y: Math.round(input.y),
    width: clampSize(input.width ?? 3),
    height: clampSize(input.height ?? 3),
  };
}

// The characters a stamp can put on the map, for a test that asserts the
// palette never grows a tile the engine cannot read.
export const STAMP_CHARS: readonly string[] = [TERRAIN.floor, TERRAIN.wall, TERRAIN.water, TERRAIN.difficult];
