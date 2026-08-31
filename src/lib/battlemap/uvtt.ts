// Reading a Universal VTT export (.dd2vtt, .uvtt, .df2vtt) into a map this
// engine can actually run a fight on.
//
// The format is what Dungeondraft and its neighbours export: a picture, a
// grid resolution, and the wall geometry as polylines in grid coordinates.
// The picture becomes the backdrop (src/lib/battlemap/backdrop.ts). The
// geometry has to become the five-character terrain string, and that is the
// whole difficulty, because the two models disagree about where a wall is.
//
// A UVTT wall is a LINE, drawn on the boundary between two tiles. An ODM
// wall is a TILE. Converting the naive way (mark the tile each line passes
// through) destroys any corridor exactly one tile wide: the walls on both
// sides round into the corridor itself and it disappears.
//
// So this reads the geometry the way the format means it. Each segment
// blocks the tile EDGES it lies along, and then the solid rock is found by
// flooding inward from outside the map: every tile the flood can reach
// without crossing a blocked edge is outside the building, and becomes wall.
// Everything it cannot reach is enclosed space, and becomes floor. Corridors
// survive at their true width, and rooms keep the size they were drawn.
//
// A map with no enclosing wall is refused rather than guessed at, because
// the flood would reach every tile and hand back a solid block of rock.
//
// Pure by design: no DB, no I/O, no image decoding. The caller hands the
// picture to the existing upload route and gives this the geometry, so
// scripts/test-map-uvtt.mjs can drive the whole conversion on fixtures with
// no filesystem. The impure rim is src/lib/db/prepared-maps.ts.

import { TERRAIN, tileIndex, type AmbientLight, type MapLight } from "@/lib/battlemap/types";
import type { MapTheme } from "@/lib/battlemap/generate";

// Bigger than any generated map (MAP_SIZE caps at 24x18), because an
// imported map is somebody else's drawing and is routinely larger, and
// bounded so a malformed header cannot ask for a hundred million tiles.
export const UVTT_SIZE = { min: 4, max: 64 } as const;

// Enough for a lantern-lit dungeon, few enough that the lighting pass stays
// the cheap thing it is (src/lib/battlemap/los.ts).
export const UVTT_MAX_LIGHTS = 24;

// Above this share of the board reached from outside, the drawing had no
// enclosing wall and the result would be a slab of rock.
const OPEN_MAP_RATIO = 0.9;

export type UvttPoint = { x: number; y: number };

// Only the fields this conversion reads. Everything else in the format
// (colour, shadows, intensity, the software's own version stamps) describes
// a renderer this app does not have.
export type UvttFile = {
  resolution?: {
    map_origin?: UvttPoint;
    map_size?: UvttPoint;
    pixels_per_grid?: number;
  };
  line_of_sight?: UvttPoint[][];
  objects_line_of_sight?: UvttPoint[][];
  portals?: Array<{ position?: UvttPoint; closed?: boolean }>;
  lights?: Array<{ position?: UvttPoint; range?: number }>;
  environment?: { baked_lighting?: boolean; ambient_light?: string };
  // The map art, base64. Deliberately typed but never read here: the caller
  // sends it to /api/upload, which is the one place in this app that writes
  // an image to disk and the one place that validates what an image is.
  image?: string;
};

export type UvttMap = {
  width: number;
  height: number;
  terrain: string;
  ambient: AmbientLight;
  theme: MapTheme;
  lights: MapLight[];
  // What the DM should know before they trust it. Never silent.
  notes: string[];
};

export type UvttOutcome = { map: UvttMap } | { error: string };

function isPoint(value: unknown): value is UvttPoint {
  const point = value as UvttPoint | undefined;
  return Boolean(point) && Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

// Blocked tile edges. "v:x:y" is the vertical edge on grid line x beside row
// y, so it separates tiles (x-1,y) and (x,y); "h:x:y" is the horizontal edge
// on grid line y above column x, separating (x,y-1) and (x,y).
type Edges = Set<string>;

const vertical = (x: number, y: number) => `v:${x}:${y}`;
const horizontal = (x: number, y: number) => `h:${x}:${y}`;

function blockSegment(edges: Edges, a: UvttPoint, b: UvttPoint, width: number, height: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const flat = 1e-6;

  const addVertical = (x: number, y: number) => {
    if (x >= 0 && x <= width && y >= 0 && y < height) {
      edges.add(vertical(x, y));
    }
  };
  const addHorizontal = (x: number, y: number) => {
    if (x >= 0 && x < width && y >= 0 && y <= height) {
      edges.add(horizontal(x, y));
    }
  };

  // The common case by far: walls drawn along the grid, which the format
  // stores exactly, so these need no sampling and lose nothing.
  if (Math.abs(dx) < flat) {
    const x = Math.round(a.x);
    for (let y = Math.floor(Math.min(a.y, b.y)); y < Math.ceil(Math.max(a.y, b.y)); y += 1) {
      addVertical(x, y);
    }
    return;
  }
  if (Math.abs(dy) < flat) {
    const y = Math.round(a.y);
    for (let x = Math.floor(Math.min(a.x, b.x)); x < Math.ceil(Math.max(a.x, b.x)); x += 1) {
      addHorizontal(x, y);
    }
    return;
  }

  // A diagonal wall has no exact tile-edge equivalent, so it is walked and
  // every grid line it crosses is blocked. The result is a staircase, which
  // is the only thing a square grid can say about a diagonal.
  const steps = Math.max(2, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 16));
  let previous = { x: Math.floor(a.x), y: Math.floor(a.y) };
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const cell = { x: Math.floor(a.x + dx * t), y: Math.floor(a.y + dy * t) };
    if (cell.x !== previous.x) {
      addVertical(Math.max(cell.x, previous.x), previous.y);
    }
    if (cell.y !== previous.y) {
      addHorizontal(cell.x, Math.max(cell.y, previous.y));
    }
    previous = cell;
  }
}

