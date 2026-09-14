import { TERRAIN } from "@/lib/battlemap/types";
import type { MapLabel } from "@/lib/battlemap/scene";
import type { AmbientLight, MapLight } from "@/lib/battlemap/types";
import type { MapTheme } from "@/lib/battlemap/generate";
import { normalizePaths, type OverworldLabel, type OverworldPath } from "@/lib/overworld/features";

// Watabou imports (docs/vtt-parity-implementation-plan.md 12.2), the same
// shape as uvtt.ts and azgaar.ts: read what the generator exported, say
// what could not be read, never throw.
//
// One Page Dungeon exports JSON with `rects` (rooms and corridors in cell
// units), `doors` and `notes`; the City Generator exports GeoJSON where
// each feature's `properties.type` names what it is (road, district,
// wall, water, green, plaza, earth).

export const WATABOU_LIMITS = { minSide: 8, maxSide: 80, maxChars: 4_000_000 } as const;

type Rect = { x: number; y: number; w: number; h: number };
type Door = { x: number; y: number; dir?: { x: number; y: number }; type?: number };
type Note = { text: string; pos?: { x: number; y: number }; ref?: string };

export type OnePageDungeon = {
  width: number;
  height: number;
  terrain: string;
  ambient: AmbientLight;
  theme: MapTheme;
  lights: MapLight[];
  labels: MapLabel[];
  notes: string[];
  title: string;
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readRects(raw: unknown): Rect[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const rects: Rect[] = [];
  for (const entry of raw) {
    const record = (entry ?? {}) as Record<string, unknown>;
    const x = num(record.x);
    const y = num(record.y);
    const w = num(record.w);
    const h = num(record.h);
    if (x !== null && y !== null && w !== null && h !== null && w > 0 && h > 0) {
      rects.push({ x, y, w, h });
    }
  }
  return rects;
}

export function isOnePageDungeon(file: unknown): boolean {
  const record = (file ?? {}) as Record<string, unknown>;
  return Array.isArray(record.rects) && readRects(record.rects).length > 0;
}

// Rooms and corridors become floor inside a wall; doors become door tiles
// on the wall between; a note lands as a DM-only label at its position.
export function parseOnePageDungeon(file: unknown): { map: OnePageDungeon } | { error: string } {
  const record = (file ?? {}) as Record<string, unknown>;
  const rects = readRects(record.rects);
  if (!rects.length) {
    return { error: "That file has no rooms in it, so it is not a One Page Dungeon export." };
  }
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.w));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.h));
  // One tile of wall all round, so every room has something to stand
  // against and a door on the edge still has a wall to sit in.
  const width = Math.round(maxX - minX) + 2;
  const height = Math.round(maxY - minY) + 2;
  if (width < WATABOU_LIMITS.minSide || height < WATABOU_LIMITS.minSide) {
    return { error: `That dungeon is ${width} by ${height} tiles, too small to stand in.` };
  }
  if (width > WATABOU_LIMITS.maxSide || height > WATABOU_LIMITS.maxSide) {
    return { error: `That dungeon is ${width} by ${height} tiles. This engine runs maps up to ${WATABOU_LIMITS.maxSide} tiles a side.` };
  }
  const cells = Array.from({ length: width * height }, () => TERRAIN.wall as string);
  const at = (x: number, y: number) => y * width + x;
  const offset = { x: 1 - minX, y: 1 - minY };
  for (const rect of rects) {
    for (let y = 0; y < rect.h; y += 1) {
      for (let x = 0; x < rect.w; x += 1) {
        const tx = Math.round(rect.x + x + offset.x);
        const ty = Math.round(rect.y + y + offset.y);
        if (tx >= 0 && ty >= 0 && tx < width && ty < height) {
          cells[at(tx, ty)] = TERRAIN.floor;
        }
      }
    }
  }
  let doors = 0;
  for (const entry of Array.isArray(record.doors) ? (record.doors as Door[]) : []) {
    const x = num(entry?.x);
    const y = num(entry?.y);
    if (x === null || y === null) {
      continue;
    }
    const tx = Math.round(x + offset.x);
    const ty = Math.round(y + offset.y);
    if (tx > 0 && ty > 0 && tx < width - 1 && ty < height - 1) {
      cells[at(tx, ty)] = TERRAIN.door;
      doors += 1;
    }
  }
  const labels: MapLabel[] = [];
  const notes: string[] = [];
  for (const entry of Array.isArray(record.notes) ? (record.notes as Note[]) : []) {
    const text = String(entry?.text ?? "").trim();
    if (!text) {
      continue;
    }
    const x = num(entry?.pos?.x);
    const y = num(entry?.pos?.y);
    if (x !== null && y !== null) {
      const tx = Math.max(0, Math.min(width - 1, Math.round(x + offset.x)));
      const ty = Math.max(0, Math.min(height - 1, Math.round(y + offset.y)));
      labels.push({ x: tx, y: ty, text: text.slice(0, 80), dmOnly: true });
    }
    notes.push(text);
  }
  const title = String(record.title ?? "").trim().slice(0, 80);
  const story = String(record.story ?? "").trim();
  if (story) {
    notes.unshift(story);
  }
  return {
    map: {
      width,
      height,
      terrain: cells.join(""),
      ambient: "dark",
      theme: "cave",
      lights: [],
      labels: labels.slice(0, 40),
      notes: [`Read from a One Page Dungeon export: ${rects.length} rooms and passages, ${doors} doors.`, ...notes],
      title,
    },
  };
}

