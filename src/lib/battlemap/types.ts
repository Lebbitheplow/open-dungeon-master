// Tactical battle map primitives. Terrain is a row-major string, one char
// per tile, so it stores and diffs cheaply and serializes for the DM prompt
// as-is. All modules in this directory except view.ts are pure (no DB) so
// the scripts/test-battlemap-*.mjs suites can drive them directly.

export const TILE_FEET = 5;

export const TERRAIN = {
  floor: ".",
  wall: "#",
  water: "~",
  difficult: ",",
  door: "+",
} as const;

export type TerrainChar = (typeof TERRAIN)[keyof typeof TERRAIN];

export type AmbientLight = "bright" | "dim" | "dark";

export type XY = { x: number; y: number };

// A static light source placed at map generation (brazier, campfire).
// Radii are in tiles, Chebyshev distance.
export type MapLight = {
  x: number;
  y: number;
  brightRadius: number;
  dimRadius: number;
};

// "pc" and "enemy" are combatants the engine owns: their ref_id points at a
// character sheet or an encounter enemy, and encounter math, targeting and
// initiative all read them. "npc" and "prop" are the DM's own furniture: a
// shopkeeper standing in the doorway, a barrel, a brazier. They carry no
// stat block, so nothing in the rules engine can target them by accident,
// which is exactly why they are their own kinds rather than enemies with
// zero hit points.
export const TOKEN_KINDS = ["pc", "enemy", "npc", "prop"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

// The kinds a DM may place and remove by hand.
export const ADHOC_TOKEN_KINDS = ["npc", "prop"] as const;
export type AdhocTokenKind = (typeof ADHOC_TOKEN_KINDS)[number];

export type BattleToken = {
  id: string;
  kind: TokenKind;
  // character_sheets.id for PCs, encounter_enemies.id for enemies.
  refId: string;
  name: string;
  x: number;
  y: number;
  // Movement budget already spent this round, in tile-cost units.
  movedThisRound: number;
  // Carried light (torch/lantern): bright radius in tiles, 0 = none. The
  // dim radius is always double the bright radius.
  lightRadius: number;
  // Kept off the players' board by the DM: an ambusher in the rafters, a
  // trap that has not sprung. One flag covers the map and the initiative
  // tracker, because a creature the party has not met should not be visible
  // in either (src/lib/db/encounters.ts).
  hidden: boolean;
};

export function tileIndex(width: number, x: number, y: number): number {
  return y * width + x;
}

export function inBounds(width: number, height: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

export function tileAt(terrain: string, width: number, x: number, y: number): string {
  return terrain[tileIndex(width, x, y)] ?? TERRAIN.wall;
}

export function blocksMove(ch: string): boolean {
  return ch === TERRAIN.wall;
}

export function blocksSight(ch: string): boolean {
  return ch === TERRAIN.wall;
}

// Cost in budget units to STEP ONTO a tile. Walls are handled by
// blocksMove before cost is consulted.
export function moveCost(ch: string): number {
  return ch === TERRAIN.water || ch === TERRAIN.difficult ? 2 : 1;
}

export function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}
