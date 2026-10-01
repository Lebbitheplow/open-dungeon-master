// Whose space a mover may pass through (SRD 5.1, Moving Around Other
// Creatures): "You can move through a nonhostile creature's space. In
// contrast, you can move through a hostile creature's space only if the
// creature is at least two sizes larger or smaller than you." Halfling
// Nimbleness adds any creature of a size larger than the halfling's. Either
// way the space is difficult terrain, and no mover ends its move in it
// (src/lib/battlemap/movement.ts reads the set this returns).
//
// Pure: the caller hands in the tokens, their footprints and their sizes.

import { footprintIndexes, type Footprint } from "@/lib/battlemap/footprint";
import { moveTraitsFrom, tileIndex, type BattleToken, type MoveTraits } from "@/lib/battlemap/types";
import { sizeForRace } from "@/lib/srd";

const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"];

export function sizeIndex(size: string | undefined): number {
  const at = SIZES.indexOf((size ?? "").trim().toLowerCase());
  return at === -1 ? 2 : at;
}

export function passableTiles(input: {
  width: number;
  tokens: BattleToken[];
  mover: BattleToken;
  footprintOf: (token: BattleToken) => Footprint;
  sizeOf: (token: BattleToken) => string | undefined;
  // Halfling Nimbleness: through the space of any creature larger than you.
  nimble?: boolean;
}): Set<number> {
  const out = new Set<number>();
  const moverSize = sizeIndex(input.sizeOf(input.mover));
  // Characters and the DM's figures side with each other; enemies with each
  // other. A prop is a thing, not a creature, and blocks.
  const side = (token: BattleToken) => (token.kind === "enemy" ? "enemy" : token.kind === "prop" ? "prop" : "party");
  const moverSide = side(input.mover);
  for (const token of input.tokens) {
    if (token.id === input.mover.id || side(token) === "prop") {
      continue;
    }
    const size = sizeIndex(input.sizeOf(token));
    const friendly = side(token) === moverSide;
    const through = friendly || Math.abs(size - moverSize) >= 2 || (input.nimble === true && size > moverSize);
    if (!through) {
      continue;
    }
    const footprint = input.footprintOf(token);
    if (footprint === 1) {
      out.add(tileIndex(input.width, token.x, token.y));
      continue;
    }
    for (const idx of footprintIndexes(input.width, { x: token.x, y: token.y }, footprint)) {
      out.add(idx);
    }
  }
  return out;
}

// Halfling Nimbleness on a sheet.
export function hasHalflingNimbleness(features: Array<{ name: string }> = []): boolean {
  return features.some((feature) => /^halfling nimbleness\b/i.test(feature.name.trim()));
}

// A character's walking traits on the board, with whose space they may pass
// through: the move route and the board's reachable tiles ask the same.
export function pcMoveTraits(input: {
  width: number;
  tokens: BattleToken[];
  mover: BattleToken;
  sheet: { race: string; features: Array<{ name: string }> };
  footprintOf: (token: BattleToken) => Footprint;
  enemySize: (refId: string) => string | undefined;
}): MoveTraits {
  const moverSize = sizeForRace(input.sheet.race);
  const traits = moveTraitsFrom(input.sheet.features);
  return {
    ...(typeof traits === "object" ? traits : { swims: traits }),
    passable: passableTiles({
      width: input.width,
      tokens: input.tokens,
      mover: input.mover,
      footprintOf: input.footprintOf,
      sizeOf: (token) => (token.id === input.mover.id ? moverSize : token.kind === "enemy" ? input.enemySize(token.refId) : undefined),
      nimble: hasHalflingNimbleness(input.sheet.features),
    }),
  };
}
