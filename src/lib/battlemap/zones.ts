// Spell areas on the battle map: the ground a running spell changes for as
// long as it lasts (Web, Fog Cloud, Darkness, Silence, a Wall of Stone).
//
// A zone is stored on the map row (battle_maps.spell_zones_json) as the
// squares it covers, who cast it, and how long it lasts; what the squares DO
// is read from the spell's row (src/lib/battlemap/zones-spells.ts) at use.
// Everything here is pure, like the rest of this directory: the geometry,
// what a step costs, what a sight line crosses, what is silent, and the
// lines GAME STATE shows. The DB and the turn loop are
// src/lib/dm/zone-store.ts, zone-cast.ts and zone-triggers.ts.
//
// Walls are the one part the engine learns by its terrain: the map row
// hands out a terrain string with a wall's squares turned to rock
// (withZoneWalls), as it does for a locked door, so movement, sight lines,
// cover and spawning need no second shape.

import { templateTiles } from "@/lib/battlemap/template";
import { chebyshev, inBounds, tileIndex, TERRAIN, type BattleToken, type XY } from "@/lib/battlemap/types";
import type { LightZone } from "@/lib/battlemap/scene";
import { zoneRowFor, type ZoneRow } from "@/lib/battlemap/zones-spells";

export type ZoneCasterKind = "pc" | "enemy";

export type SpellZone = {
  id: string;
  spell: string;
  casterId: string;
  casterKind: ZoneCasterKind;
  casterName: string;
  // The point it was laid at: a burst's centre, a wall's first square, the
  // caster's square for a line.
  origin: XY;
  toward?: XY;
  cells: number[];
  // Wall of Fire's burning side, 10 feet out from the wall.
  hot?: number[];
  concentration: boolean;
  castRound: number;
  // The last round it lasts; null lasts until the fight is over.
  untilRound: number | null;
  slotLevel: number | null;
  dc: number | null;
  // Guardian of Faith: damage dealt so far.
  dealt?: number;
  // "<creature id>:enter" -> the turn it last suffered entering, so the area
  // strikes a creature once a turn.
  struck?: Record<string, string>;
};

export const MAX_ZONES = 24;

type Raw = Record<string, unknown>;

function int(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.round(number) : null;
}

function point(raw: unknown, width: number, height: number): XY | null {
  const source = (raw ?? {}) as Raw;
  const x = int(source.x);
  const y = int(source.y);
  return x !== null && y !== null && inBounds(width, height, x, y) ? { x, y } : null;
}

function cellList(raw: unknown, width: number, height: number): number[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const size = width * height;
  return [...new Set(raw.map(int).filter((cell): cell is number => cell !== null && cell >= 0 && cell < size))];
}

// A stored list cleaned, never refused: an entry naming no known spell or
// no square is dropped, so an old or hand-edited row still loads.
export function normalizeSpellZones(raw: unknown, width: number, height: number): SpellZone[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: SpellZone[] = [];
  for (const entry of raw) {
    const source = (entry ?? {}) as Raw;
    const spell = typeof source.spell === "string" ? source.spell.trim().slice(0, 80) : "";
    const origin = point(source.origin, width, height);
    const casterId = typeof source.casterId === "string" ? source.casterId.slice(0, 80) : "";
    if (!spell || !origin || !casterId || !zoneRowFor(spell)) {
      continue;
    }
    const toward = point(source.toward, width, height);
    const until = source.untilRound === null ? null : int(source.untilRound);
    const struck: Record<string, string> = {};
    if (source.struck && typeof source.struck === "object") {
      for (const [key, value] of Object.entries(source.struck as Raw)) {
        if (typeof value === "string") {
          struck[key.slice(0, 100)] = value.slice(0, 40);
        }
      }
    }
    out.push({
      id: typeof source.id === "string" && source.id ? source.id.slice(0, 40) : `${spell}-${out.length}`,
      spell,
      casterId,
      casterKind: source.casterKind === "enemy" ? "enemy" : "pc",
      casterName: typeof source.casterName === "string" ? source.casterName.slice(0, 80) : "",
      origin,
      ...(toward ? { toward } : {}),
      cells: cellList(source.cells, width, height),
      ...(Array.isArray(source.hot) ? { hot: cellList(source.hot, width, height) } : {}),
      concentration: source.concentration === true,
      castRound: int(source.castRound) ?? 1,
      untilRound: until,
      slotLevel: int(source.slotLevel),
      dc: int(source.dc),
      ...(int(source.dealt) ? { dealt: int(source.dealt) as number } : {}),
      ...(Object.keys(struck).length ? { struck } : {}),
    });
    if (out.length >= MAX_ZONES) {
      break;
    }
  }
  return out;
}

// ---- geometry ----

