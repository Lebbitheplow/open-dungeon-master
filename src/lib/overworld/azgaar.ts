import type { OverworldTile, XY } from "@/lib/overworld/logic";
import {
  FEATURE_LIMITS,
  normalizePaths,
  normalizeSize,
  type OverworldPath,
  type OverworldSize,
  type PathKind,
} from "@/lib/overworld/features";

// Reading a map made in Azgaar's Fantasy Map Generator into the region grid
// (docs/workshop-parity-audit.md phase 15).
//
// Azgaar exports its map as GeoJSON files: one of cells (polygons with a
// height and a biome), one of burgs (points with names), one of rivers and
// one of routes (lines). Any of them can be handed here together; each
// feature is told apart by its geometry and what its properties carry,
// which is why one file or four make no difference.
//
// The cells are rasterized to tiles by nearest centroid. That loses the
// polygon edges, which at 96 by 72 tiles were never going to survive
// anyway, and it keeps the module free of any geometry library.

export const AZGAAR_LIMITS = {
  // Total characters across every file. A cells export of a large map is a
  // few megabytes; this is well past that and still a bounded read.
  maxChars: 48 * 1024 * 1024,
  maxFiles: 6,
  maxCells: 250_000,
  maxPlaces: 60,
} as const;

type Feature = {
  type?: unknown;
  geometry?: { type?: unknown; coordinates?: unknown } | null;
  properties?: Record<string, unknown> | null;
};

type Cell = { x: number; y: number; height: number; biome: number };
type Extent = { minX: number; minY: number; maxX: number; maxY: number };
type Found = { cells: Cell[]; burgs: Burg[]; lines: Line[]; extent: Extent };
type Burg = { x: number; y: number; name: string; capital: boolean; type: string; population: number };
type Line = { kind: PathKind; label: string; points: Array<[number, number]>; length: number };

export type AzgaarPlace = { name: string; blurb: string; at: XY };

export type AzgaarImport = {
  width: number;
  height: number;
  terrain: string;
  paths: OverworldPath[];
  places: AzgaarPlace[];
  summary: { cells: number; burgs: number; rivers: number; routes: number };
};

// Visits every [x, y] pair inside a GeoJSON coordinates value, however
// deeply it is nested.
function walk(coords: unknown, visit: (x: number, y: number) => void) {
  if (!Array.isArray(coords) || coords.length === 0) {
    return;
  }
  if (typeof coords[0] === "number") {
    const x = coords[0];
    const y = coords[1];
    if (typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) {
      visit(x, y);
    }
    return;
  }
  for (const child of coords) {
    walk(child, visit);
  }
}

// The rings of a Polygon or MultiPolygon, each without the closing point
// GeoJSON repeats, so a centroid is not pulled toward the first vertex.
function rings(coords: unknown, into: Array<Array<[number, number]>>) {
  if (!Array.isArray(coords) || coords.length === 0) {
    return;
  }
  const first = coords[0];
  if (Array.isArray(first) && typeof first[0] === "number") {
    const ring: Array<[number, number]> = [];
    for (const point of coords) {
      if (Array.isArray(point) && typeof point[0] === "number" && typeof point[1] === "number") {
        ring.push([point[0], point[1]]);
      }
    }
    const last = ring[ring.length - 1];
    if (ring.length > 1 && last[0] === ring[0][0] && last[1] === ring[0][1]) {
      ring.pop();
    }
    into.push(ring);
    return;
  }
  for (const child of coords) {
    rings(child, into);
  }
}

