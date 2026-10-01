// Jumping (SRD 5.1, Movement: Jumping). Pure.
//   - Long jump: up to the Strength score in feet after moving at least 10
//     feet on foot immediately before it; half that from a standing start.
//     Each foot jumped costs a foot of movement. Clearing a low obstacle
//     takes a jump at least four times its height. Landing in difficult
//     terrain takes a DC 10 Dexterity (Acrobatics) check or the jumper lands
//     prone.
//   - High jump: 3 + the Strength modifier in feet after the same run (half
//     standing), at least 0.
// On the board a long jump is a straight line of squares: the ones under it
// are flown over (their ground costs nothing extra), walls stop it, and a
// low wall or chasm edge ("|") is taken as a 3-foot obstacle, cleared by a
// jump of 15 feet or more.

import { TERRAIN, chebyshev, tileAt, tileIndex, type XY } from "@/lib/battlemap/types";

const TILE_FEET = 5;
const LOW_WALL_FEET = 3;
// The run a jump needs, in squares moved this turn (10 feet).
export const RUN_UP_TILES = 2;

export function longJumpFeet(strength: number, runningStart: boolean): number {
  const feet = Math.max(0, Math.floor(strength));
  return runningStart ? feet : Math.floor(feet / 2);
}

export function highJumpFeet(strength: number, runningStart: boolean): number {
  const feet = Math.max(0, 3 + Math.floor((Math.floor(strength) - 10) / 2));
  return runningStart ? feet : Math.floor(feet / 2);
}

// The squares a straight jump passes over, then the landing square.
export function jumpLine(from: XY, to: XY): XY[] {
  const steps = chebyshev(from.x, from.y, to.x, to.y);
  const line: XY[] = [];
  for (let step = 1; step <= steps; step += 1) {
    line.push({
      x: Math.round(from.x + ((to.x - from.x) * step) / steps),
      y: Math.round(from.y + ((to.y - from.y) * step) / steps),
    });
  }
  return line;
}

export type JumpPlan =
  | { ok: true; cost: number; path: XY[]; feet: number; landsInDifficult: boolean }
  | { ok: false; error: string };

// A long jump across the board: checked against the jumper's Strength, the
// run-up, the movement left, and what lies under and at the end of it.
export function planLongJump(input: {
  terrain: string;
  width: number;
  height: number;
  // Squares held by other creatures (the jumper's own excluded).
  occupied: Set<number>;
  from: XY;
  to: XY;
  strength: number;
  runningStart: boolean;
  budgetTiles: number;
  name: string;
}): JumpPlan {
  const { terrain, width, height, occupied, from, to, name } = input;
  if (to.x < 0 || to.y < 0 || to.x >= width || to.y >= height) {
    return { ok: false, error: "Invalid destination." };
  }
  const tiles = chebyshev(from.x, from.y, to.x, to.y);
  const feet = tiles * TILE_FEET;
  const reach = longJumpFeet(input.strength, input.runningStart);
  if (tiles < 1) {
    return { ok: false, error: "A jump has to go somewhere." };
  }
  if (feet > reach) {
    return {
      ok: false,
      error: `${name} can long jump ${reach} feet ${input.runningStart ? "with a running start" : "from a standing start (a 10-foot run first doubles it)"}, not ${feet}. The DM may call for a Strength (Athletics) check to jump farther.`,
    };
  }
  if (tiles > input.budgetTiles) {
    return { ok: false, error: `Each foot of a jump costs a foot of movement: ${feet} feet is more than ${name} has left this round.` };
  }
  const path = jumpLine(from, to);
  for (const square of path.slice(0, -1)) {
    const ground = tileAt(terrain, width, square.x, square.y);
    if (ground === TERRAIN.wall) {
      return { ok: false, error: `A wall stands in the way at (${square.x},${square.y}); nobody jumps through it.` };
    }
    if (ground === TERRAIN.lowwall && feet < LOW_WALL_FEET * 4) {
      return { ok: false, error: `Clearing the low wall at (${square.x},${square.y}) takes a jump of at least ${LOW_WALL_FEET * 4} feet.` };
    }
    if (occupied.has(tileIndex(width, square.x, square.y))) {
      return { ok: false, error: `Someone stands at (${square.x},${square.y}), in the way of the jump.` };
    }
  }
  const landing = tileAt(terrain, width, to.x, to.y);
  if (landing === TERRAIN.wall || landing === TERRAIN.lowwall || occupied.has(tileIndex(width, to.x, to.y))) {
    return { ok: false, error: `Nobody can land at (${to.x},${to.y}).` };
  }
  return { ok: true, cost: tiles, path, feet, landsInDifficult: landing === TERRAIN.difficult };
}