export type ZoneMap = { terrain: string; width: number; height: number };

function unit(from: XY, to: XY): { ux: number; uy: number } {
  const distance = Math.max(1, chebyshev(from.x, from.y, to.x, to.y));
  return { ux: (to.x - from.x) / distance, uy: (to.y - from.y) / distance };
}

function straightRun(map: ZoneMap, from: XY, dir: { ux: number; uy: number }, start: number, length: number): number[] {
  const out: number[] = [];
  for (let k = start; k < start + length; k += 1) {
    const x = Math.round(from.x + dir.ux * k);
    const y = Math.round(from.y + dir.uy * k);
    if (!inBounds(map.width, map.height, x, y)) {
      break;
    }
    out.push(tileIndex(map.width, x, y));
  }
  return out;
}

// The squares perpendicular to a run, `side` (+1 or -1) of it, `depth` deep.
function besideRun(map: ZoneMap, cells: number[], dir: { ux: number; uy: number }, side: number, depth: number): number[] {
  const px = Math.round(-dir.uy) * side;
  const py = Math.round(dir.ux) * side;
  const out = new Set<number>();
  for (const cell of cells) {
    const x = cell % map.width;
    const y = Math.floor(cell / map.width);
    for (let d = 1; d <= depth; d += 1) {
      const nx = x + px * d;
      const ny = y + py * d;
      if (inBounds(map.width, map.height, nx, ny) && map.terrain[tileIndex(map.width, nx, ny)] !== TERRAIN.wall) {
        out.add(tileIndex(map.width, nx, ny));
      }
    }
  }
  return [...out];
}

export type ZoneLayout = { cells: number[]; hot?: number[]; toward?: XY };

// The squares a spell's area covers when laid at `origin`. `toward` aims a
// line or a wall (a wall is laid from `origin` toward it; with none it runs
// across the caster's view of the point), `caster` is where the caster
// stands (the burning side of a Wall of Fire faces away from them).
export function layZone(
  row: ZoneRow,
  input: { origin: XY; toward?: XY | null; caster?: XY | null; slotLevel?: number | null; lengthFeet?: number | null },
  map: ZoneMap,
): ZoneLayout {
  const tiles = (feet: number) => Math.max(1, Math.round(feet / 5));
  const above = Math.max(0, (input.slotLevel ?? row.level) - row.level);
  if (row.shape === "sphere" || row.shape === "aura") {
    const radius = row.feet + (row.perSlotFeet ?? 0) * above;
    return { cells: templateTiles(map, { shape: "sphere", origin: input.origin, target: input.origin, sizeFeet: radius }) };
  }
  if (row.shape === "cube") {
    const side = tiles(row.feet);
    const low = Math.floor(side / 2);
    const cells: number[] = [];
    for (let dy = -low; dy < side - low; dy += 1) {
      for (let dx = -low; dx < side - low; dx += 1) {
        const x = input.origin.x + dx;
        const y = input.origin.y + dy;
        if (inBounds(map.width, map.height, x, y) && map.terrain[tileIndex(map.width, x, y)] !== TERRAIN.wall) {
          cells.push(tileIndex(map.width, x, y));
        }
      }
    }
    return { cells };
  }
  const toward =
    input.toward && (input.toward.x !== input.origin.x || input.toward.y !== input.origin.y)
      ? input.toward
      : wallDefault(input.origin, input.caster ?? null);
  const dir = unit(input.origin, toward);
  if (row.shape === "line") {
    // From the caster: the first square is the one beside them.
    const main = straightRun(map, input.origin, dir, 1, tiles(row.feet)).filter(
      (cell) => map.terrain[cell] !== TERRAIN.wall,
    );
    const wide = Math.max(1, tiles(row.widthFeet ?? 5));
    const cells = new Set(main);
    if (wide > 1) {
      for (const cell of besideRun(map, main, dir, 1, wide - 1)) {
        cells.add(cell);
      }
    }
    return { cells: [...cells], toward };
  }
  const length = Math.min(tiles(row.feet), input.lengthFeet ? tiles(input.lengthFeet) : Infinity);
  // A passage is cut into the rock; a wall stands on open ground.
  const cells = straightRun(map, input.origin, dir, 0, length).filter((cell) => row.opens || map.terrain[cell] !== TERRAIN.wall);
  if (!row.hotSideFeet) {
    return { cells, toward };
  }
  // The side away from the caster burns; a caster on the wall's own line
  // turns the heat to the positive side.
  const caster = input.caster ?? input.origin;
  const px = Math.round(-dir.uy);
  const py = Math.round(dir.ux);
  const facing = (caster.x - input.origin.x) * px + (caster.y - input.origin.y) * py;
  const side = facing > 0 ? -1 : 1;
  return { cells, toward, hot: besideRun(map, cells, dir, side, tiles(row.hotSideFeet)) };
}

