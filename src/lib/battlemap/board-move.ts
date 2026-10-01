// A move on the battle map, as the board shows it: the drag ruler's route and
// cost before the move, and what the move route reported after it (the
// opportunity attacks it drew, the spell areas it walked into).
//
// The ruler used to price a route itself, from the terrain alone, so a walk
// through Entangle, Plant Growth or Spirit Guardians read cheaper than the
// server would charge. The server now sends the cost of every square it
// lights (src/lib/battlemap/view.ts reachableCost, the same reachableTiles
// the move route asks), and the ruler reads that: what it promises is what
// the route charges. Pure, tested by scripts/test-enforce-zones-ui.mjs.
import { findPath } from "@/lib/battlemap/movement";
import { chebyshev, moveCost, tileAt, tileIndex, TILE_FEET, type XY } from "@/lib/battlemap/types";
import { jumpLine } from "@/lib/srd/jump";

export type Ruler = { path: XY[]; label: string; overBudget: boolean };

export type RulerView = {
  terrain: string;
  width: number;
  height: number;
  tokens: Array<{ id: string; x: number; y: number }>;
  reachable: number[];
  // The server's cost in squares of each reachable square, in the same
  // order; absent from an older server.
  reachableCost?: number[];
  budgetLeft: number;
};

const STEPS: Array<[number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

// A route the server's costs agree with: from the square back to the start,
// each step to the cheapest neighbour that costs less. Null when the costs do
// not lead back (a route through an ally's space, which is never lit).
function descend(costs: Map<number, number>, width: number, height: number, from: XY, to: XY): XY[] | null {
  const start = tileIndex(width, from.x, from.y);
  const path: XY[] = [to];
  let here = to;
  let cost = costs.get(tileIndex(width, to.x, to.y)) ?? 0;
  for (let guard = 0; guard < width * height; guard += 1) {
    let best: { at: XY; cost: number } | null = null;
    for (const [dx, dy] of STEPS) {
      const x = here.x + dx;
      const y = here.y + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const idx = tileIndex(width, x, y);
      const known = idx === start ? 0 : costs.get(idx);
      if (known === undefined || known >= cost) continue;
      // Straight steps first on a tie, so the line reads the way a walk does.
      if (!best || known < best.cost) best = { at: { x, y }, cost: known };
    }
    if (!best) return null;
    here = best.at;
    cost = best.cost;
    path.unshift(here);
    if (tileIndex(width, here.x, here.y) === start) return path;
  }
  return null;
}

// The ruler from a token to the square under the pointer. `spends` is true
// for a player measuring their own walk (the DM moves pieces for free);
// `factor` is 2 while dragging a grappled creature that costs double
// (PlayerMapView.moves.drag), as the move route charges it.
export function rulerFor(view: RulerView, fromId: string, hover: XY, spends: boolean, factor: 1 | 2 = 1): Ruler | null {
  const from = view.tokens.find((token) => token.id === fromId);
  if (!from || (from.x === hover.x && from.y === hover.y)) return null;
  const occupied = new Set(
    view.tokens.filter((token) => token.id !== from.id).map((token) => token.y * view.width + token.x),
  );
  const drawn = () => findPath(view.terrain, view.width, view.height, occupied, from, hover);
  const costs = spends && view.reachableCost && view.reachableCost.length === view.reachable.length
    ? new Map(view.reachable.map((cell, index) => [cell, view.reachableCost![index]]))
    : null;
  if (costs) {
    const cost = costs.get(tileIndex(view.width, hover.x, hover.y));
    if (cost !== undefined) {
      const path = descend(costs, view.width, view.height, from, hover) ?? (() => {
        const walked = drawn();
        return walked ? [{ x: from.x, y: from.y }, ...walked] : [{ x: from.x, y: from.y }, hover];
      })();
      const spend = cost * factor;
      return { path, label: `${spend * TILE_FEET} ft${factor > 1 ? " dragging" : ""}`, overBudget: spend > view.budgetLeft };
    }
    // Not lit: out of this round's reach, by the server's count. The line
    // still shows the way; the terrain's price is a floor, so a square the
    // terrain alone would allow says it is out of reach instead of a number
    // the server would not honour.
    const walked = drawn();
    if (!walked?.length) return null;
    const floor = walked.reduce((total, step) => total + moveCost(tileAt(view.terrain, view.width, step.x, step.y)), 0);
    return {
      path: [{ x: from.x, y: from.y }, ...walked],
      label: floor > view.budgetLeft ? `${floor * TILE_FEET} ft` : "out of reach",
      overBudget: true,
    };
  }
  const walked = drawn();
  if (!walked?.length) return null;
  const cost = walked.reduce((total, step) => total + moveCost(tileAt(view.terrain, view.width, step.x, step.y)), 0);
  return {
    path: [{ x: from.x, y: from.y }, ...walked],
    label: `${cost * TILE_FEET} ft`,
    overBudget: spends && cost > view.budgetLeft,
  };
}

// What the move route charges a prone character for a square the walk alone
// costs `step` squares: standing up (half its speed, or a feature's price)
// and then walking, or else crawling at double cost, whichever fits the
// movement in hand (SRD 5.1, Being Prone). Null when neither does. The move
// route and the board's lit squares both ask this, so they cannot differ.
export function proneCharge(step: number, standCost: number, fullTiles: number): { cost: number; stands: boolean } | null {
  if (step + standCost <= fullTiles) return { cost: step + standCost, stands: true };
  if (step * 2 <= fullTiles) return { cost: step * 2, stands: false };
  return null;
}

// The squares a drag can reach: every lit square whose walk, doubled while
// dragging (PlayerMapView.moves.drag.factor), still fits the movement left,
// as the move route refuses the rest. The board lights only these.
export function dragReach<T extends RulerView>(view: T, factor: 1 | 2): T {
  if (factor === 1 || !view.reachableCost || view.reachableCost.length !== view.reachable.length) return view;
  const costs = view.reachableCost;
  const kept = view.reachable.map((cell, index) => ({ cell, cost: costs[index] })).filter((entry) => entry.cost * factor <= view.budgetLeft);
  return { ...view, reachable: kept.map((entry) => entry.cell), reachableCost: kept.map((entry) => entry.cost) };
}

// A long jump's line to the square under the pointer: the squares flown
// over, its length, and whether it is past the jumper's reach this turn or
// the movement left (each foot jumped costs a foot of movement). The move
// route plans the jump itself and refuses in its own words; this only draws.
export function jumpRulerFor(view: RulerView, fromId: string, hover: XY, jumpFeet: number): Ruler | null {
  const from = view.tokens.find((token) => token.id === fromId);
  if (!from || (from.x === hover.x && from.y === hover.y)) return null;
  const feet = chebyshev(from.x, from.y, hover.x, hover.y) * TILE_FEET;
  return {
    path: [{ x: from.x, y: from.y }, ...jumpLine(from, hover)],
    label: `${feet} ft jump`,
    overBudget: feet > jumpFeet || feet > view.budgetLeft * TILE_FEET,
  };
}

export type MoveNote = { text: string; tone: "struck" | "ground" | "move" };

// What the move route said happened on the way: an enemy's opportunity
// attack, a spell area's spikes or hold. The engine's own lines, unchanged.
export function moveNotesFrom(body: unknown): MoveNote[] {
  const source = (body ?? {}) as { opportunityAttacks?: unknown; zoneEffects?: unknown; jump?: unknown };
  const jump = (source.jump ?? null) as { feet?: unknown; landed?: unknown; highJumpFeet?: unknown } | null;
  const high = jump && typeof jump.highJumpFeet === "number" ? ` A high jump reaches ${jump.highJumpFeet} feet.` : "";
  const leapt =
    jump && typeof jump.feet === "number"
      ? [{ text: `Jumped ${jump.feet} feet and landed ${typeof jump.landed === "string" ? jump.landed : "on their feet"}.${high}`, tone: "move" as const }]
      : [];
  const lines = (raw: unknown) =>
    Array.isArray(raw) ? raw.filter((line): line is string => typeof line === "string" && line.trim() !== "") : [];
  return [
    ...leapt,
    ...lines(source.opportunityAttacks).map((text) => ({ text, tone: "struck" as const })),
    ...lines(source.zoneEffects).map((text) => ({ text, tone: "ground" as const })),
  ];
}
