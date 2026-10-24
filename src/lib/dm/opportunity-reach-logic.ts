// Where a walk crosses the edge of a reach, square by square (opportunity
// attacks, Polearm Master). Pure: opportunity.ts and opportunity-sides.ts
// both read it, and it imports nothing of theirs.

import { footprintDistance, type Footprint } from "@/lib/battlemap/footprint";

type XY = { x: number; y: number };

// The square a walk enters a reactor's reach at, or null when it never
// does: Polearm Master's opportunity attack on a creature coming in. Reach
// is measured between the nearest squares of the two, so an ogre's reach
// starts at its edge and a walking ogre leaves a reach when its last square
// does (src/lib/battlemap/footprint.ts).
export function entersReachAt(
  steps: XY[],
  reactor: XY,
  reach: number,
  reactorFootprint: Footprint = 1,
  moverFootprint: Footprint = 1,
): XY | null {
  const apart = (step: XY) => footprintDistance(reactor, reactorFootprint, step, moverFootprint);
  for (let index = 0; index + 1 < steps.length; index += 1) {
    const here = steps[index];
    const next = steps[index + 1];
    if (apart(here) > reach && apart(next) <= reach) {
      return next;
    }
  }
  return null;
}

// The square a walker stood on when they left this reach, or null when the
// walk never leaves it. `steps` is every square of the walk in order, the
// starting one first.
export function leavesReachAt(
  steps: XY[],
  reactor: XY,
  reach: number,
  reactorFootprint: Footprint = 1,
  moverFootprint: Footprint = 1,
): XY | null {
  const apart = (step: XY) => footprintDistance(reactor, reactorFootprint, step, moverFootprint);
  for (let index = 0; index + 1 < steps.length; index += 1) {
    const here = steps[index];
    const next = steps[index + 1];
    if (apart(here) <= reach && apart(next) > reach) {
      return here;
    }
  }
  return null;
}
