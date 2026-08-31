import { TERRAIN, blocksMove, inBounds, tileIndex, type XY } from "@/lib/battlemap/types";

// Painting terrain by hand. Terrain is one char per tile, so a brush stroke
// is a string edit; what this module adds is the part that is not a string
// edit, which is refusing a picture the rules engine cannot run on.
//
// The generator already guarantees a connected field and a walled border
// (src/lib/battlemap/generate.ts). A painted map has to keep both promises,
// because pathfinding, line of sight and the fog projection all assume them.
// Pure by design: no DB and no "@/" imports beyond the shared tile
// primitives, so scripts/test-map-paint.mjs can drive it directly.

export const BRUSHES = ["floor", "wall", "water", "difficult", "door"] as const;
export type Brush = (typeof BRUSHES)[number];

// Written for a person looking at a board, not for the tile alphabet.
export const BRUSH_LABELS: Record<Brush, string> = {
  floor: "Clear ground",
  wall: "Wall",
  water: "Water",
  difficult: "Rough ground",
  door: "Door",
};

// What each brush costs a walker, so the palette can say it out loud.
export const BRUSH_EFFECTS: Record<Brush, string> = {
  floor: "Normal movement, and nothing blocks sight.",
  wall: "Blocks movement and sight, and grants cover behind it.",
  water: "Costs double to cross.",
  difficult: "Costs double to cross.",
  door: "Walk through it; it does not block sight.",
};

const BRUSH_CHARS: Record<Brush, string> = {
  floor: TERRAIN.floor,
  wall: TERRAIN.wall,
  water: TERRAIN.water,
  difficult: TERRAIN.difficult,
  door: TERRAIN.door,
};

export type Stroke = {
  x: number;
  y: number;
  brush: Brush;
  // Square brush, in tiles either side of the centre. 0 paints one tile.
  radius?: number;
};

// A dragged brush sends one stroke per tile it crosses, so the cap is
// generous; it exists to bound the request, not the drawing.
export const MAX_STROKES = 600;
export const MAX_BRUSH_RADIUS = 3;

export type PaintInput = {
  terrain: string;
  width: number;
  height: number;
  strokes: Stroke[];
  // Tiles that currently hold a token. They may not be walled over, and
  // they must still be able to reach each other when the brush lifts.
  occupied?: XY[];
};

export type PaintOutcome = { terrain: string } | { error: string };

// Every non-wall tile reachable from a start, four-way like findPath.
function reachableFrom(tiles: string[], width: number, height: number, start: XY): Set<number> {
  const seen = new Set<number>([tileIndex(width, start.x, start.y)]);
  const queue: XY[] = [start];
  while (queue.length) {
    const { x, y } = queue.shift() as XY;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(width, height, nx, ny)) {
        continue;
      }
      const index = tileIndex(width, nx, ny);
      if (seen.has(index) || blocksMove(tiles[index])) {
        continue;
      }
      seen.add(index);
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

// Applies the strokes and then checks the result is still a playable field.
// Returns the new terrain, or the one sentence to show the DM instead.
export function paintTerrain(input: PaintInput): PaintOutcome {
  const { terrain, width, height } = input;
  if (terrain.length !== width * height) {
    return { error: "That map's terrain does not match its size." };
  }
  if (!input.strokes.length) {
    return { error: "Nothing was painted." };
  }
  if (input.strokes.length > MAX_STROKES) {
    return { error: `That is more than ${MAX_STROKES} strokes at once; paint in passes.` };
  }

  const occupied = input.occupied ?? [];
  const occupiedIndices = new Set(
    occupied
      .filter((spot) => inBounds(width, height, spot.x, spot.y))
      .map((spot) => tileIndex(width, spot.x, spot.y)),
  );

  const tiles = terrain.split("");
  for (const stroke of input.strokes) {
    const char = BRUSH_CHARS[stroke.brush];
    if (!char) {
      return { error: `"${stroke.brush}" is not a brush.` };
    }
    const radius = Math.min(MAX_BRUSH_RADIUS, Math.max(0, Math.round(stroke.radius ?? 0)));
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = Math.round(stroke.x) + dx;
        const y = Math.round(stroke.y) + dy;
        if (!inBounds(width, height, x, y)) {
          continue;
        }
        // The border is the map's edge, not scenery: opening it would let a
        // token walk off the grid the fog and movement code assume.
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
          continue;
        }
        const index = tileIndex(width, x, y);
        if (blocksMove(char) && occupiedIndices.has(index)) {
          return { error: "Someone is standing there; a wall cannot be painted over them." };
        }
        tiles[index] = char;
      }
    }
  }

  // Connectivity, checked only between the tiles that actually hold someone.
  // A sealed closet elsewhere is a room the DM meant to draw; a combatant
  // walled away from the fight is a map nobody can play on.
  const standing = [...occupiedIndices].map((index) => ({
    x: index % width,
    y: Math.floor(index / width),
  }));
  if (standing.length) {
    const reached = reachableFrom(tiles, width, height, standing[0]);
    for (const spot of standing.slice(1)) {
      if (!reached.has(tileIndex(width, spot.x, spot.y))) {
        return { error: "That would wall a combatant off from the rest of the field." };
      }
    }
    for (const spot of standing) {
      const open = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([dx, dy]) => {
        const nx = spot.x + dx;
        const ny = spot.y + dy;
        return inBounds(width, height, nx, ny) && !blocksMove(tiles[tileIndex(width, nx, ny)]);
      });
      if (!open) {
        return { error: "That would seal a combatant in on every side." };
      }
    }
  }

  return { terrain: tiles.join("") };
}

// Where a token would have to stand after the ground under it changed:
// itself when the tile is still walkable, otherwise the nearest open tile.
// Used when a fresh map replaces an old one under combatants already on it.
export function nearestOpenTile(
  terrain: string,
  width: number,
  height: number,
  from: XY,
  taken: Set<number>,
): XY {
  const walkable = (x: number, y: number) =>
    inBounds(width, height, x, y) &&
    !blocksMove(terrain[tileIndex(width, x, y)]) &&
    !taken.has(tileIndex(width, x, y));
  if (walkable(from.x, from.y)) {
    return { x: from.x, y: from.y };
  }
  for (let radius = 1; radius < Math.max(width, height); radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
          continue;
        }
        if (walkable(from.x + dx, from.y + dy)) {
          return { x: from.x + dx, y: from.y + dy };
        }
      }
    }
  }
  return { x: from.x, y: from.y };
}
