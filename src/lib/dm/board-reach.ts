// Distance on the live board between creatures of any size (issue #186): an
// ogre fills four squares, and a character against any of them is within 5
// feet of it, not 10 feet from its top-left anchor. An enemy's size is read
// from its stat block; a character, a companion and an NPC take one square,
// as the movement occupancy already has it (src/lib/battlemap/view.ts
// footprintLookup). The geometry itself is pure and lives in
// src/lib/battlemap/footprint.ts. Must not import encounter-tools, map-tools
// or attack-spatial: they call in here.

import { getEnemy } from "@/lib/db/encounters";
import type { BattleToken, XY } from "@/lib/battlemap/types";
import {
  footprintDistance,
  footprintForSize,
  nearestFootprintTile,
  type Footprint,
} from "@/lib/battlemap/footprint";

// A square with the size of what stands on it.
export type Spot = XY & { footprint?: Footprint };

export function tokenFootprint(token: Pick<BattleToken, "kind" | "refId">): Footprint {
  return token.kind === "enemy" ? footprintForSize(getEnemy(token.refId)?.stats.size) : 1;
}

export function spotOf(token: BattleToken): Spot {
  return { x: token.x, y: token.y, footprint: tokenFootprint(token) };
}

// Squares between two tokens, nearest square to nearest square.
export function tilesApart(a: BattleToken, b: BattleToken): number {
  return footprintDistance(a, tokenFootprint(a), b, tokenFootprint(b));
}

// The two squares a line between two tokens is drawn through: the target's
// square nearest the attacker, and the attacker's square nearest that one.
// Sight and cover are read along it, so a wall beside an ogre's far corner
// does not shelter the corner the attacker stands against.
export function nearestSquares(a: BattleToken, b: BattleToken): { from: XY; to: XY } {
  const to = nearestFootprintTile(b, tokenFootprint(b), a);
  const from = nearestFootprintTile(a, tokenFootprint(a), to);
  return { from, to };
}