// A wall laid with no direction runs across the line from the caster to the
// point, so it stands between them and what lies beyond.
function wallDefault(origin: XY, caster: XY | null): XY {
  if (!caster || (caster.x === origin.x && caster.y === origin.y)) {
    return { x: origin.x, y: origin.y + 1 };
  }
  const dx = origin.x - caster.x;
  const dy = origin.y - caster.y;
  return Math.abs(dx) >= Math.abs(dy) ? { x: origin.x, y: origin.y + 1 } : { x: origin.x + 1, y: origin.y };
}

// An aura's squares follow its caster's token as it stands now.
export function withAnchors(zones: SpellZone[], tokens: Array<Pick<BattleToken, "refId" | "x" | "y">>, map: ZoneMap): SpellZone[] {
  return zones.map((zone) => {
    const row = zoneRowFor(zone.spell);
    if (row?.shape !== "aura") {
      return zone;
    }
    const anchor = tokens.find((token) => token.refId === zone.casterId);
    if (!anchor) {
      return { ...zone, cells: [] };
    }
    return { ...zone, origin: { x: anchor.x, y: anchor.y }, cells: layZone(row, { origin: anchor, slotLevel: zone.slotLevel }, map).cells };
  });
}

// ---- what the squares do ----

const rowOf = (zone: SpellZone) => zoneRowFor(zone.spell);

export function zonesAt(zones: SpellZone[], cell: number): SpellZone[] {
  return zones.filter((zone) => zone.cells.includes(cell));
}

// A creature on the other side from the caster: characters and the DM's
// bystanders against enemies.
export function hostileTo(zone: SpellZone, moverKind: string): boolean {
  const moverSide = moverKind === "enemy" ? "enemy" : "party";
  const casterSide = zone.casterKind === "enemy" ? "enemy" : "party";
  return moverSide !== casterSide;
}

// What a step onto `to` costs a mover, from `from` (-1 when the walk's
// first square is not known), given the step's cost on the ground itself:
// difficult ground from a spell is magical (Land's Stride does not cross
// it), Plant Growth and Wall of Thorns cost four feet a foot, Spirit
// Guardians halves a hostile creature's speed, and Gust of Wind charges
// double for a step toward its caster. Null when no spell area changes any
// step.
export function zoneStepCost(
  zones: SpellZone[],
  width: number,
  moverKind: string,
): ((from: number, to: number, cost: number) => number) | null {
  const moving = zones.filter((zone) => {
    const row = rowOf(zone);
    return Boolean(row && (row.difficult || row.halvesHostile || row.headwind));
  });
  if (!moving.length) {
    return null;
  }
  return (from, to, cost) => {
    let floor = cost;
    let factor = 1;
    for (const zone of moving) {
      if (!zone.cells.includes(to)) {
        continue;
      }
      const row = rowOf(zone) as ZoneRow;
      if (row.difficult) {
        floor = Math.max(floor, row.difficult);
      }
      if (row.halvesHostile && hostileTo(zone, moverKind)) {
        factor *= 2;
      }
      if (row.headwind && from >= 0) {
        const fromXY = { x: from % width, y: Math.floor(from / width) };
        const toXY = { x: to % width, y: Math.floor(to / width) };
        const before = chebyshev(fromXY.x, fromXY.y, zone.origin.x, zone.origin.y);
        const after = chebyshev(toXY.x, toXY.y, zone.origin.x, zone.origin.y);
        if (after < before) {
          factor *= 2;
        }
      }
    }
    return floor * factor;
  };
}

// The engine's terrain with every spell wall turned to rock, and every
// passage a Passwall cut turned to floor.
export function withZoneWalls(terrain: string, width: number, zones: SpellZone[]): string {
  const shaping = zones.filter((zone) => rowOf(zone)?.blocks || rowOf(zone)?.opens);
  if (!shaping.length) {
    return terrain;
  }
  const tiles = terrain.split("");
  for (const zone of shaping) {
    const opens = Boolean(rowOf(zone)?.opens);
    for (const cell of zone.cells) {
      if (cell < tiles.length) {
        tiles[cell] = opens ? (tiles[cell] === TERRAIN.wall ? TERRAIN.floor : tiles[cell]) : TERRAIN.wall;
      }
    }
  }
  return tiles.join("");
}

export type ZoneSenses = {
  blindsight?: number;
  truesight?: number;
  devilsSight?: number;
  tremorsense?: number;
};

