import { TERRAIN, inBounds, tileIndex, type XY } from "@/lib/battlemap/types";
import { BRUSHES, type Brush, type Stroke } from "@/lib/battlemap/paint";
import { stampStrokes, type Stamp } from "@/lib/battlemap/stamp";

// The shape tools: a line, a rectangle, a filled box and a flood fill.
//
// The brush in paint.ts is one tile at a time and the stamps in stamp.ts are
// fixed shapes. Between them sits the tool a person reaches for most: two
// corners and a wall between them. Like a stamp, every tool here compiles
// into ordinary brush strokes and nothing else, so paintTerrain still owns
// every rule about what a legal map is and a line cannot open the border,
// wall a combatant in, or paint a picture the pathfinder refuses.
//
// diffStrokes is the same idea pointed backwards: an undo is "make the map
// look like it did before", and expressing that as strokes rather than as a
// wholesale replacement means an undo on a live board is checked against
// where people are standing exactly as a fresh stroke would be.
//
// Pure by design: no DB and no I/O, so scripts/test-map-tools.mjs drives it.

export const SHAPE_TOOLS = ["line", "rect", "box", "fill"] as const;
export type ShapeTool = (typeof SHAPE_TOOLS)[number];

export const SHAPE_LABELS: Record<ShapeTool, string> = {
  line: "Line",
  rect: "Outline",
  box: "Filled box",
  fill: "Fill",
};

export const SHAPE_EFFECTS: Record<ShapeTool, string> = {
  line: "Drag from one tile to another; the brush follows the straight line between them.",
  rect: "Drag a corner to the opposite corner; the brush draws the edge only.",
  box: "Drag a corner to the opposite corner; the brush fills the whole box.",
  fill: "Tap once; every connected tile of the same kind takes the brush.",
};

export type Shape = {
  tool: ShapeTool;
  brush: Brush;
  from: XY;
  to: XY;
};

const CHAR_TO_BRUSH: Record<string, Brush> = Object.fromEntries(
  Object.entries(TERRAIN).map(([brush, char]) => [char, brush as Brush]),
);

// Whether a tile is on the border the painter protects. Shapes skip these
// rather than emit strokes the painter would drop, so the stroke count a
// caller sees is the count of tiles that will actually change.
function onBorder(width: number, height: number, x: number, y: number): boolean {
  return x === 0 || y === 0 || x === width - 1 || y === height - 1;
}

function lineTiles(from: XY, to: XY): XY[] {
  // Bresenham, the integer line every raster editor draws.
  const tiles: XY[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const dy = -Math.abs(to.y - from.y);
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    tiles.push({ x, y });
    if (x === to.x && y === to.y) {
      break;
    }
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return tiles;
}

function rectTiles(from: XY, to: XY, filled: boolean): XY[] {
  const x0 = Math.min(from.x, to.x);
  const x1 = Math.max(from.x, to.x);
  const y0 = Math.min(from.y, to.y);
  const y1 = Math.max(from.y, to.y);
  const tiles: XY[] = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (filled || x === x0 || x === x1 || y === y0 || y === y1) {
        tiles.push({ x, y });
      }
    }
  }
  return tiles;
}

// Every tile reachable from the start through tiles of the same character,
// four-way, stopping at the border. The border is never part of a fill:
// a DM filling a cave floor does not mean the wall around the whole map.
function floodTiles(terrain: string, width: number, height: number, start: XY): XY[] {
  const target = terrain[tileIndex(width, start.x, start.y)];
  const seen = new Set<number>([tileIndex(width, start.x, start.y)]);
  const queue: XY[] = [start];
  const out: XY[] = [];
  while (queue.length) {
    const at = queue.shift() as XY;
    out.push(at);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = at.x + dx;
      const ny = at.y + dy;
      if (!inBounds(width, height, nx, ny) || onBorder(width, height, nx, ny)) {
        continue;
      }
      const index = tileIndex(width, nx, ny);
      if (seen.has(index) || terrain[index] !== target) {
        continue;
      }
      seen.add(index);
      queue.push({ x: nx, y: ny });
    }
  }
  return out;
}