function extend(extent: Extent, x: number, y: number) {
  extent.minX = Math.min(extent.minX, x);
  extent.minY = Math.min(extent.minY, y);
  extent.maxX = Math.max(extent.maxX, x);
  extent.maxY = Math.max(extent.maxY, y);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function featuresOf(text: string): Feature[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const source = (parsed ?? {}) as { type?: unknown; features?: unknown };
  if (Array.isArray(source.features)) {
    return source.features as Feature[];
  }
  if (source.type === "Feature") {
    return [source as Feature];
  }
  return null;
}

// Azgaar's biome ids. Forests are 5 to 9 (the tropical, temperate and
// boreal woods), wetland is 12, and the rest are open ground of one kind
// or another. Sea level in its packed heights is 20.
const FOREST_BIOMES = new Set([5, 6, 7, 8, 9]);
const WETLAND_BIOME = 12;

export function tileForCell(height: number, biome: number): OverworldTile {
  if (height < 20) {
    return "w";
  }
  if (height >= 70) {
    return "m";
  }
  if (height >= 50) {
    return "h";
  }
  if (biome === WETLAND_BIOME) {
    return "s";
  }
  if (FOREST_BIOMES.has(biome)) {
    return "f";
  }
  return "p";
}

// Sorts every feature into a cell, a burg or a line, and grows the map's
// extent from the vertices of all three, so a road that runs to the edge of
// the cells is not clipped by a box drawn from the cells alone.
function classify(features: Feature[], into: Found) {
  for (const feature of features) {
    const geometry = feature?.geometry;
    const props = (feature?.properties ?? {}) as Record<string, unknown>;
    if (!geometry || typeof geometry.type !== "string") {
      continue;
    }
    const type = geometry.type;
    if ((type === "Polygon" || type === "MultiPolygon") && num(props.height) !== null) {
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      const found: Array<Array<[number, number]>> = [];
      rings(geometry.coordinates, found);
      for (const ring of found) {
        for (const [x, y] of ring) {
          extend(into.extent, x, y);
          sumX += x;
          sumY += y;
          count += 1;
        }
      }
      if (count && into.cells.length < AZGAAR_LIMITS.maxCells) {
        into.cells.push({
          x: sumX / count,
          y: sumY / count,
          height: num(props.height) ?? 0,
          biome: num(props.biome) ?? -1,
        });
      }
      continue;
    }
    if (type === "Point" && typeof props.name === "string" && props.name.trim()) {
      let at: [number, number] | null = null;
      walk(geometry.coordinates, (x, y) => {
        at = at ?? [x, y];
      });
      if (at) {
        const [x, y] = at as [number, number];
        extend(into.extent, x, y);
        into.burgs.push({
          x,
          y,
          name: props.name.trim().slice(0, 80),
          capital: Boolean(props.capital),
          type: typeof props.type === "string" ? props.type : "",
          population: num(props.population) ?? 0,
        });
      }
      continue;
    }
    if (type === "LineString" || type === "MultiLineString") {
      const line = lineOf(props, geometry.coordinates);
      if (line) {
        for (const [x, y] of line.points) {
          extend(into.extent, x, y);
        }
        into.lines.push(line);
      }
    }
  }
}

function lineOf(props: Record<string, unknown>, coordinates: unknown): Line | null {
  let kind: PathKind | null = null;
  const group = typeof props.group === "string" ? props.group.toLowerCase() : "";
  if (group) {
    // Routes: roads and trails are roads here; sea routes are not lines on
    // land and are left out.
    kind = group.includes("sea") ? null : "road";
  } else if (
    "discharge" in props ||
    "basin" in props ||
    (typeof props.type === "string" && /river|stream|brook|creek/i.test(props.type))
  ) {
    kind = "river";
  }
  if (!kind) {
    return null;
  }
  const points: Array<[number, number]> = [];
  walk(coordinates, (x, y) => points.push([x, y]));
  if (points.length < 2) {
    return null;
  }
  return {
    kind,
    label: typeof props.name === "string" ? props.name.trim() : "",
    points,
    length: num(props.length) ?? points.length,
  };
}

export function importAzgaar(
  texts: string[],
  requested: Partial<OverworldSize>,
  fallback: OverworldSize,
): AzgaarImport | { error: string } {
  if (!Array.isArray(texts) || texts.length === 0 || texts.length > AZGAAR_LIMITS.maxFiles) {
    return { error: `Hand over one to ${AZGAAR_LIMITS.maxFiles} GeoJSON files.` };
  }
  const chars = texts.reduce((sum, text) => sum + (typeof text === "string" ? text.length : 0), 0);
  if (chars > AZGAAR_LIMITS.maxChars) {
    return { error: "Those files are too large to read as a map." };
  }
  const found: Found = {
    cells: [],
    burgs: [],
    lines: [],
    extent: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  };
  for (const text of texts) {
    const features = typeof text === "string" ? featuresOf(text) : null;
    if (!features) {
      return { error: "One of those files is not GeoJSON." };
    }
    classify(features, found);
  }
  if (found.cells.length === 0) {
    return {
      error:
        "No cells in those files. In Fantasy Map Generator, export the Cells as GeoJSON and pick that file, with the burgs, rivers and routes files alongside if you have them.",
    };
  }

  const { minX, minY, maxX, maxY } = found.extent;
  if (!(maxX > minX) || !(maxY > minY)) {
    return { error: "That map has no extent to draw." };
  }
  // Azgaar writes longitude and latitude, where north is UP; a file in map
  // pixels has y growing downward. Coordinates inside the geographic range
  // are read as the former.
  const geographic = minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90;
  const { width, height } = normalizeSize(requested, fallback);
  const toTile = (x: number, y: number): XY => ({
    x: Math.min(width - 1, Math.max(0, Math.floor(((x - minX) / (maxX - minX)) * width))),
    y: Math.min(
      height - 1,
      Math.max(
        0,
        Math.floor((geographic ? (maxY - y) / (maxY - minY) : (y - minY) / (maxY - minY)) * height),
      ),
    ),
  });
  const toFloat = (x: number, y: number) => ({
    x: ((x - minX) / (maxX - minX)) * width,
    y: (geographic ? (maxY - y) / (maxY - minY) : (y - minY) / (maxY - minY)) * height,
  });

  // Nearest centroid per tile, through a bucket per tile so a big export
  // stays a few million comparisons rather than billions.
  const buckets = new Map<number, Array<{ fx: number; fy: number; cell: Cell }>>();
  for (const cell of found.cells) {
    const at = toFloat(cell.x, cell.y);
    const tile = toTile(cell.x, cell.y);
    const key = tile.y * width + tile.x;
    const bucket = buckets.get(key) ?? [];
    bucket.push({ fx: at.x, fy: at.y, cell });
    buckets.set(key, bucket);
  }
  // How far to look for a centroid grows with how sparse the cells are on
  // this grid: a small map read onto a vast grid has tiles many buckets from
  // the nearest cell. The rare tile still left without one falls back to a
  // full scan rather than to sea.
  const all = [...buckets.values()].flat();
  const reach = Math.max(2, Math.ceil(Math.sqrt((width * height) / found.cells.length)) + 1);
  const tiles: string[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let best: Cell | null = null;
      let bestDistance = Infinity;
      const centerX = x + 0.5;
      const centerY = y + 0.5;
      const consider = (entry: { fx: number; fy: number; cell: Cell }) => {
        const distance = (entry.fx - centerX) ** 2 + (entry.fy - centerY) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = entry.cell;
        }
      };
      for (let dy = -reach; dy <= reach; dy += 1) {
        for (let dx = -reach; dx <= reach; dx += 1) {
          if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) {
            continue;
          }
          buckets.get((y + dy) * width + (x + dx))?.forEach(consider);
        }
      }
      if (!best) {
        all.forEach(consider);
      }
      const chosen = best as Cell | null;
      tiles.push(chosen ? tileForCell(chosen.height, chosen.biome) : "w");
    }
  }

  // Roads first, then the longest rivers, inside the path ceiling.
  const roads = found.lines.filter((line) => line.kind === "road");
  const rivers = found.lines
    .filter((line) => line.kind === "river")
    .sort((a, b) => b.length - a.length);
  const rawPaths = [...roads.slice(0, FEATURE_LIMITS.paths / 2), ...rivers]
    .slice(0, FEATURE_LIMITS.paths)
    .map((line) => ({
      kind: line.kind,
      label: line.label,
      points: line.points.map(([x, y]) => toTile(x, y)),
    }));
  const paths = normalizePaths(rawPaths, width, height);

  // Capitals first, then by population, one place per name.
  const seen = new Set<string>();
  const places: AzgaarPlace[] = [];
  for (const burg of [...found.burgs].sort(
    (a, b) => Number(b.capital) - Number(a.capital) || b.population - a.population,
  )) {
    const key = burg.name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    places.push({
      name: burg.name,
      blurb: burg.capital
        ? "A capital."
        : burg.type && burg.type.toLowerCase() !== "generic"
          ? `A ${burg.type.toLowerCase()} settlement.`
          : "",
      at: toTile(burg.x, burg.y),
    });
    if (places.length >= AZGAAR_LIMITS.maxPlaces) {
      break;
    }
  }

  return {
    width,
    height,
    terrain: tiles.join(""),
    paths,
    places,
    summary: {
      cells: found.cells.length,
      burgs: found.burgs.length,
      rivers: rivers.length,
      routes: roads.length,
    },
  };
}