// What stops a viewer's sight at a square: a heavily obscured area (Fog
// Cloud, Stinking Cloud), magical darkness (unless truesight or Devil's
// Sight reaches it), an opaque wall (Wall of Fire, Wall of Thorns).
function blinds(row: ZoneRow, distance: number, senses: ZoneSenses): boolean {
  if (distance <= (senses.blindsight ?? 0)) {
    return false;
  }
  if (row.darkness) {
    return distance > (senses.truesight ?? 0) && distance > (senses.devilsSight ?? 0);
  }
  return row.obscured === "heavy" || row.opaque === true;
}

// Every square of a straight line from one square to another, both ends
// included (Bresenham).
export function lineCells(width: number, from: XY, to: XY): number[] {
  const out = [tileIndex(width, from.x, from.y)];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const dy = -Math.abs(to.y - from.y);
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let error = dx + dy;
  while (x !== to.x || y !== to.y) {
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
    out.push(tileIndex(width, x, y));
  }
  return out;
}

// Whether a spell area keeps a viewer at `from` from seeing a creature at
// `to`: any square of the sight line, the viewer's own and the creature's
// included, that blinds this viewer. A creature inside a fog cloud sees
// nothing beyond it, and nothing outside sees in. Tremorsense feels a
// creature on the ground within its reach whatever the air holds.
export function zoneBlocksSight(
  zones: SpellZone[],
  width: number,
  from: XY,
  to: XY & { flying?: boolean },
  senses: ZoneSenses = {},
): boolean {
  const seeing = zones.filter((zone) => {
    const row = rowOf(zone);
    return Boolean(row && (row.obscured === "heavy" || row.darkness || row.opaque));
  });
  if (!seeing.length) {
    return false;
  }
  const distance = chebyshev(from.x, from.y, to.x, to.y);
  if (!to.flying && distance <= (senses.tremorsense ?? 0)) {
    return false;
  }
  const line = lineCells(width, from, to);
  return seeing.some((zone) => blinds(rowOf(zone) as ZoneRow, distance, senses) && line.some((cell) => zone.cells.includes(cell)));
}

// The squares that stop sight for the board's fog of war: heavy obscurement,
// opaque walls, and magical darkness for a viewer who cannot see into it. A
// wall of force is taken back out of the rock the map row made of it.
export function zoneSightTerrain(
  terrain: string,
  underlying: string,
  zones: SpellZone[],
  senses: ZoneSenses = {},
): string {
  if (!zones.length) {
    return terrain;
  }
  const tiles = terrain.split("");
  for (const zone of zones) {
    const row = rowOf(zone);
    if (!row) {
      continue;
    }
    if (row.blocks?.see) {
      for (const cell of zone.cells) {
        tiles[cell] = underlying[cell] ?? tiles[cell];
      }
      continue;
    }
    const darkSeen = row.darkness && ((senses.truesight ?? 0) > 0 || (senses.devilsSight ?? 0) > 0);
    if ((row.obscured === "heavy" && !darkSeen) || row.opaque) {
      for (const cell of zone.cells) {
        tiles[cell] = TERRAIN.wall;
      }
    }
  }
  return tiles.join("");
}

// Daylight's bright light and Darkness's magical dark, as the patches of
// light the vision code already reads (src/lib/battlemap/scene.ts): the
// area's bounding square, in the order the spells were cast.
export function zoneLights(zones: SpellZone[], width: number): LightZone[] {
  const out: LightZone[] = [];
  for (const zone of zones) {
    const row = rowOf(zone);
    if (!row || (!row.light && !row.darkness) || !zone.cells.length) {
      continue;
    }
    const xs = zone.cells.map((cell) => cell % width);
    const ys = zone.cells.map((cell) => Math.floor(cell / width));
    out.push({
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys),
      ambient: row.light ? "bright" : "dark",
      kind: row.light ? "light" : "magical_darkness",
    });
  }
  return out;
}

// Whether a square is inside Silence.
export function silentAt(zones: SpellZone[], cell: number): SpellZone | null {
  return zones.find((zone) => rowOf(zone)?.silence && zone.cells.includes(cell)) ?? null;
}

// The squares strictly between two, where something standing gives cover
// or turns an arrow.
function between(width: number, from: XY, to: XY): number[] {
  return lineCells(width, from, to).slice(1, -1);
}

// Blade Barrier's three-quarters cover to a creature behind it.
export function zoneCover(zones: SpellZone[], width: number, from: XY, to: XY): 0 | 5 {
  const line = between(width, from, to);
  return zones.some((zone) => rowOf(zone)?.cover && line.some((cell) => zone.cells.includes(cell))) ? 5 : 0;
}

// Wind Wall between a shooter and the target: the missile misses.
export function missileDeflectedBy(zones: SpellZone[], width: number, from: XY, to: XY): SpellZone | null {
  const line = between(width, from, to);
  return zones.find((zone) => rowOf(zone)?.deflectsMissiles && line.some((cell) => zone.cells.includes(cell))) ?? null;
}