// Clamps a raw shape onto the map, or refuses it. Coordinates off the map
// are pulled to the nearest edge rather than refused, because a drag that
// ended a pixel outside the canvas meant the edge.
export function normalizeShape(raw: unknown, width: number, height: number): Shape | null {
  const source = (raw ?? {}) as Partial<Shape>;
  if (!SHAPE_TOOLS.includes(source.tool as ShapeTool)) {
    return null;
  }
  if (!BRUSHES.includes(source.brush as Brush)) {
    return null;
  }
  const clampXy = (point: Partial<XY> | undefined): XY | null => {
    if (!point || typeof point.x !== "number" || typeof point.y !== "number") {
      return null;
    }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return null;
    }
    return {
      x: Math.min(width - 1, Math.max(0, Math.round(point.x))),
      y: Math.min(height - 1, Math.max(0, Math.round(point.y))),
    };
  };
  const from = clampXy(source.from);
  const to = clampXy(source.to) ?? from;
  if (!from || !to) {
    return null;
  }
  return { tool: source.tool as ShapeTool, brush: source.brush as Brush, from, to };
}

// A shape as brush strokes, ready for paintTerrain. Border tiles are left
// out, and a fill of a tile that already wears the brush is nothing at all.
export function shapeStrokes(
  shape: Shape,
  terrain: string,
  width: number,
  height: number,
): Stroke[] {
  let tiles: XY[];
  switch (shape.tool) {
    case "line":
      tiles = lineTiles(shape.from, shape.to);
      break;
    case "rect":
      tiles = rectTiles(shape.from, shape.to, false);
      break;
    case "box":
      tiles = rectTiles(shape.from, shape.to, true);
      break;
    case "fill": {
      const at = tileIndex(width, shape.from.x, shape.from.y);
      if (terrain[at] === TERRAIN[shape.brush] || onBorder(width, height, shape.from.x, shape.from.y)) {
        return [];
      }
      tiles = floodTiles(terrain, width, height, shape.from);
      break;
    }
  }
  return tiles
    .filter((tile) => inBounds(width, height, tile.x, tile.y) && !onBorder(width, height, tile.x, tile.y))
    .map((tile) => ({ x: tile.x, y: tile.y, brush: shape.brush }));
}

// The strokes that turn `current` into `wanted`, for undo. Refused when the
// two are different sizes or when `wanted` is written in characters the
// painter has no brush for. Border differences are ignored rather than
// refused: the painter protects the border regardless, and a wanted terrain
// that came from this same map has the same border anyway.
export function diffStrokes(
  current: string,
  wanted: string,
  width: number,
  height: number,
): { strokes: Stroke[] } | { error: string } {
  if (wanted.length !== width * height || current.length !== width * height) {
    return { error: "That terrain does not match this map's size." };
  }
  const strokes: Stroke[] = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = tileIndex(width, x, y);
      const char = wanted[index];
      if (char === current[index]) {
        continue;
      }
      const brush = CHAR_TO_BRUSH[char];
      if (!brush) {
        return { error: `"${char}" is not a tile this map can hold.` };
      }
      strokes.push({ x, y, brush });
    }
  }
  return { strokes };
}

// One sentence for the palette, so the tool says what it will do before it
// does it.
export function describeShape(shape: Pick<Shape, "tool" | "brush">): string {
  return `${SHAPE_LABELS[shape.tool]} of ${shape.brush}: ${SHAPE_EFFECTS[shape.tool]}`;
}

// Four ways to paint, one painter. Hand strokes arrive as they are and are
// bounded by the wire cap; a stamp, a shape or a whole terrain to return to
// (undo) are compiled here and bounded by the map's own area instead, which
// is the `limit` handed back beside the strokes.
export type PaintRequest = {
  strokes?: Stroke[];
  stamp?: Stamp;
  shape?: Shape;
  replaceTerrain?: string;
};

export function compilePaint(
  request: PaintRequest,
  terrain: string,
  width: number,
  height: number,
): { strokes: Stroke[]; limit: number } | { error: string } {
  const area = width * height;
  if (request.replaceTerrain !== undefined) {
    const diff = diffStrokes(terrain, request.replaceTerrain, width, height);
    return "error" in diff ? diff : { strokes: diff.strokes, limit: area };
  }
  if (request.shape) {
    return { strokes: shapeStrokes(request.shape, terrain, width, height), limit: area };
  }
  if (request.stamp) {
    return { strokes: stampStrokes(request.stamp), limit: area };
  }
  return { strokes: request.strokes ?? [], limit: Number.POSITIVE_INFINITY };
}

// Whether an empty compile is "nothing to do" (fine) or "nothing was sent"
// (a mistake). An undo to the same picture and a fill of a tile already
// painted are the former.
export function emptyPaintIsFine(request: PaintRequest): boolean {
  return request.replaceTerrain !== undefined || request.shape?.tool === "fill";
}
