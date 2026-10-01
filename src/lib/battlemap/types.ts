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
  // A low wall, fence or chasm edge: nothing walks through it, everything
  // sees over it, and a creature directly behind it has half cover.
  lowwall: "|",
  // A surface crossed by climbing (a ladder, a rope, a scree slope, a rough
  // wall): every foot costs two unless the mover has a climbing speed or
  // Second-Story Work (SRD 5.1, Climbing, Swimming, and Crawling).
  climb: "^",
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

// How a token is getting about right now. Walking is the default; flying
// lifts it over the ground (tremorsense misses it, the board draws it
// raised); burrowing sinks it (set by the set_movement tool, by Wild Shape
// into a flying form, or by the DM).
export const TOKEN_MOVEMENTS = ["walk", "fly", "burrow"] as const;
export type TokenMovement = (typeof TOKEN_MOVEMENTS)[number];

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
  // When that light gutters out, as a clock instant, and how long it had
  // when lit (docs/vtt-parity-implementation-plan.md 7.3). 0 = it does not
  // burn down.
  burnsUntil: number;
  lightMinutes: number;
  // Kept off the players' board by the DM: an ambusher in the rafters, a
  // trap that has not sprung. One flag covers the map and the initiative
  // tracker, because a creature the party has not met should not be visible
  // in either (src/lib/db/encounters.ts).
  hidden: boolean;
  // The painted object this token is drawn as (public/assets/props), for the
  // DM's own furniture placed with a prepared map; "" draws the plain figure.
  stamp?: string;
  movement: TokenMovement;
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
  return ch === TERRAIN.wall || ch === TERRAIN.lowwall;
}

// The same question for a creature in the air: a fence is nothing to it.
export function blocksMoveFor(ch: string, flying: boolean): boolean {
  return ch === TERRAIN.wall || (!flying && ch === TERRAIN.lowwall);
}

export function blocksSight(ch: string): boolean {
  return ch === TERRAIN.wall;
}

// Cost in budget units to STEP ONTO a tile. Walls are handled by
// blocksMove before cost is consulted. Water costs double for anyone
// without a swimming speed (SRD 5.1, Climbing, Swimming, and Crawling).
//
// Land's Stride (druid 6 Circle of the Land, ranger 8): nonmagical difficult
// terrain costs no extra movement; the board's difficult tiles are all
// nonmagical (rubble, undergrowth).
//
// The object form also carries how the mover gets past other creatures
// (SRD 5.1, Moving Around Other Creatures): `passable` holds the occupied
// squares it may move through but not end in (an ally's, a hostile's two
// sizes apart, any larger creature's for Halfling Nimbleness), each costing
// double as difficult terrain; `squeeze` lets a creature larger than one
// square squeeze where one size smaller fits, at double cost.
export type MoveTraits =
  | boolean
  | {
      swims?: boolean;
      landStride?: boolean;
      climbs?: boolean;
      passable?: Set<number>;
      squeeze?: boolean;
      // What a spell area makes of a step (src/lib/battlemap/zones.ts
      // zoneStepCost): the step's cost from square `from` (-1 unknown) onto `to`.
      zoneStep?: (from: number, to: number, cost: number) => number;
    };

export function moveCost(ch: string, traits: MoveTraits = false): number {
  const swims = typeof traits === "boolean" ? traits : Boolean(traits.swims);
  if (ch === TERRAIN.water) {
    return swims ? 1 : 2;
  }
  if (ch === TERRAIN.climb) {
    return typeof traits === "object" && traits.climbs ? 1 : 2;
  }
  const stride = typeof traits === "object" && Boolean(traits.landStride);
  return ch === TERRAIN.difficult && !stride ? 2 : 1;
}

// A character's walking traits from their features: a swimming speed, Land's
// Stride.
export function moveTraitsFrom(features: Array<{ name: string }> = []): MoveTraits {
  return {
    swims: swimsFrom(undefined, features),
    landStride: features.some((feature) => /^land's stride\b/i.test(feature.name.trim())),
    climbs: climbsFrom(undefined, features),
  };
}

// Whether a creature climbs at its normal cost: a stat block's "climb 30
// ft.", a feature naming a climbing speed, or Second-Story Work (Thief 3:
// "climbing no longer costs you extra movement").
export function climbsFrom(speedText: string | undefined, features: Array<{ name: string }> = []): boolean {
  return (
    /\bclimb\b/i.test(speedText ?? "") ||
    features.some((feature) => /climb(ing)? speed|^second-story work\b/i.test(feature.name.trim()))
  );
}

// The squares a mover may pass through, and the doubling a creature's space
// costs, read from a MoveTraits.
export function passableOf(traits: MoveTraits): Set<number> | null {
  return typeof traits === "object" && traits.passable ? traits.passable : null;
}

// Whether a creature has a swimming speed: a stat block's "swim 40 ft.",
// a character's racial or class feature that grants one.
export function swimsFrom(speedText: string | undefined, features: Array<{ name: string }> = []): boolean {
  return /\bswim\b/i.test(speedText ?? "") || features.some((feature) => /swim(ming)? speed|\bswimmer\b/i.test(feature.name));
}

export function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

// A creature's flying speed in feet, or null when it has none (SRD 5.1: only
// a creature with a flying speed takes to the air). A stat block's "fly 60
// ft."; for a character, the Fly spell's 60 feet ("flying"), a feature that
// names a flying speed or wings, or a Wild Shape form (its flight was judged
// when the form was taken).
// A creature's flying speed: its block's printed fly, the Fly spell, a
// feature that names one, or wings (a Draconic sorcerer's Dragon Wings) at
// the walking speed.
export function flyingSpeedOf(input: {
  speedText?: string;
  conditions?: string[];
  features?: Array<{ name: string }>;
  wildShaped?: boolean;
  walkingFeet?: number;
}): number | null {
  const printed = /\bfly\s+(\d+)/i.exec(input.speedText ?? "");
  if (printed) {
    return Number(printed[1]);
  }
  if ((input.conditions ?? []).some((entry) => /^flying\b|^fly \(spell\)$/i.test(entry.trim()))) {
    return 60;
  }
  // Gaseous Form's mist flies 10 feet, Wind Walk's cloud 300 (SRD 5.1).
  const mist = (input.conditions ?? []).map((entry) => entry.trim().toLowerCase());
  if (mist.includes("gaseous form") || mist.includes("wind walk")) {
    return mist.includes("wind walk") ? 300 : 10;
  }
  const named = (input.features ?? []).map((feature) => /flying speed(?: of)? (\d+)/i.exec(feature.name)).find(Boolean);
  if (named) {
    return Number(named[1]);
  }
  if ((input.features ?? []).some((feature) => /\bwings?\b|flying speed/i.test(feature.name)) || input.wildShaped) {
    return input.walkingFeet ?? 30;
  }
  return null;
}
