import { footprintTiles, type Footprint } from "@/lib/battlemap/footprint";
import {
  blocksMoveFor,
  moveCost,
  passableOf,
  tileAt,
  tileIndex,
  type MoveTraits,
  type XY,
} from "@/lib/battlemap/types";

// Whether a creature of this footprint may stand with its anchor at (x, y):
// every square it covers must be inside the map, walkable, and not held by
// someone else. `goalIdx` lets findPath treat the destination's own tile as
// free (the caller vouches for it) while still refusing walls.
function standable(
  terrain: string,
  width: number,
  height: number,
  occupied: Set<number>,
  x: number,
  y: number,
  footprint: Footprint,
  allowIdx: number | null,
  flying: boolean,
  passable: Set<number> | null = null,
): boolean {
  for (const tile of footprintTiles({ x, y }, footprint)) {
    if (tile.x < 0 || tile.y < 0 || tile.x >= width || tile.y >= height) {
      return false;
    }
    if (blocksMoveFor(tileAt(terrain, width, tile.x, tile.y), flying)) {
      return false;
    }
    const idx = tileIndex(width, tile.x, tile.y);
    if (occupied.has(idx) && idx !== allowIdx && !passable?.has(idx)) {
      return false;
    }
  }
  return true;
}

// How a step onto (nx, ny) goes for a mover of this footprint: its cost, and
// whether the mover may stop there. Null when it cannot step there at all.
// Another creature's space it may pass through is difficult terrain (SRD
// 5.1), and so is squeezing a large creature through a gap one size smaller.
function stepOnto(
  terrain: string,
  width: number,
  height: number,
  occupied: Set<number>,
  nx: number,
  ny: number,
  footprint: Footprint,
  goalIdx: number | null,
  flying: boolean,
  traits: MoveTraits,
  fromIdx = -1,
): { cost: number; stop: boolean } | null {
  const passable = passableOf(traits);
  const squeeze = typeof traits === "object" && traits.squeeze === true;
  const idx = tileIndex(width, nx, ny);
  const ch = tileAt(terrain, width, nx, ny);
  const base = zoneStepOf(traits)(fromIdx, idx, moveCost(ch, traits));
  if (footprint === 1) {
    if (blocksMoveFor(ch, flying)) {
      return null;
    }
    if (occupied.has(idx) && idx !== goalIdx) {
      return passable?.has(idx) ? { cost: Math.max(base, 2), stop: false } : null;
    }
    return { cost: base, stop: true };
  }
  if (standable(terrain, width, height, occupied, nx, ny, footprint, goalIdx, flying)) {
    return { cost: base, stop: true };
  }
  if (standable(terrain, width, height, occupied, nx, ny, footprint, goalIdx, flying, passable)) {
    return { cost: Math.max(base, 2), stop: false };
  }
  // One size smaller fits: squeezing through (SRD 5.1, Squeezing into a
  // Smaller Space), at double cost. Ending there leaves it squeezed.
  const smaller = (footprint - 1) as Footprint;
  if (squeeze && standable(terrain, width, height, occupied, nx, ny, smaller, goalIdx, flying, passable)) {
    return { cost: Math.max(base, 2), stop: true };
  }
  return null;
}

// Whether a creature of this footprint stands squeezed at (x, y): its whole
// space does not fit there, one size smaller does.
export function squeezedAt(
  terrain: string,
  width: number,
  height: number,
  occupied: Set<number>,
  at: XY,
  footprint: Footprint,
): boolean {
  if (footprint <= 1) {
    return false;
  }
  return (
    !standable(terrain, width, height, occupied, at.x, at.y, footprint, null, false) &&
    standable(terrain, width, height, occupied, at.x, at.y, (footprint - 1) as Footprint, null, false)
  );
}

// A spell area's say on a step, or the step's own cost.
function zoneStepOf(traits: MoveTraits): (from: number, to: number, cost: number) => number {
  return typeof traits === "object" && traits.zoneStep ? traits.zoneStep : (_from, _to, cost) => cost;
}

// Grid movement: uniform-cost search (Dijkstra) with difficult terrain
// costing double. Occupied tiles are never destinations; the ones the
// caller marks passable (MoveTraits.passable: an ally's space, a hostile's
// two sizes apart) may be walked through at double cost, and nothing else.
// A caller that passes none keeps the old rule: no moving through a token.

