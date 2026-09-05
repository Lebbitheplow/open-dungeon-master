import { TERRAIN, TILE_FEET, inBounds, tileIndex, type MapLight, type XY } from "@/lib/battlemap/types";

// Placing lights by hand.
//
// The generator has always put braziers where it liked and a UVTT import
// carries the lights the drawing had, but until this module a DM could not
// say "there is a torch on this wall". A light is a tile and two radii; the
// light model in los.ts already reads exactly that, so this is the editor's
// half of a feature the engine had from the start.
//
// Pure by design: no DB and no I/O, so scripts/test-map-lights.mjs drives it.

export const LIGHT_LIMITS = {
  // Enough for a lantern-lit hall, few enough that the lighting pass stays
  // the cheap thing it is; the same ceiling the UVTT importer keeps.
  max: 24,
  minRadius: 1,
  maxRadius: 8,
} as const;

// What a torch, a lantern and a bonfire look like in tiles, so the palette
// offers something to pick rather than two empty number boxes.
export const LIGHT_PRESETS = [
  { id: "candle", label: "Candle", brightRadius: 1, dimRadius: 2 },
  { id: "torch", label: "Torch", brightRadius: 4, dimRadius: 8 },
  { id: "lantern", label: "Lantern", brightRadius: 6, dimRadius: 8 },
  { id: "bonfire", label: "Bonfire", brightRadius: 8, dimRadius: 8 },
] as const;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : NaN;
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

// A raw light list checked into something the engine can run: in bounds,
// radii inside the limits, dim never smaller than bright, one light per
// tile, and no more than the cap. Nothing is refused; a list is cleaned.
export function normalizeLights(raw: unknown, width: number, height: number): MapLight[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<number>();
  const out: MapLight[] = [];
  for (const entry of raw) {
    const source = (entry ?? {}) as Partial<MapLight>;
    // A light off the map is dropped, not pulled to the edge: a torch that
    // was in the next room over is not a torch on the border.
    if (typeof source.x !== "number" || typeof source.y !== "number") {
      continue;
    }
    const x = Math.round(source.x);
    const y = Math.round(source.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !inBounds(width, height, x, y)) {
      continue;
    }
    const index = tileIndex(width, x, y);
    if (seen.has(index)) {
      continue;
    }
    const brightRadius = clamp(source.brightRadius, LIGHT_LIMITS.minRadius, LIGHT_LIMITS.maxRadius, 4);
    const dimRadius = clamp(source.dimRadius, brightRadius, LIGHT_LIMITS.maxRadius, Math.min(8, brightRadius * 2));
    seen.add(index);
    out.push({ x, y, brightRadius, dimRadius });
    if (out.length >= LIGHT_LIMITS.max) {
      break;
    }
  }
  return out;
}

export type LightToggle = XY & { brightRadius: number; dimRadius: number };

// Place a light on a tile, or take away the one already there. A wall is
// refused: a light burns in a room, and a light inside solid rock would
// light nothing while still counting against the cap.
export function toggleLight(
  lights: MapLight[],
  toggle: LightToggle,
  terrain: string,
  width: number,
  height: number,
): { lights: MapLight[]; placed: boolean } | { error: string } {
  const x = Math.round(toggle.x);
  const y = Math.round(toggle.y);
  if (!inBounds(width, height, x, y)) {
    return { error: "That tile is off the map." };
  }
  const existing = lights.findIndex((light) => light.x === x && light.y === y);
  if (existing >= 0) {
    return { lights: lights.filter((_, index) => index !== existing), placed: false };
  }
  if (terrain[tileIndex(width, x, y)] === TERRAIN.wall) {
    return { error: "A light needs somewhere to burn; that tile is wall." };
  }
  if (lights.length >= LIGHT_LIMITS.max) {
    return { error: `That is already ${LIGHT_LIMITS.max} lights; take one away first.` };
  }
  const placed = normalizeLights([{ x, y, brightRadius: toggle.brightRadius, dimRadius: toggle.dimRadius }], width, height);
  return { lights: [...lights, ...placed], placed: true };
}

// "Bright 20 ft, dim to 40 ft", for a tooltip.
export function describeLight(light: Pick<MapLight, "brightRadius" | "dimRadius">): string {
  return `Bright ${light.brightRadius * TILE_FEET} ft, dim to ${light.dimRadius * TILE_FEET} ft`;
}
