// A player character acts on their own turn when their player says so
// (issue 17: a character that attacked with no command given). The DM turn
// that opens a character's turn often has no word from its player (another
// player pressed End Turn, a wake), and the AI used to play the turn for
// them. So for the AI DM, every call that spends a character's turn (an
// attack, a spell they cast, an action, an item, a feature) or ends it is
// refused while it is that character's own turn and their player has not
// spoken in the input this DM turn answers. An absent player's turn is the lead's to
// skip (skipCurrentTurn), not the AI's to play. Companions are the AI's to
// play; reactions and anything off the character's turn never come here.
// A person at the console keeps a free hand, as with every correction
// (src/lib/dm/enemy-turn-order.ts is the same rule for enemies).

import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { listRecentMessages } from "@/lib/db/messages";
import { getSheetById } from "@/lib/db/sheets";
import { canAct } from "@/lib/dm/can-act";
import { resolveSheetRef } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Whether the character's player asked for something in the input this DM
// turn answers: a message of theirs since the DM last spoke, table talk
// aside. A token never walks on a turn its player did not speak in (issue 17:
// a token that moved with no input).
export function declaredThisTurn(campaignId: string, characterId: string): boolean {
  const messages = listRecentMessages(campaignId, 50);
  const since = messages.slice(messages.findLastIndex((message) => message.authorType === "dm") + 1);
  return since.some(
    (message) => message.authorType === "player" && message.characterId === characterId && !message.content.startsWith("(ooc)"),
  );
}

// The character whose own turn waits on their player: a player's character
// (not a companion) who could act, and whose player has not spoken since the
// DM last did. GAME STATE says so (src/lib/dm/turn.ts buildEncounterState),
// and the refusal below holds the AI to it. A character who cannot act
// (down, stunned, surprised) has no turn to play: passing it plays nothing
// for them, and a spend is refused by its own handler with the reason.
export function characterAwaitingPlayer(campaignId: string): CharacterSheet | null {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter || !encounter.orderReady || encounter.kind === "scene") {
    return null;
  }
  const current = encounter.order[encounter.turnIndex];
  const sheet = current.kind === "pc" ? getSheetById(current.characterId) : null;
  if (!sheet || sheet.isCompanion || !canAct({ sheet, encounter, kind: "free" }).ok || declaredThisTurn(campaignId, sheet.id)) {
    return null;
  }
  return sheet;
}

// Read from a tool call's arguments (characterId for an attack or an
// action, casterId or healerId where the character is not the target): the
// refusal, or null.
export function characterCallUnasked(
  campaignId: string,
  turn: Pick<DmTurn, "actor"> | null,
  rawArguments: string,
  key: "characterId" | "casterId" | "healerId",
): string | null {
  if (turn?.actor !== "ai") {
    return null;
  }
  let ref: unknown;
  try {
    ref = (JSON.parse(rawArguments || "{}") as Record<string, unknown>)[key];
  } catch {
    return null;
  }
  const sheet = characterAwaitingPlayer(campaignId);
  if (typeof ref !== "string" || !sheet || !resolveSheetRef(ref, [sheet], new Map([[sheet.id, sheet]]))) {
    return null;
  }
  return `${sheet.name} has not acted: their player hasn't declared an action this turn, and nothing was spent. Don't narrate an attempt; wait for them to say what ${sheet.name} does, or narrate the moment and stop.`;
}
