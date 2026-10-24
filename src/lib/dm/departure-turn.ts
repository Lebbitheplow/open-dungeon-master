import type { Campaign } from "@/lib/db/campaigns";
import { departedLinesForPrompt, settleReturns } from "@/lib/dm/companion-revenge";
import { conscienceBlockForPrompt } from "@/lib/dm/conscience";
import { departureNote, departureOpenings, settleDepartures } from "@/lib/dm/departure";
import { settleTurn, turnHolder } from "@/lib/dm/encounter-tools";
import { turncoatLinesForPrompt } from "@/lib/dm/turncoat";
import { getActiveEncounter } from "@/lib/db/encounters";
import { pactsAtOwnTurn } from "@/lib/dm/pacts";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Where the leaving and the return meet the turn machinery (issue 503
// Phases 2 and 3): before a DM turn builds its prompt (src/lib/dm/turn.ts)
// and after a console call (src/lib/dm/invoke.ts). A companion whose
// breaking point came by a road no tool reported (the clock, a standing
// that sank) is decided now; one whose plan finds its opening on its own
// turn acts on it, and the turn passes on as a dismissal's does; a cued
// return follows the standing it was cued on. Returns what the DM is told.
export function settleCompanionLeaving(campaign: Campaign): string[] {
  const holder = turnHolder(campaign.id);
  // A pact that means to strike goes on its leader's own turn (issue 503
  // Phase 5): its members cross to the foes' side where they stand.
  const encounter = getActiveEncounter(campaign.id);
  const current = encounter?.orderReady ? encounter.order[encounter.turnIndex] : undefined;
  const pacts = current?.kind === "pc" ? pactsAtOwnTurn(campaign, current.characterId) : [];
  const outcomes = [...settleDepartures(campaign), ...departureOpenings(campaign, "own_turn")];
  if (pacts.length || outcomes.some((outcome) => outcome.departed)) {
    settleTurn(campaign, holder);
  }
  settleReturns(campaign);
  return [...pacts, ...outcomes.map(departureNote).filter(Boolean)];
}

// The moment part of GAME STATE for companions: each one's values and rung
// (conscience.ts), who has left and what they are about, and what the
// server just had them do.
export function companionMomentBlock(campaign: Campaign, sheets: readonly CharacterSheet[], justNow: readonly string[]): string {
  const gone = [...departedLinesForPrompt(campaign), ...turncoatLinesForPrompt(campaign.id)];
  return [
    conscienceBlockForPrompt(campaign, sheets),
    gone.length ? `Companions who left the party or turned on it (server-tracked):\n${gone.join("\n")}` : "",
    justNow.length ? `Just now, by the server (narrate it as it happened): ${justNow.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