const STEPS: Array<[number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

// Cheapest cost to every tile reachable within `budget`, excluding the
// start tile. Keys are tile indexes, values are costs.
export function reachableTiles(
  terrain: string,
  width: number,
  height: number,
  occupied: Set<number>,
  from: XY,
  budget: number,
  footprint: Footprint = 1,
  flying = false,
  // A swimmer crosses water at its normal cost (and Land's Stride crosses
  // difficult terrain at it): see moveCost.
  swims: MoveTraits = false,
): Map<number, number> {
  const startIdx = tileIndex(width, from.x, from.y);
  const best = new Map<number, number>([[startIdx, 0]]);
  // Squares passed through but not stopped on (another creature's space).
  const passOnly = new Set<number>();
  // Grid is tiny (<= 24x18); an array scan beats a heap here.
  const frontier: Array<{ x: number; y: number; cost: number }> = [{ ...from, cost: 0 }];
  while (frontier.length) {
    let bestAt = 0;
    for (let i = 1; i < frontier.length; i += 1) {
      if (frontier[i].cost < frontier[bestAt].cost) {
        bestAt = i;
      }
    }
    const current = frontier.splice(bestAt, 1)[0];
    const currentIdx = tileIndex(width, current.x, current.y);
    if (current.cost > (best.get(currentIdx) ?? Infinity)) {
      continue;
    }
    for (const [dx, dy] of STEPS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      const idx = tileIndex(width, nx, ny);
      const step = stepOnto(terrain, width, height, occupied, nx, ny, footprint, null, flying, swims, currentIdx);
      if (!step) {
        continue;
      }
      const cost = current.cost + step.cost;
      if (cost > budget || cost >= (best.get(idx) ?? Infinity)) {
        continue;
      }
      best.set(idx, cost);
      if (step.stop) {
        passOnly.delete(idx);
      } else {
        passOnly.add(idx);
      }
      frontier.push({ x: nx, y: ny, cost });
    }
  }
  best.delete(startIdx);
  // A creature's space is walked through, never ended in.
  for (const idx of passOnly) {
    best.delete(idx);
  }
  return best;
}

// Cheapest path from -> to as a list of tiles (excluding the start),
// ignoring any budget. Null when unreachable. `occupied` should exclude
// both mover and target tiles as the caller intends.
export function findPath(
  terrain: string,
  width: number,
  height: number,
  occupied: Set<number>,
  from: XY,
  to: XY,
  footprint: Footprint = 1,
  flying = false,
  swims: MoveTraits = false,
): XY[] | null {
  const startIdx = tileIndex(width, from.x, from.y);
  const goalIdx = tileIndex(width, to.x, to.y);
  const best = new Map<number, number>([[startIdx, 0]]);
  const cameFrom = new Map<number, number>();
  const frontier: Array<{ x: number; y: number; cost: number }> = [{ ...from, cost: 0 }];
  while (frontier.length) {
    let bestAt = 0;
    for (let i = 1; i < frontier.length; i += 1) {
      if (frontier[i].cost < frontier[bestAt].cost) {
        bestAt = i;
      }
    }
    const current = frontier.splice(bestAt, 1)[0];
    const currentIdx = tileIndex(width, current.x, current.y);
    if (currentIdx === goalIdx) {
      break;
    }
    if (current.cost > (best.get(currentIdx) ?? Infinity)) {
      continue;
    }
    for (const [dx, dy] of STEPS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      const idx = tileIndex(width, nx, ny);
      const step = stepOnto(terrain, width, height, occupied, nx, ny, footprint, goalIdx, flying, swims, currentIdx);
      // The goal must be somewhere the mover may stop.
      if (!step || (idx === goalIdx && !step.stop)) {
        continue;
      }
      const cost = current.cost + step.cost;
      if (cost >= (best.get(idx) ?? Infinity)) {
        continue;
      }
      best.set(idx, cost);
      cameFrom.set(idx, currentIdx);
      frontier.push({ x: nx, y: ny, cost });
    }
  }
  if (!best.has(goalIdx)) {
    return null;
  }
  const path: XY[] = [];
  let cursor = goalIdx;
  while (cursor !== startIdx) {
    path.unshift({ x: cursor % width, y: Math.floor(cursor / width) });
    cursor = cameFrom.get(cursor) as number;
  }
  return path;
}

// Walk a path spending budget; returns the last affordable tile (or null
// when even the first step is too expensive) plus the cost spent.
export function walkPathWithBudget(
  terrain: string,
  width: number,
  path: XY[],
  budget: number,
  swims: MoveTraits = false,
  // Where the walk starts, for a spell area that minds the direction of a
  // step (Gust of Wind).
  from?: XY,
): { at: XY | null; spent: number; reachedEnd: boolean } {
  let spent = 0;
  let at: XY | null = null;
  const passable = passableOf(swims);
  const zoneStep = zoneStepOf(swims);
  let previous = from ? tileIndex(width, from.x, from.y) : -1;
  for (const step of path) {
    const here = tileIndex(width, step.x, step.y);
    const through = passable?.has(here) ?? false;
    const base = zoneStep(previous, here, moveCost(tileAt(terrain, width, step.x, step.y), swims));
    previous = here;
    const cost = through ? Math.max(base, 2) : base;
    if (spent + cost > budget) {
      return { at, spent, reachedEnd: false };
    }
    spent += cost;
    // A creature's space is passed through, never stopped in.
    if (!through) {
      at = step;
    }
  }
  return { at, spent, reachedEnd: true };
}

// Tiles per round from a speed in feet; "30 ft." / "30" both parse.
export function speedToTiles(speed: string | number | undefined, fallbackFeet = 30): number {
  if (typeof speed === "number" && Number.isFinite(speed)) {
    return Math.max(1, Math.floor(speed / 5));
  }
  const match = /(\d+)/.exec(String(speed ?? ""));
  const feet = match ? Number(match[1]) : fallbackFeet;
  return Math.max(1, Math.floor(feet / 5));
}
