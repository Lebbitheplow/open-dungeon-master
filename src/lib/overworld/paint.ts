// Painting the region map by hand.
//
// The overworld has been generate-or-nothing since it was built: five dials
// and a seed, reroll until something looks right. That is a good way to get
// a world and a bad way to get THIS world, where the DM has already decided
// there is a mountain range between the two cities.
//
// Modelled on src/lib/battlemap/paint.ts, and different in what it has to
// protect. A battle map owes the engine a connected field and a walled
// border, because pathfinding and line of sight assume them. The overworld
// owes it one thing instead: somewhere to stand. `placeAnchor` in logic.ts
// refuses to put a location on water or mountain, so a region painted
// entirely into ocean and peaks is a region no place can exist in, and every
// location the campaign discovers afterwards would pile onto the same
// fallback tile.
//
// Pure by design: no DB and no I/O, so scripts/test-overworld-paint.mjs
// drives it through the alias loader. Its one import is logic.ts, which is
// itself pure; the impure rim is src/lib/db/overworld.ts.

import {
  OVERWORLD_HEIGHT,
  OVERWORLD_WIDTH,
  tileAt,
  type OverworldTile,
  type XY,
} from "@/lib/overworld/logic";

export const OVERWORLD_BRUSHES = [
  "water",
  "plains",
  "forest",
  "hills",
  "mountains",
  "swamp",
] as const;
export type OverworldBrush = (typeof OVERWORLD_BRUSHES)[number];

// Written for a person looking at a map, not for the tile alphabet.
export const OVERWORLD_BRUSH_LABELS: Record<OverworldBrush, string> = {
  water: "Sea and lakes",
  plains: "Open country",
  forest: "Forest",
  hills: "Hills",
  mountains: "Mountains",
  swamp: "Marsh",
};

// Exported so a palette can colour each brush with the same swatch the map
// itself draws, rather than keeping a second copy of the tile colours.
export const OVERWORLD_BRUSH_TILES: Record<OverworldBrush, OverworldTile> = {
  water: "w",
  plains: "p",
  forest: "f",
  hills: "h",
  mountains: "m",
  swamp: "s",
};

// The two the anchor placer refuses to stand a location on
// (UNANCHORABLE in logic.ts). Kept as its own list so the reason a paint can
// be refused is stated where the refusing happens.
const UNSETTLEABLE: ReadonlySet<string> = new Set(["w", "m"]);

export function isSettleable(tile: string): boolean {
  return !UNSETTLEABLE.has(tile);
}

// A brush size in tiles. The region grid is 96x72, so single-tile painting
// would be a thousand clicks to move a coastline; the cap keeps one stroke
// from repainting a third of the world by accident.
export const MAX_BRUSH_RADIUS = 6;

export type OverworldStroke = {
  x: number;
  y: number;
  brush: OverworldBrush;
  // 0 paints one tile; 1 paints a 3x3, and so on, as a filled circle.
  radius?: number;
};

export const MAX_STROKES = 4_000;

// A location's marker, so a paint can say which ones it stranded.
export type AnchorRef = { id: string; name: string; at: XY };

export type PaintOverworldResult =
  | {
      terrain: string;
      // Anchors now standing on water or mountain. NOT an error: a DM who
      // floods a valley may well intend to move the village, and refusing
      // would make the brush unusable near anything already placed. The
      // caller re-places them and says so.
      stranded: AnchorRef[];
      // Tiles whose value actually changed, for a "you painted 40 tiles"
      // confirmation that is true rather than the stroke count.
      changed: number;
    }
  | { error: string };

function clampRadius(radius: number | undefined): number {
  if (!Number.isFinite(radius as number)) {
    return 0;
  }
  return Math.min(MAX_BRUSH_RADIUS, Math.max(0, Math.round(radius as number)));
}

export function paintOverworld(input: {
  terrain: string;
  width?: number;
  height?: number;
  strokes: OverworldStroke[];
  // Where locations currently sit, so the result can report the drowned.
  anchors?: AnchorRef[];
}): PaintOverworldResult {
  const width = input.width ?? OVERWORLD_WIDTH;
  const height = input.height ?? OVERWORLD_HEIGHT;
  const strokes = input.strokes ?? [];

  if (input.terrain.length !== width * height) {
    return { error: "That map is the wrong size to paint on." };
  }
  if (!strokes.length) {
    return { error: "Nothing was painted." };
  }
  if (strokes.length > MAX_STROKES) {
    return { error: "That is too much to paint in one go." };
  }

  const tiles = input.terrain.split("");
  let changed = 0;

  for (const stroke of strokes) {
    const brush = OVERWORLD_BRUSH_TILES[stroke.brush];
    if (!brush) {
      return { error: "That is not a terrain this map knows." };
    }
    if (!Number.isFinite(stroke.x) || !Number.isFinite(stroke.y)) {
      return { error: "A stroke landed nowhere." };
    }
    const radius = clampRadius(stroke.radius);
    const centerX = Math.round(stroke.x);
    const centerY = Math.round(stroke.y);
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        // A filled circle rather than a square: a square brush leaves
        // unmistakably rectangular coastlines.
        if (dx * dx + dy * dy > radius * radius + radius) {
          continue;
        }
        const x = centerX + dx;
        const y = centerY + dy;
        // Out of bounds is skipped rather than refused, so painting up to
        // the edge does not require staying inside it.
        if (x < 0 || y < 0 || x >= width || y >= height) {
          continue;
        }
        const index = y * width + x;
        if (tiles[index] !== brush) {
          tiles[index] = brush;
          changed += 1;
        }
      }
    }
  }

  if (!changed) {
    return { error: "That was already what the map looked like." };
  }

  const terrain = tiles.join("");

  // The one thing the region map owes the engine.
  if (!terrain.split("").some(isSettleable)) {
    return {
      error:
        "That would leave nowhere on the map a settlement could stand. Leave some ground that is not sea or peak.",
    };
  }

  const stranded = (input.anchors ?? []).filter(
    (anchor) => !isSettleable(tileAt(terrain, width, anchor.at.x, anchor.at.y)),
  );

  return { terrain, stranded, changed };
}

// How much of the map each terrain covers, for a legend that tells the DM
// what they have actually built rather than only what they can paint.
export function terrainMix(terrain: string): Record<OverworldBrush, number> {
  const counts = Object.fromEntries(
    OVERWORLD_BRUSHES.map((brush) => [brush, 0]),
  ) as Record<OverworldBrush, number>;
  const byTile = Object.fromEntries(
    OVERWORLD_BRUSHES.map((brush) => [OVERWORLD_BRUSH_TILES[brush], brush]),
  ) as Record<string, OverworldBrush>;
  for (const tile of terrain) {
    const brush = byTile[tile];
    if (brush) {
      counts[brush] += 1;
    }
  }
  return counts;
}
