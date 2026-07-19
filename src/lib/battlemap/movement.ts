import {
  blocksMove,
  moveCost,
  tileAt,
  tileIndex,
  type XY,
} from "@/lib/battlemap/types";

// Grid movement: uniform-cost search (Dijkstra) with difficult terrain
// costing double. v1 rule: no moving THROUGH any token, friend or foe
// (stricter than 5e but simple and server-enforceable); occupied tiles are
// also invalid destinations.

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
): Map<number, number> {
  const startIdx = tileIndex(width, from.x, from.y);
  const best = new Map<number, number>([[startIdx, 0]]);
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
      const ch = tileAt(terrain, width, nx, ny);
      const idx = tileIndex(width, nx, ny);
      if (blocksMove(ch) || occupied.has(idx)) {
        continue;
      }
      const cost = current.cost + moveCost(ch);
      if (cost > budget || cost >= (best.get(idx) ?? Infinity)) {
        continue;
      }
      best.set(idx, cost);
      frontier.push({ x: nx, y: ny, cost });
    }
  }
  best.delete(startIdx);
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
      const ch = tileAt(terrain, width, nx, ny);
      const idx = tileIndex(width, nx, ny);
      if (blocksMove(ch) || (occupied.has(idx) && idx !== goalIdx)) {
        continue;
      }
      const cost = current.cost + moveCost(ch);
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
): { at: XY | null; spent: number; reachedEnd: boolean } {
  let spent = 0;
  let at: XY | null = null;
  for (const step of path) {
    const cost = moveCost(tileAt(terrain, width, step.x, step.y));
    if (spent + cost > budget) {
      return { at, spent, reachedEnd: false };
    }
    spent += cost;
    at = step;
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