// ---- the city generator ----

type Feature = { type?: string; geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> };

const CITY_TYPES = new Set(["road", "district", "wall", "water", "green", "plaza", "earth", "river", "field", "planks", "square", "prism", "tree"]);

export function isWatabouCity(file: unknown): boolean {
  const record = (file ?? {}) as Record<string, unknown>;
  if (record.type !== "FeatureCollection" || !Array.isArray(record.features)) {
    return false;
  }
  return (record.features as Feature[]).some((feature) => CITY_TYPES.has(String(feature?.properties?.type ?? "").toLowerCase()));
}

export type WatabouCity = {
  name: string;
  // Roads as region map paths and the district names as labels, both in
  // the map's own tile units after fitting to the requested size.
  paths: OverworldPath[];
  labels: OverworldLabel[];
  blurb: string;
};

function pointsOf(coordinates: unknown): Array<[number, number]> {
  if (!Array.isArray(coordinates)) {
    return [];
  }
  const points: Array<[number, number]> = [];
  for (const entry of coordinates) {
    if (Array.isArray(entry) && entry.length >= 2 && typeof entry[0] === "number" && typeof entry[1] === "number") {
      points.push([entry[0], entry[1]]);
    } else if (Array.isArray(entry)) {
      points.push(...pointsOf(entry));
    }
  }
  return points;
}

export function parseWatabouCity(file: unknown, target: { width: number; height: number }, at: { x: number; y: number }, span = 12): { city: WatabouCity } | { error: string } {
  const record = (file ?? {}) as Record<string, unknown>;
  if (!isWatabouCity(record)) {
    return { error: "That GeoJSON has no roads or districts in it, so it is not a city export." };
  }
  const features = record.features as Feature[];
  const name = String(record.name ?? (record.properties as Record<string, unknown> | undefined)?.name ?? "").trim().slice(0, 80);
  const all = features.flatMap((feature) => pointsOf(feature.geometry?.coordinates));
  if (!all.length) {
    return { error: "That city has no geometry to read." };
  }
  const minX = Math.min(...all.map((point) => point[0]));
  const maxX = Math.max(...all.map((point) => point[0]));
  const minY = Math.min(...all.map((point) => point[1]));
  const maxY = Math.max(...all.map((point) => point[1]));
  const scale = span / Math.max(1e-6, Math.max(maxX - minX, maxY - minY));
  // Fit the city into a `span`-tile box centred on the place's anchor.
  const fit = (point: [number, number]) => ({
    x: Math.max(0, Math.min(target.width - 1, at.x - span / 2 + (point[0] - minX) * scale)),
    y: Math.max(0, Math.min(target.height - 1, at.y - span / 2 + (point[1] - minY) * scale)),
  });
  const rawPaths: Array<{ kind: string; points: Array<{ x: number; y: number }> }> = [];
  const rawLabels: Array<{ text: string; x: number; y: number; size: string }> = [];
  let districts = 0;
  for (const feature of features) {
    const type = String(feature?.properties?.type ?? "").toLowerCase();
    const geometryType = String(feature?.geometry?.type ?? "");
    if (type === "road" && (geometryType === "LineString" || geometryType === "MultiLineString")) {
      const lines = geometryType === "LineString" ? [feature.geometry?.coordinates] : ((feature.geometry?.coordinates as unknown[]) ?? []);
      for (const line of lines) {
        const points = pointsOf(line).map(fit);
        if (points.length >= 2) {
          rawPaths.push({ kind: "road", points });
        }
      }
    } else if ((type === "river" || type === "water") && (geometryType === "LineString" || geometryType === "MultiLineString")) {
      const lines = geometryType === "LineString" ? [feature.geometry?.coordinates] : ((feature.geometry?.coordinates as unknown[]) ?? []);
      for (const line of lines) {
        const points = pointsOf(line).map(fit);
        if (points.length >= 2) {
          rawPaths.push({ kind: "river", points });
        }
      }
    } else if (type === "district") {
      const label = String(feature?.properties?.name ?? feature?.properties?.label ?? "").trim();
      const points = pointsOf(feature.geometry?.coordinates);
      if (label && points.length) {
        const centre = fit([points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length]);
        rawLabels.push({ text: label.slice(0, 40), x: centre.x, y: centre.y, size: "small" });
        districts += 1;
      }
    }
  }
  const paths = normalizePaths(rawPaths, target.width, target.height);
  const labels: OverworldLabel[] = rawLabels.slice(0, 24).map((label, index) => ({
    id: `district-${index}`,
    text: label.text,
    x: Math.round(label.x),
    y: Math.round(label.y),
    size: "small",
  }));
  return {
    city: {
      name,
      paths,
      labels,
      blurb: `${districts ? `${districts} districts` : "A city"}${rawPaths.length ? `, ${rawPaths.filter((path) => path.kind === "road").length} roads` : ""}, read from a Watabou city export.`,
    },
  };
}
