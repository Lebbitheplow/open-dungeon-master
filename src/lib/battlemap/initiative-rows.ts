// The initiative order as the trackers draw it. Thief's Reflexes gives the
// thief a second entry in the first round (an order entry with `reflex`, the
// same character id at initiative - 10: src/lib/dm/encounter-logic.ts
// withReflexTurns), so a row is keyed by its position, never by the id, and
// the row the pointer rests on is found by position first.
//
// Pure: the public encounter's order in, indexes and labels out;
// scripts/test-hand-engine.mjs drives it.

export type OrderRow = { id: string; name: string; reflex?: boolean; extra?: string };

// The React key of a row: its id and its place, so a combatant with two turns
// keeps two rows.
export function orderRowKey(row: OrderRow, index: number): string {
  return `${row.id}-${index}${row.reflex ? "-reflex" : ""}`;
}

// The row the pointer rests on. A player's order leaves hidden combatants
// out, so the engine's turn index can point past them; then the engine's
// `acting` name finds the row. When the index already lands on the acting
// combatant it wins, which keeps a thief's two rows apart.
export function currentOrderIndex(
  order: OrderRow[],
  turnIndex: number,
  acting: { name: string } | null | undefined,
): number {
  if (!acting) return turnIndex;
  if (order[turnIndex]?.name === acting.name) return turnIndex;
  return order.findIndex((row) => row.name === acting.name);
}

// The rows whose turn it is now, as every tracker lights them: the row the
// pointer rests on (found by the engine's `acting` in a player's order,
// which leaves hidden combatants out), or, while the enemies before the
// player up next take their turns, those enemies' rows as this viewer may
// see them (the projection's `enemiesUp`, src/lib/dm/turn-owner.ts) and
// never that player's. The trackers used to light the pointer's index
// alone, so they named the player while the enemies still had the turn,
// and in a player's order with a hidden enemy before the pointer they lit
// the seat after it.
export function litOrderRows(
  order: OrderRow[],
  turnIndex: number,
  acting: { name: string } | null | undefined,
  enemiesUp?: readonly string[],
): number[] {
  if (enemiesUp) {
    const up = new Set(enemiesUp);
    return order.flatMap((row, index) => (up.has(row.id) ? [index] : []));
  }
  const at = currentOrderIndex(order, turnIndex, acting);
  return at >= 0 ? [at] : [];
}

// The row the pointer rests on, for the turns already taken this round: the
// player up next while the enemies before them play, else whoever acts.
export function pointerOrderIndex(
  order: OrderRow[],
  encounter: { turnIndex: number; acting?: { name: string } | null; upNext?: { name: string } },
): number {
  return currentOrderIndex(order, encounter.turnIndex, encounter.upNext ?? encounter.acting);
}

// The tag a reflex row carries.
export const REFLEX_LABEL = "Thief's Reflexes";

// What a second row for the same character says: Thief's Reflexes' second
// turn in the first round, or an extra turn taken at once (Strength before
// Death, issue 233), which names the feature it comes from.
export function extraTurnTag(row: { reflex?: boolean; extra?: string }): { short: string; title: string } | null {
  if (!row.reflex) return null;
  return row.extra
    ? { short: "extra", title: `${row.extra}: an extra turn, taken now` }
    : { short: "2nd", title: `${REFLEX_LABEL}: a second turn this round` };
}
