// Whose turn it is in a fight, as distinct from who is next in the order.
//
// The pointer rests only on player characters: the enemies between two of
// them act inside the DM's turn as the pointer walks past (advanceOrder).
// Where nobody plays them at once (a person's DM; an AI DM between a
// player's End Turn and its own reply) the pointer already rests on the
// player up next while those enemies still have their turns, the floor held
// for them (src/lib/dm/enemies-due.ts). The pointer then says who is next,
// not whose turn it is, and every display of whose turn it is reads it from
// here: the encounter's `acting` (src/lib/db/encounter-view.ts) and the
// board's turn name and token (src/lib/battlemap/view.ts), so the board,
// the trackers and the Hand agree with the Enemy turns banner and with the
// refusal the player would get (table audit 2026-10-26, T11). The engine's
// own turn gate (can-act.ts actingCombatantId) still reads the pointer: who
// comes next is settled, and the floor's hold is what keeps the player
// waiting.
//
// Pure: no "@/" value imports and no I/O, so the projections and their
// tests share it.

import type { Encounter, OrderEntry } from "@/lib/db/encounters";

// The enemy side named as one combatant, wherever whose turn it is is said.
// It names nobody, so a hidden enemy is never given away by it, and a
// possessive reads right after it: "the enemy's turn" on the board, "It is
// the enemy's turn, not Ilse's" from the engine's turn check.
export const ENEMY_TURN_NAME = "the enemy";

export type TurnOwner = {
  // The combatant the pointer rests on: next in the order, and whose turn
  // it is unless `enemies` holds it.
  next: OrderEntry | null;
  // The enemies whose turns come first, by id; empty when the turn is the
  // pointer's.
  enemies: string[];
};

export function turnOwner(
  encounter: Pick<Encounter, "orderReady" | "order" | "turnIndex" | "legendary">,
): TurnOwner {
  if (!encounter.orderReady) {
    return { next: null, enemies: [] };
  }
  return { next: encounter.order[encounter.turnIndex] ?? null, enemies: encounter.legendary.due ?? [] };
}
