// Taking back a move on the battle map, the way a tactics game lets a unit
// that was sent to the wrong square step back before it acts. A walk nothing
// answered (no opportunity attack, no spell area, no grapple let go, no roll,
// no creature newly seen) is kept here with the state of the fight it left;
// Undo puts the figure back and returns the movement while that state still
// holds. Whatever happens next (an action, an attack, a spell, the turn
// passing, another figure moving, a hit point lost) changes it, and the move
// stands. Each kept walk is one step back, so three hasty taps are three
// presses of Undo.
//
// In memory, on globalThis so dev-mode HMR cannot fork the map: a restart
// forgets what could be taken back, and every move simply stands.

import { listTokens, moveToken } from "@/lib/db/battle-maps";
import { listEnemies, type Encounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { TILE_FEET, type XY } from "@/lib/battlemap/types";
import type { PlayerMapView } from "@/lib/battlemap/view-types";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type MoveStep = {
  sheetId: string;
  tokenId: string;
  from: XY;
  // The token's movement spent this round before the walk.
  movedBefore: number;
  // Creatures dragged along, and where each stood.
  carried: Array<{ tokenId: string; from: XY; movedThisRound: number }>;
  // The conditions before the walk, when it stood the character up.
  stood: Pick<CharacterSheet, "conditions" | "conditionMeta"> | null;
  feet: number;
  // The fight as the walk left it (boardState).
  state: string;
};

declare global {
  var __odmMoveUndo: Map<string, MoveStep[]> | undefined;
}

// Steps kept per fight; a turn of single-square taps never needs more.
const MAX_STEPS = 24;

function steps(): Map<string, MoveStep[]> {
  return (globalThis.__odmMoveUndo ??= new Map());
}

// Rows in one order whatever order the database hands them back in.
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Everything that changes when anything else happens in the fight: whose turn
// and what it has spent, where every figure stands and how far it has moved,
// every enemy's hit points and conditions, and the mover's own. Explored
// squares are left out on purpose: what a character saw on the walk stays seen.
export function boardState(encounter: Pick<Encounter, "id" | "round" | "turnIndex" | "turnBudget">, mapId: string, sheetId: string): string {
  const sheet = getSheetById(sheetId);
  return JSON.stringify({
    round: encounter.round,
    turnIndex: encounter.turnIndex,
    budget: encounter.turnBudget,
    tokens: listTokens(mapId)
      .sort(byId)
      .map((token) => [token.id, token.x, token.y, token.movedThisRound]),
    enemies: listEnemies(encounter.id)
      .sort(byId)
      .map((enemy) => [enemy.id, enemy.currentHp, enemy.status, enemy.conditions]),
    sheet: sheet ? [sheet.currentHp, sheet.tempHp, sheet.conditions, sheet.deathSaves ?? null] : null,
  });
}

// A walk that can be taken back, kept on top of the turn's earlier ones. A
// walk by somebody else, or on another turn, starts the list again.
export function keepMove(encounterId: string, step: MoveStep) {
  const kept = (steps().get(encounterId) ?? []).filter((entry) => entry.sheetId === step.sheetId);
  steps().set(encounterId, [...kept, step].slice(-MAX_STEPS));
}

// A move that stands: nothing before it can be taken back either.
export function forgetMoves(encounterId: string) {
  steps().delete(encounterId);
}

// The walk the character could take back right now, or null.
export function undoableMove(
  encounter: Pick<Encounter, "id" | "round" | "turnIndex" | "turnBudget">,
  mapId: string,
  sheetId: string,
): MoveStep | null {
  const top = steps().get(encounter.id)?.at(-1);
  if (!top || top.sheetId !== sheetId) {
    return null;
  }
  return top.state === boardState(encounter, mapId, sheetId) ? top : null;
}

// Puts the figure (and anyone it dragged) back where the walk began, returns
// the movement, and lies them back down if the walk stood them up. The step
// below is then the one Undo offers: its state is what this leaves.
export function takeBack(campaignId: string, encounterId: string, step: MoveStep) {
  moveToken(step.tokenId, step.from.x, step.from.y, step.movedBefore);
  for (const entry of step.carried) {
    moveToken(entry.tokenId, entry.from.x, entry.from.y, entry.movedThisRound);
  }
  if (step.stood) {
    const updated = patchSheet(step.sheetId, { conditions: step.stood.conditions, conditionMeta: step.stood.conditionMeta });
    if (updated) {
      publishPersisted(campaignId, "sheet_updated", { sheet: updated });
    }
  }
  steps().get(encounterId)?.pop();
}

// The figures a projection shows only when they are seen (view.ts: enemies,
// bystanders, props). A walk that adds one has told the player something,
// and cannot be taken back.
export function sightedIds(view: Pick<PlayerMapView, "tokens"> | null): Set<string> {
  return new Set((view?.tokens ?? []).filter((token) => token.kind === "enemy" || token.kind === "npc" || token.kind === "prop").map((token) => token.id));
}

// What the board offers: how far the walk taken back went.
export function undoOffer(step: MoveStep | null): { feet: number } | undefined {
  return step ? { feet: step.feet } : undefined;
}

export function stepFeet(tiles: number): number {
  return tiles * TILE_FEET;
}
