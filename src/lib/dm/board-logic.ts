import { blocksMove, inBounds, tileIndex, type AdhocTokenKind } from "@/lib/battlemap/types";

// The rules for a DM handling the board directly: where a token may be put
// down, and what may be put down at all.
//
// Free placement is deliberately looser than a player's move. It ignores
// distance, reach and the round's budget, because a DM repositioning the
// board is not a creature walking across it. What it does NOT ignore is the
// board's own physics: a token inside a wall or sharing a tile with another
// token would make every reach, cover and line-of-sight answer the engine
// gives afterwards a lie.
//
// Pure by design so scripts/test-dm-board.mjs can drive it.

export const ADHOC_NAME_MAX = 40;
// Enough for a market square; small enough that the board stays legible and
// a stuck loop cannot fill a map with barrels.
export const MAX_ADHOC_TOKENS = 24;

export const ADHOC_LABELS: Record<AdhocTokenKind, string> = {
  npc: "Person",
  prop: "Object",
};

export const ADHOC_HINTS: Record<AdhocTokenKind, string> = {
  npc: "A bystander, an ally, anyone the rules engine does not need a stat block for.",
  prop: "A crate, a brazier, a cart. Something that stands in the way.",
};

// Somebody pointing at a tile. Lives here rather than beside the publisher
// so the client can name the shape it receives without importing anything
// that touches the database.
export type MapPing = {
  x: number;
  y: number;
  by: string;
  // The DM's version, which opens the board on every client rather than only
  // flashing on the ones already looking at it.
  focus: boolean;
  at: number;
};

export type PlacementInput = {
  terrain: string;
  width: number;
  height: number;
  // Tile indexes already holding a token, excluding the one being moved.
  occupied: Set<number>;
  x: number;
  y: number;
};

export type PlacementOutcome = { ok: true } | { error: string };

export function checkPlacement(input: PlacementInput): PlacementOutcome {
  const { terrain, width, height, occupied, x, y } = input;
  if (!inBounds(width, height, x, y)) {
    return { error: "That tile is off the map." };
  }
  const idx = tileIndex(width, x, y);
  if (blocksMove(terrain[idx] ?? "#")) {
    return { error: "That tile is solid wall. Paint it open first if it should not be." };
  }
  if (occupied.has(idx)) {
    return { error: "Somebody is already standing there." };
  }
  return { ok: true };
}

// A name for a token the DM typed in themselves. Empty is refused rather
// than defaulted, because an unlabelled circle on a shared map is a puzzle
// for the whole table.
export function checkAdhocName(raw: unknown): { name: string } | { error: string } {
  const name = String(raw ?? "").trim().slice(0, ADHOC_NAME_MAX);
  if (!name) {
    return { error: "Give it a name so the table knows what it is looking at." };
  }
  return { name };
}

export function checkAdhocRoom(existing: number): PlacementOutcome {
  if (existing >= MAX_ADHOC_TOKENS) {
    return { error: `That is ${MAX_ADHOC_TOKENS} placed pieces already; clear one off first.` };
  }
  return { ok: true };
}

// Ref ids for the DM's own pieces. They are not sheet ids or enemy ids, and
// the prefix is what says so: anything reading a ref_id can tell at a glance
// that there is no stat block behind this one.
export function adhocRefId(kind: AdhocTokenKind, unique: string): string {
  return `${kind}:${unique}`;
}

export function isAdhocRef(refId: string): boolean {
  return refId.startsWith("npc:") || refId.startsWith("prop:");
}
