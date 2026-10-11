// The Hand's turn, read from the engine: the public encounter carries the
// turn budget of the character whose turn it is, who the pointer rests on,
// surprise, and the reactions spent (src/lib/db/encounter-view.ts). The Hand
// used to keep its own ledger of what it had sent and mark a card spent on
// any 2xx, so a card the engine later refused stayed spent and one played by
// typing stayed open. Now nothing is spent until the engine says so.
//
// Pure; scripts/test-hand-engine.mjs drives it.
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { HandTurn } from "@/lib/battlemap/hand-core";

export type FloorView = { myTurn: boolean; currentName?: string };

export function turnFromEncounter(
  encounter: Pick<
    PublicEncounter,
    "round" | "orderReady" | "turn" | "acting" | "surprised" | "reactionsUsed"
  > | null,
  sheet: Pick<CharacterSheet, "id">,
  floor: FloorView,
): HandTurn {
  // An older server sends no `acting`: the floor's word stands in for it.
  const table =
    encounter && encounter.acting !== undefined
      ? {
          round: encounter.round,
          orderReady: encounter.orderReady,
          acting: encounter.acting,
          surprised: encounter.surprised ?? { acting: [], reacting: [] },
        }
      : null;
  const myTurn = table ? table.acting?.id === sheet.id : floor.myTurn;
  const engine = encounter?.turn && encounter.turn.ownerId === sheet.id ? encounter.turn : null;
  // The budget is only this character's while it is their turn; off it, the
  // one thing that carries over is the reaction.
  const own = myTurn ? engine : null;
  return {
    myTurn,
    currentName: table?.acting?.name ?? floor.currentName,
    actionUsed: own?.actionUsed ?? false,
    bonusUsed: own?.bonusUsed ?? false,
    reactionUsed: encounter?.reactionsUsed
      ? encounter.reactionsUsed.includes(sheet.id)
      : (engine?.reactionUsed ?? false),
    attacksMade: own?.attacksMade ?? 0,
    ...(own?.extraActions ? { extraActions: own.extraActions } : {}),
    ...(own?.grantedActions ? { grantedActions: own.grantedActions } : {}),
    ...(own?.marks?.length ? { marks: own.marks } : {}),
    ...(own?.flurryStrikes ? { flurryStrikes: own.flurryStrikes } : {}),
    ...(own?.castThisAction ? { castThisAction: true } : {}),
    table,
  };
}

// What the turn's pips show: the engine's count, the same one the cards read.
export function turnPips(turn: HandTurn): Array<{ label: string; used: boolean }> {
  return [
    {
      label: "Action",
      used: turn.actionUsed && (turn.extraActions ?? 0) <= 0 && (turn.grantedActions ?? 0) <= 0,
    },
    { label: "Bonus", used: turn.bonusUsed },
    { label: "Reaction", used: turn.reactionUsed },
  ];
}

// The board's turn pips (BoardChrome.tsx TurnHud): what is still there, from
// the same count; null off this character's turn.
export function turnHudBudget(turn: HandTurn | null): { action: boolean; bonus: boolean; reaction: boolean } | null {
  if (!turn?.myTurn) return null;
  const [action, bonus, reaction] = turnPips(turn);
  return { action: !action.used, bonus: !bonus.used, reaction: !reaction.used };
}

// A signature of everything the engine counts, so the Hand can tell when a
// card it sent has been resolved (the count moved) without keeping a ledger.
export function turnSignature(turn: HandTurn): string {
  return [
    turn.myTurn ? 1 : 0,
    turn.actionUsed ? 1 : 0,
    turn.bonusUsed ? 1 : 0,
    turn.reactionUsed ? 1 : 0,
    turn.attacksMade,
    turn.extraActions ?? 0,
    turn.grantedActions ?? 0,
    turn.flurryStrikes ?? 0,
    (turn.marks ?? []).length,
    turn.table?.round ?? 0,
    turn.table?.acting?.name ?? "",
  ].join("|");
}

// The character a player is running: the one their seat marks active when
// they field several (Play as, src/app/api/campaigns/[campaignId]/sheet/
// switch/route.ts), else the first they made. The Hand, the board's turn
// HUD and the session read this, so a switch moves all of them at once;
// the first owned sheet alone left the Hand on the old character (issue
// #185). A companion is never the one played.
export function playingSheet<T extends { id: string; userId: string; isCompanion?: boolean }>(
  sheets: T[],
  meUserId: string,
  activeSheetId: string | undefined,
): T | null {
  const own = sheets.filter((sheet) => sheet.userId === meUserId && !sheet.isCompanion);
  return own.find((sheet) => sheet.id === activeSheetId) ?? own[0] ?? null;
}
