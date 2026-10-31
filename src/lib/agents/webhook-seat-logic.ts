// Which character a player webhook or poll link wakes, as the player's seat
// changes (issue 654). Before this, a link stopped the moment the character
// it was made for was no longer the player's active one, and answered 404
// like a mistyped link: a hero who fell and was replaced, a lobby sheet
// rebuilt under a new id, or a switch at a table of one hero each left the
// agent asleep with nothing saying why. Pure, so the rules are tested
// without a database; src/lib/agents/webhooks.ts applies them.

import { heroFell } from "@/lib/characters/fallen-logic";

export type SeatSheet = { id: string; isCompanion?: boolean; deathSaves?: { dead?: boolean } | null };

export type StopReason = "character_changed" | "left_campaign" | "expired";

export type SeatVerdict =
  | { kind: "keep" }
  | { kind: "follow"; characterId: string }
  | { kind: "stop"; reason: StopReason };

export type SeatInput = {
  member: boolean;
  multiCharacter: "off" | "one_active" | "all_active" | string;
  // The subscribed sheet while it is still this player's at this table.
  subscribed: SeatSheet | null;
  // The player's active sheet (their seat), if any.
  current: SeatSheet | null;
  // Whether another subscription already wakes `current`.
  currentClaimed: boolean;
};

function playable(sheet: SeatSheet | null): sheet is SeatSheet {
  return Boolean(sheet) && !sheet!.isCompanion && !heroFell(sheet!);
}

export function seatVerdict(input: SeatInput): SeatVerdict {
  if (!input.member) return { kind: "stop", reason: "left_campaign" };
  const { subscribed, current } = input;
  // A character handed to the GM as a companion is the GM's to run.
  const own = subscribed && !subscribed.isCompanion ? subscribed : null;
  if (own) {
    // At a table where everyone plays several characters at once, the link
    // stays on its own character for as long as it plays: picking another
    // to type as does not stop it.
    if (input.multiCharacter === "all_active" && !heroFell(own)) return { kind: "keep" };
    // At a table of one hero each the link follows the seat; while the seat
    // is still on this character (alive, or fallen with no one brought in
    // yet) nothing changes.
    if (current?.id === own.id) return { kind: "keep" };
  }
  // The character fell, was rebuilt under a new id in the lobby, or the
  // player switched heroes: the link wakes the hero the player now plays,
  // unless another link already wakes that one.
  if (playable(current) && current.id !== subscribed?.id && !input.currentClaimed) {
    return { kind: "follow", characterId: current.id };
  }
  // A fallen hero with no one in the seat yet, at a table of several: the
  // link waits for the replacement rather than stopping.
  if (own && heroFell(own) && !playable(current)) return { kind: "keep" };
  return { kind: "stop", reason: "character_changed" };
}

// What an agent reads when its link has stopped: no names, since the link
// is a secret that reveals nothing about the story.
export function stopWordsForAgent(reason: StopReason, delivery: "poll" | "push"): string {
  const what = delivery === "poll" ? "This poll link" : "This webhook";
  const why = reason === "left_campaign" ? "its player is no longer at this table"
    : reason === "expired" ? "the connection it belongs to has expired"
    : "the character it woke is no longer one its player plays at this table, and no other could take it over";
  return `${what} stopped: ${why}. Ask your player for a new one in Settings > Connected agents.`;
}

// What the player reads on Settings > Connected agents.
export function stopWordsForPlayer(reason: StopReason, delivery: "poll" | "push", names: { character: string; date: string }): string {
  const what = delivery === "poll" ? "The poll link" : "The receiver";
  const why = reason === "left_campaign" ? "you are no longer at that table"
    : reason === "expired" ? "this connection expired"
    : `${names.character} is no longer the character you play there`;
  const next = reason === "expired" ? "Connect the agent again to make a new one."
    : delivery === "poll" ? "Make a new one with Poll link." : "Set the receiver up again for the character you play now.";
  return `${what} stopped on ${names.date}: ${why}. ${next}`;
}
