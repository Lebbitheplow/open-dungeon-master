// Where a strike that comes from something a spell made is made from (issue
// 659): Spiritual Weapon's floating weapon "within range", striking "a
// creature within 5 feet of the weapon", and moved "up to 20 feet" by the
// bonus action that repeats the attack (SRD 5.1). The reach was measured
// from the cleric's own token, so a weapon twenty feet off could not strike
// and the GM walked the cleric up to the foe instead.
//
// Pure: the board, the squares and the distances come in, the square the
// strike is made from (and how far the weapon moved to it) comes out. The
// thin module beside it (conjured-strike.ts) reads the live board and moves
// the weapon's square once nothing can refuse the attack.

import { footprintDistance, footprintTiles, type Footprint } from "@/lib/battlemap/footprint";
import { hasLineOfSight } from "@/lib/battlemap/los";
import { chebyshev, inBounds, tileIndex, TERRAIN, type XY } from "@/lib/battlemap/types";

export type StrikeBoard = { terrain: string; width: number; height: number };

// How the weapon may get to a square it strikes from this time:
// - "place": it is being set down (the casting turn with no square named, or
//   a weapon the board never held): anywhere within `rangeTiles` of the
//   caster with a clear path from them.
// - "fixed": it stands where the caster named it this turn; it strikes from
//   there or not at all.
// - "move": a later turn; it flies up to `moveTiles` from where it floats.
export type StrikeMode = "place" | "fixed" | "move";

export type StrikeSpotInput = {
  board: StrikeBoard;
  mode: StrikeMode;
  // Tiles of reach from the weapon (5 feet: 1).
  reachTiles: number;
  moveTiles: number;
  rangeTiles: number;
  caster: XY;
  // Where the weapon floats now, when the board holds it.
  origin: XY | null;
  target: { at: XY; footprint: Footprint };
  // Squares a creature stands on: the weapon may float there, but an empty
  // square is preferred, so the marker shows on the board.
  occupied: Set<number>;
};

export type StrikeSpot =
  | { at: XY; movedTiles: number }
  // Out of reach: of the range a new weapon appears in, of the move a
  // floating one makes, or of the square it was named onto. `apartTiles` is
  // how far the target is from the caster ("range") or from the weapon.
  | { out: "range" | "move" | "fixed"; apartTiles: number };

const open = (board: StrikeBoard, at: XY) =>
  inBounds(board.width, board.height, at.x, at.y) && board.terrain[tileIndex(board.width, at.x, at.y)] !== TERRAIN.wall;

// Whether a strike from `at` reaches the target: within reach of its nearest
// square, never inside its space, and with nothing solid between them when
// the reach is longer than the square beside it.
function strikesFrom(input: StrikeSpotInput, at: XY): boolean {
  const { board, target } = input;
  if (!open(board, at)) {
    return false;
  }
  if (footprintTiles(target.at, target.footprint).some((tile) => tile.x === at.x && tile.y === at.y)) {
    return false;
  }
  const apart = footprintDistance(at, 1, target.at, target.footprint);
  if (apart > input.reachTiles) {
    return false;
  }
  return apart <= 1 || hasLineOfSight(board.terrain, board.width, at.x, at.y, target.at.x, target.at.y);
}

// Every square the weapon can fly to within `budget` tiles of `from`: walls
// stop it, creatures do not (it is no creature, and floats over them).
function flight(board: StrikeBoard, from: XY, budget: number): Map<number, number> {
  const best = new Map<number, number>([[tileIndex(board.width, from.x, from.y), 0]]);
  let frontier: XY[] = [from];
  for (let step = 1; step <= budget && frontier.length; step += 1) {
    const next: XY[] = [];
    for (const at of frontier) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const to = { x: at.x + dx, y: at.y + dy };
          const index = tileIndex(board.width, to.x, to.y);
          if ((dx || dy) && open(board, to) && !best.has(index)) {
            best.set(index, step);
            next.push(to);
          }
        }
      }
    }
    frontier = next;
  }
  return best;
}

export function conjuredStrikeSpot(input: StrikeSpotInput): StrikeSpot {
  const { board, mode, caster, origin, target } = input;
  const xy = (index: number): XY => ({ x: index % board.width, y: Math.floor(index / board.width) });
  if (mode === "fixed" && origin) {
    return strikesFrom(input, origin)
      ? { at: origin, movedTiles: 0 }
      : { out: "fixed", apartTiles: footprintDistance(origin, 1, target.at, target.footprint) };
  }
  // The squares the weapon can be at for this strike, with what it costs to
  // get there.
  const candidates: Array<{ at: XY; cost: number }> = [];
  if (mode === "move" && origin) {
    for (const [index, cost] of flight(board, origin, input.moveTiles)) {
      candidates.push({ at: xy(index), cost });
    }
  } else {
    for (let y = 0; y < board.height; y += 1) {
      for (let x = 0; x < board.width; x += 1) {
        const at = { x, y };
        if (chebyshev(caster.x, caster.y, x, y) <= input.rangeTiles && hasLineOfSight(board.terrain, board.width, caster.x, caster.y, x, y)) {
          candidates.push({ at, cost: origin ? chebyshev(origin.x, origin.y, x, y) : 0 });
        }
      }
    }
  }
  const fits = candidates.filter((entry) => strikesFrom(input, entry.at));
  if (!fits.length) {
    return mode === "move" && origin
      ? { out: "move", apartTiles: footprintDistance(origin, 1, target.at, target.footprint) }
      : { out: "range", apartTiles: footprintDistance(caster, 1, target.at, target.footprint) };
  }
  // Where it already floats, then the least movement, then an empty square
  // (so the board shows it), then the one nearest the caster.
  const empty = (at: XY) => (input.occupied.has(tileIndex(board.width, at.x, at.y)) ? 1 : 0);
  fits.sort(
    (a, b) =>
      a.cost - b.cost ||
      empty(a.at) - empty(b.at) ||
      chebyshev(caster.x, caster.y, a.at.x, a.at.y) - chebyshev(caster.x, caster.y, b.at.x, b.at.y) ||
      a.at.y - b.at.y ||
      a.at.x - b.at.x,
  );
  const pick = fits[0];
  return { at: pick.at, movedTiles: mode === "move" ? pick.cost : 0 };
}