// Every tile reachable from outside the map without crossing a wall. These
// are the ones that are not inside anything, which is the definition of
// solid rock in a terrain string.
function floodExterior(edges: Edges, width: number, height: number): Set<number> {
  const outside = new Set<number>();
  const queue: Array<{ x: number; y: number }> = [];
  const enter = (x: number, y: number) => {
    const index = tileIndex(width, x, y);
    if (!outside.has(index)) {
      outside.add(index);
      queue.push({ x, y });
    }
  };

  // Step in from each edge of the board wherever the boundary is not walled.
  for (let y = 0; y < height; y += 1) {
    if (!edges.has(vertical(0, y))) {
      enter(0, y);
    }
    if (!edges.has(vertical(width, y))) {
      enter(width - 1, y);
    }
  }
  for (let x = 0; x < width; x += 1) {
    if (!edges.has(horizontal(x, 0))) {
      enter(x, 0);
    }
    if (!edges.has(horizontal(x, height))) {
      enter(x, height - 1);
    }
  }

  while (queue.length) {
    const { x, y } = queue.shift() as { x: number; y: number };
    if (x > 0 && !edges.has(vertical(x, y))) {
      enter(x - 1, y);
    }
    if (x < width - 1 && !edges.has(vertical(x + 1, y))) {
      enter(x + 1, y);
    }
    if (y > 0 && !edges.has(horizontal(x, y))) {
      enter(x, y - 1);
    }
    if (y < height - 1 && !edges.has(horizontal(x, y + 1))) {
      enter(x, y + 1);
    }
  }
  return outside;
}

// A door only means something if it joins two open tiles. One punched into
// the middle of a slab of rock is decoration, and the import says how many
// it had to leave out rather than drawing them anyway.
function placeDoors(
  tiles: string[],
  width: number,
  height: number,
  portals: UvttFile["portals"],
): number {
  let placed = 0;
  for (const portal of portals ?? []) {
    if (!isPoint(portal.position)) {
      continue;
    }
    const x = Math.min(width - 1, Math.max(0, Math.floor(portal.position.x)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(portal.position.y)));
    const index = tileIndex(width, x, y);
    if (tiles[index] !== TERRAIN.wall) {
      continue;
    }
    const open = (ox: number, oy: number) =>
      ox >= 0 &&
      oy >= 0 &&
      ox < width &&
      oy < height &&
      tiles[tileIndex(width, ox, oy)] !== TERRAIN.wall;
    const throughX = open(x - 1, y) && open(x + 1, y);
    const throughY = open(x, y - 1) && open(x, y + 1);
    if (throughX || throughY) {
      tiles[index] = TERRAIN.door;
      placed += 1;
    }
  }
  return placed;
}

function readLights(file: UvttFile, width: number, height: number, origin: UvttPoint): MapLight[] {
  const lights: MapLight[] = [];
  for (const light of file.lights ?? []) {
    if (lights.length >= UVTT_MAX_LIGHTS) {
      break;
    }
    if (!isPoint(light.position)) {
      continue;
    }
    const x = Math.floor(light.position.x - origin.x);
    const y = Math.floor(light.position.y - origin.y);
    if (x < 0 || y < 0 || x >= width || y >= height) {
      continue;
    }
    const bright = Math.min(20, Math.max(1, Math.round(light.range ?? 3)));
    // Dim reaches twice as far as bright, the same relation carried light
    // has everywhere else in this engine (src/lib/battlemap/types.ts).
    lights.push({ x, y, brightRadius: bright, dimRadius: bright * 2 });
  }
  return lights;
}

