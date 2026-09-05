import type { XY } from "@/lib/overworld/logic";

// What is drawn OVER the region map: roads, rivers and borders as lists of
// tile points, and words written across a stretch of it. Plus the sizes a
// map may be rolled at. See docs/workshop-parity-audit.md phase 15.
//
// Nothing here touches terrain. A road does not change what a tile is, and a
// border is a line on a map rather than a rule; the engine that places
// settlements and validates paint (logic.ts, paint.ts) never reads these.
// They are world facts every member sees, unlike the DM's notes.

export const PATH_KINDS = ["road", "river", "border"] as const;
export type PathKind = (typeof PATH_KINDS)[number];

export const PATH_KIND_LABELS: Record<PathKind, string> = {
  road: "Road",
  river: "River",
  border: "Border",
};

export type OverworldPath = {
  id: string;
  kind: PathKind;
  // Tile coordinates, in drawing order. Straight segments between them.
  points: XY[];
  label: string;
};

export const LABEL_SIZES = ["small", "large"] as const;
export type LabelSize = (typeof LABEL_SIZES)[number];

export type OverworldLabel = {
  id: string;
  x: number;
  y: number;
  text: string;
  size: LabelSize;
};

export const FEATURE_LIMITS = {
  paths: 80,
  pointsPerPath: 400,
  labels: 60,
  labelLength: 40,
} as const;

// A map may be rolled at any size inside these, and the presets below are
// the ones offered by name. The default map has always been 96 by 72.
export const OVERWORLD_SIZE_LIMITS = {
  minWidth: 24,
  maxWidth: 192,
  minHeight: 18,
  maxHeight: 144,
} as const;

export const OVERWORLD_SIZES = [
  { id: "small", label: "Small", width: 48, height: 36 },
  { id: "medium", label: "Medium", width: 96, height: 72 },
  { id: "large", label: "Large", width: 144, height: 108 },
  { id: "vast", label: "Vast", width: 192, height: 144 },
] as const;

export type OverworldSize = { width: number; height: number };

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function normalizeSize(raw: unknown, fallback: OverworldSize): OverworldSize {
  const source = (raw ?? {}) as Partial<Record<keyof OverworldSize, unknown>>;
  const limits = OVERWORLD_SIZE_LIMITS;
  return {
    width: clampInt(source.width, limits.minWidth, limits.maxWidth, fallback.width),
    height: clampInt(source.height, limits.minHeight, limits.maxHeight, fallback.height),
  };
}

export function sizeLabel(size: OverworldSize): string {
  const preset = OVERWORLD_SIZES.find(
    (entry) => entry.width === size.width && entry.height === size.height,
  );
  return preset ? `${preset.label} (${size.width} by ${size.height})` : `${size.width} by ${size.height}`;
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

// A point off the map is DROPPED rather than clamped: a resize that cuts a
// river short should shorten the river, not pile its tail on the edge.
function pointOn(raw: unknown, width: number, height: number): XY | null {
  const source = (raw ?? {}) as Partial<Record<"x" | "y", unknown>>;
  const x = typeof source.x === "number" ? Math.round(source.x) : NaN;
  const y = typeof source.y === "number" ? Math.round(source.y) : NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return x >= 0 && y >= 0 && x < width && y < height ? { x, y } : null;
}

// Thins a point list to at most `max` entries, always keeping both ends.
export function decimate<T>(points: T[], max: number): T[] {
  if (points.length <= max || max < 2) {
    return points.slice(0, Math.max(0, max));
  }
  const step = (points.length - 1) / (max - 1);
  const kept: T[] = [];
  for (let index = 0; index < max; index += 1) {
    kept.push(points[Math.round(index * step)]);
  }
  return kept;
}

function labelText(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, FEATURE_LIMITS.labelLength);
}

// Anything in, a list of drawable paths out. Applied at every boundary: the
// PATCH body, a bundle, an Azgaar file, and a resize (which is the same
// operation against the new width and height).
export function normalizePaths(raw: unknown, width: number, height: number): OverworldPath[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const paths: OverworldPath[] = [];
  for (const entry of raw) {
    const source = (entry ?? {}) as Partial<Record<keyof OverworldPath, unknown>>;
    const kind = PATH_KINDS.find((candidate) => candidate === source.kind);
    if (!kind || !Array.isArray(source.points)) {
      continue;
    }
    const points: XY[] = [];
    for (const rawPoint of source.points) {
      const point = pointOn(rawPoint, width, height);
      if (!point) {
        continue;
      }
      const last = points[points.length - 1];
      if (last && last.x === point.x && last.y === point.y) {
        continue;
      }
      points.push(point);
    }
    if (points.length < 2) {
      continue;
    }
    paths.push({
      id: typeof source.id === "string" && source.id ? source.id.slice(0, 80) : newId(),
      kind,
      points: decimate(points, FEATURE_LIMITS.pointsPerPath),
      label: labelText(source.label),
    });
    if (paths.length >= FEATURE_LIMITS.paths) {
      break;
    }
  }
  return paths;
}

export function normalizeLabels(raw: unknown, width: number, height: number): OverworldLabel[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const labels: OverworldLabel[] = [];
  for (const entry of raw) {
    const source = (entry ?? {}) as Partial<Record<keyof OverworldLabel, unknown>>;
    const at = pointOn(source, width, height);
    const text = labelText(source.text);
    if (!at || !text) {
      continue;
    }
    labels.push({
      id: typeof source.id === "string" && source.id ? source.id.slice(0, 80) : newId(),
      x: at.x,
      y: at.y,
      text,
      size: source.size === "large" ? "large" : "small",
    });
    if (labels.length >= FEATURE_LIMITS.labels) {
      break;
    }
  }
  return labels;
}

// Length in tiles: the longest axis of each segment, so a diagonal counts
// once, the way a party crossing it would.
export function pathLength(path: Pick<OverworldPath, "points">): number {
  let length = 0;
  for (let index = 1; index < path.points.length; index += 1) {
    const from = path.points[index - 1];
    const to = path.points[index];
    length += Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  }
  return length;
}

function distanceToSegment(point: XY, from: XY, to: XY): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

// What is under a tap: a label on or next to the tile first, then the path
// whose line passes within `reach` tiles. Labels win because they are
// smaller targets.
export function featureAt(
  paths: OverworldPath[],
  labels: OverworldLabel[],
  at: XY,
  reach = 1,
): { label: OverworldLabel } | { path: OverworldPath } | null {
  const label = labels.find(
    (entry) => Math.abs(entry.x - at.x) <= reach && Math.abs(entry.y - at.y) <= reach,
  );
  if (label) {
    return { label };
  }
  for (const path of paths) {
    for (let index = 1; index < path.points.length; index += 1) {
      if (distanceToSegment(at, path.points[index - 1], path.points[index]) <= reach + 0.5) {
        return { path };
      }
    }
  }
  return null;
}

// Prose for the DM prompt and the panel's list: every named line and word
// on the map, with how far a road runs.
export function describeFeatures(paths: OverworldPath[], labels: OverworldLabel[]): string[] {
  const lines: string[] = [];
  for (const path of paths) {
    const name = path.label || `an unnamed ${path.kind}`;
    const length = pathLength(path);
    lines.push(
      `${PATH_KIND_LABELS[path.kind]}: ${name}, ${length} tile${length === 1 ? "" : "s"} long.`,
    );
  }
  for (const label of labels) {
    lines.push(`${label.size === "large" ? "Region" : "Place"} label: ${label.text}.`);
  }
  return lines;
}
