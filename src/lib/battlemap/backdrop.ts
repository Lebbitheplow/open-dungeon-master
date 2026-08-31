// The picture under the grid.
//
// ODM's battle map is a row-major string over five characters, and that is
// what makes pathfinding, line of sight, cover and fog cheap and
// server-authoritative. Art does not fit in five characters, so it does not
// go in the terrain string at all. It goes underneath, in its own layer,
// where nothing mechanical reads it.
//
// That separation is the honest one. A backdrop is a photograph of a place;
// the terrain string is the place. When a DM drops in a beautiful illustrated
// dungeon, the walls that stop a rogue are the walls they painted, not the
// walls in the picture, and the studio says so out loud rather than letting
// the two drift silently apart.
//
// Fog is the part that is easy to get wrong. A backdrop drawn edge to edge
// would show a player the whole dungeon through the fog that is hiding the
// terrain, so the projection carries the image but the renderer draws it
// only inside explored tiles (src/app/campaigns/[campaignId]/battleMapCells.tsx).
//
// Pure by design: no DB and no I/O, so scripts/test-map-backdrop.mjs drives
// it directly. The impure rim is src/lib/db/battle-maps.ts.

import { isUploadedImagePath } from "@/lib/uploads";

export type BackdropTransform = {
  // Nudge in tiles, so a picture whose grid does not start at its corner can
  // be slid into register with the one the engine runs on.
  offsetX: number;
  offsetY: number;
  // Multiplier on the image's natural fit to the board.
  scale: number;
  // How strongly the art shows through the terrain drawn over it.
  opacity: number;
};

export type Backdrop = {
  path: string;
  transform: BackdropTransform;
};

export const DEFAULT_BACKDROP_TRANSFORM: BackdropTransform = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  opacity: 1,
};

// Generous enough to align any sane import, bounded so a stored transform
// can never push the image somewhere a DM cannot find it again.
export const BACKDROP_LIMITS = {
  maxOffset: 40,
  minScale: 0.2,
  maxScale: 5,
} as const;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

export function normalizeBackdropTransform(value: unknown): BackdropTransform {
  const raw = (value ?? {}) as Partial<Record<keyof BackdropTransform, unknown>>;
  return {
    offsetX: clamp(raw.offsetX, -BACKDROP_LIMITS.maxOffset, BACKDROP_LIMITS.maxOffset, 0),
    offsetY: clamp(raw.offsetY, -BACKDROP_LIMITS.maxOffset, BACKDROP_LIMITS.maxOffset, 0),
    scale: clamp(raw.scale, BACKDROP_LIMITS.minScale, BACKDROP_LIMITS.maxScale, 1),
    opacity: clamp(raw.opacity, 0, 1, 1),
  };
}

// The only shape a backdrop path may take: a file this app wrote into
// public/uploads through /api/upload. The guard itself moved to
// src/lib/uploads.ts when NPC portraits needed the same one; this keeps the
// name the backdrop code reads best, and there is still one regular
// expression deciding it.
export const isBackdropPath = isUploadedImagePath;

export function normalizeBackdrop(path: unknown, transform: unknown): Backdrop | null {
  if (!isBackdropPath(path)) {
    return null;
  }
  return { path, transform: normalizeBackdropTransform(transform) };
}

// Where the image lands, in the same pixel space the tile grid is drawn in.
// The natural fit is the whole board; scale grows it about its centre so
// zooming does not also walk it off the corner, and the offset is applied in
// tiles afterwards so a nudge means the same thing at every zoom.
export function backdropRect(
  transform: BackdropTransform,
  width: number,
  height: number,
  tileSize: number,
): { x: number; y: number; width: number; height: number } {
  const boardWidth = width * tileSize;
  const boardHeight = height * tileSize;
  const scaled = { width: boardWidth * transform.scale, height: boardHeight * transform.scale };
  return {
    x: (boardWidth - scaled.width) / 2 + transform.offsetX * tileSize,
    y: (boardHeight - scaled.height) / 2 + transform.offsetY * tileSize,
    width: scaled.width,
    height: scaled.height,
  };
}

// Whether a transform is still the one a fresh import gets, so a panel can
// offer "reset" only when there is something to reset.
export function isDefaultTransform(transform: BackdropTransform): boolean {
  return (
    transform.offsetX === DEFAULT_BACKDROP_TRANSFORM.offsetX &&
    transform.offsetY === DEFAULT_BACKDROP_TRANSFORM.offsetY &&
    transform.scale === DEFAULT_BACKDROP_TRANSFORM.scale &&
    transform.opacity === DEFAULT_BACKDROP_TRANSFORM.opacity
  );
}
