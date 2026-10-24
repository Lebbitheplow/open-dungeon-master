import type { Campaign } from "@/lib/db/campaigns";
import { insertFact } from "@/lib/db/facts";
import { unrecordedDeedSubject } from "@/lib/dm/beat-landing";
import type { NarrationClaim } from "@/lib/dm/claims-logic";
import { collectExchanges, type GuardMessage } from "@/lib/dm/engine-boundary";
import { publishEphemeral } from "@/lib/events";
import { conscienceOn, consciousCompanions } from "@/lib/dm/conscience";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Deeds the narration showed and no relationship_beat recorded (issue 503):
// the claims reader reads them in the call it already makes (the deed claim,
// src/lib/dm/claims-logic.ts), with no word scan and no call of its own, and
// the turn leaves the DM a DM-only note to record it. The note decides
// nothing: the DM knows who saw it, and a deed recorded later settles the
// note (beat-landing.ts settleUnrecordedDeeds). Where the outcome check is
// off nothing is read per turn; the chapter summary's facts carry deeds at
// the chapter's close instead (src/lib/dm/chapter-close.ts).

type DeedClaim = Extract<NarrationClaim, { kind: "deed" }>;

// The deeds this turn's own relationship_beat calls recorded, by character
// and kind.
function recordedDeeds(conversation: readonly GuardMessage[]): Set<string> {
  const recorded = new Set<string>();
  for (const exchange of collectExchanges(conversation)) {
    if (exchange.name !== "relationship_beat" || !exchange.result || exchange.result.ok !== true) {
      continue;
    }
    try {
      const args = JSON.parse(exchange.arguments || "{}") as { characterId?: unknown; beat?: unknown };
      recorded.add(`${String(args.characterId ?? "")}|${String(args.beat ?? "")}`);
    } catch {
      // A call whose arguments never parsed recorded nothing.
    }
  }
  return recorded;
}

export function noteUnrecordedDeeds(campaign: Campaign, conversation: readonly GuardMessage[], deeds: readonly DeedClaim[]): number {
  if (!deeds.length) {
    return 0;
  }
  const recorded = recordedDeeds(conversation);
  const noted = new Set<string>();
  for (const deed of deeds) {
    const key = `${deed.character}|${deed.deed}`;
    if (recorded.has(key) || noted.has(key)) {
      continue;
    }
    noted.add(key);
    insertFact({
      campaignId: campaign.id,
      category: "party",
      subject: unrecordedDeedSubject(deed.name),
      fact: `The narration showed ${deed.name} commit ${deed.deed.replace(/_/g, " ")} ("${deed.quote.slice(0, 160)}") and no relationship_beat recorded it. If a companion or a tracked NPC saw it, record it now with relationship_beat, beat ${deed.deed}, naming them in witnesses.`,
      knownBy: "dm",
      source: "manual",
    });
  }
  if (noted.size) {
    publishEphemeral(campaign.id, "facts_updated", {});
  }
  return noted.size;
}

// Where the outcome check is off, nothing reads a turn's prose, so the
// chapter's close asks for the deeds among the facts it already writes: one
// "Deed: <name>" fact a deed, which the DM records the same way.
export const DEED_FACT_SUBJECT = "Deed";

export function chapterDeedInstructions(campaign: Campaign, sheets: readonly CharacterSheet[]): string {
  if (campaign.gameSettings.narrationGuard || !conscienceOn(campaign) || !consciousCompanions(sheets).length) {
    return "";
  }
  return `For each deed a party character committed this chapter that a companion would judge (killing someone helpless, torture, robbing people with little, necromancy, desecration, slaving, cruelty, betraying an ally, breaking their word, sparing a beaten foe), add a fact with category "party" and subject "${DEED_FACT_SUBJECT}: <the character's name>" saying what they did and who saw it.`;
}