export function parseUvtt(file: unknown): UvttOutcome {
  const source = (file ?? {}) as UvttFile;
  const size = source.resolution?.map_size;
  if (!isPoint(size)) {
    return { error: "That file has no map size, so it is not a Universal VTT export." };
  }

  const width = Math.round(size.x);
  const height = Math.round(size.y);
  if (
    width < UVTT_SIZE.min ||
    height < UVTT_SIZE.min ||
    width > UVTT_SIZE.max ||
    height > UVTT_SIZE.max
  ) {
    return {
      error: `That map is ${width} by ${height} tiles. This engine runs maps between ${UVTT_SIZE.min} and ${UVTT_SIZE.max} tiles a side.`,
    };
  }

  const origin = isPoint(source.resolution?.map_origin)
    ? (source.resolution?.map_origin as UvttPoint)
    : { x: 0, y: 0 };

  const edges: Edges = new Set();
  const walls = [...(source.line_of_sight ?? []), ...(source.objects_line_of_sight ?? [])];
  let segments = 0;
  for (const line of walls) {
    if (!Array.isArray(line)) {
      continue;
    }
    const points = line.filter(isPoint).map((point) => ({ x: point.x - origin.x, y: point.y - origin.y }));
    for (let i = 0; i + 1 < points.length; i += 1) {
      blockSegment(edges, points[i], points[i + 1], width, height);
      segments += 1;
    }
  }
  if (!segments) {
    return { error: "That map has no wall geometry, so there would be nothing to stop anyone." };
  }

  const outside = floodExterior(edges, width, height);
  const tileCount = width * height;
  if (outside.size > tileCount * OPEN_MAP_RATIO) {
    return {
      error:
        "The walls in that file do not enclose anything, so every tile reads as open air. Import the picture as a backdrop and paint the walls onto it.",
    };
  }

  const tiles = new Array<string>(tileCount);
  for (let index = 0; index < tileCount; index += 1) {
    tiles[index] = outside.has(index) ? TERRAIN.wall : TERRAIN.floor;
  }

  // The border is the edge of the world, not scenery: the fog projection and
  // the movement code both assume a token cannot walk off it, which is the
  // same promise the generator makes (src/lib/battlemap/generate.ts).
  for (let x = 0; x < width; x += 1) {
    tiles[tileIndex(width, x, 0)] = TERRAIN.wall;
    tiles[tileIndex(width, x, height - 1)] = TERRAIN.wall;
  }
  for (let y = 0; y < height; y += 1) {
    tiles[tileIndex(width, 0, y)] = TERRAIN.wall;
    tiles[tileIndex(width, width - 1, y)] = TERRAIN.wall;
  }

  const doorsWanted = (source.portals ?? []).length;
  const doorsPlaced = placeDoors(tiles, width, height, source.portals);
  const lights = readLights(source, width, height, origin);
  const openTiles = tiles.filter((tile) => tile !== TERRAIN.wall).length;
  if (!openTiles) {
    return { error: "Nothing in that map is standable once its walls are laid down." };
  }

  const notes: string[] = [
    "The walls the rules use are the ones read out of the file, not the ones in the picture. Check them and paint any the import missed.",
  ];
  if (doorsWanted > doorsPlaced) {
    notes.push(
      `${doorsWanted - doorsPlaced} of ${doorsWanted} doors did not land between two open tiles and were left out. Paint them in where they belong.`,
    );
  }
  if (lights.length) {
    notes.push(`${lights.length} light${lights.length === 1 ? "" : "s"} came across, and the map starts dark.`);
  }

  return {
    map: {
      width,
      height,
      terrain: tiles.join(""),
      // A map that brought its own lights is a map meant to be lit by them.
      ambient: lights.length ? "dark" : "bright",
      // Imports are nearly always drawn interiors, and the theme only picks
      // the client's palette, which the DM can change afterwards.
      theme: "interior" as MapTheme,
      lights,
      notes,
    },
  };
}

// A name for the map when the file does not carry one. UVTT has no title
// field, so the filename is the only thing a DM gave it.
export function nameFromFilename(filename: string): string {
  const base = filename.replace(/\.(dd2vtt|df2vtt|uvtt)$/i, "").replace(/[_-]+/g, " ").trim();
  return base.slice(0, 80) || "Imported map";
}

// The picture, as a data URL the existing upload route accepts. Returns null
// when the file carried no art, which is legal: the geometry alone still
// makes a playable map.
export function backdropDataUrl(file: unknown): { dataUrl: string; type: string } | null {
  const image = (file as UvttFile | null)?.image;
  if (typeof image !== "string" || image.length < 32) {
    return null;
  }
  // UVTT stores raw base64 with no prefix, and the format's own examples are
  // always PNG. If a file ever carries the prefix, honour what it says.
  if (image.startsWith("data:image/")) {
    const type = image.slice(5, image.indexOf(";"));
    return { dataUrl: image, type };
  }
  return { dataUrl: `data:image/png;base64,${image}`, type: "image/png" };
}
