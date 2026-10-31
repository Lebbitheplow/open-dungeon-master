import { getCampaignById } from "@/lib/db/campaigns";
import { listRelationships, patchRelationship } from "@/lib/db/relationships";
import { listSheets } from "@/lib/db/sheets";
import { openPartyBonds } from "@/lib/dm/party-bonds";
import { heroFell } from "@/lib/characters/fallen-logic";
import { recordExtractedFacts } from "@/lib/db/facts";
import { publishEphemeral } from "@/lib/events";
import { decayBeatCounts, longingNote } from "@/lib/dm/relationship-logic";
import { outwardApproval } from "@/lib/dm/scheme-logic";
import type { FactCandidate } from "@/lib/dm/fact-logic";
import { textKey } from "@/lib/language/text-logic";

// The relationship chapter pass, run at chapter close beside the NPC agency
// engine (src/lib/dm/npc-agency.ts) and costing exactly zero model calls.
//
// Two jobs. First, beat counters halve, so the diminishing returns that stop
// a player repeating one move ten times in a scene forgive themselves across
// the story. Second, and the reason this exists: someone who cares about a
// character does not sit off-screen forever. Every chapter that passes
// without their name appearing raises a longing counter, and once it crosses
// the threshold the pass writes a DM-only fact telling the next prompt to
// bring them back into play, then resets the count so the nudge does not
// repeat every chapter.

export function advanceRelationships(campaignId: string, chapterTranscript: string) {
  // A hero who fell is not away from anyone (issue 657): their bonds count
  // no chapters, and nobody is asked to send word to the dead.
  const fallen = new Set(listSheets(campaignId).filter(heroFell).map((sheet) => sheet.id));
  const relationships = listRelationships(campaignId).filter(
    (relationship) => relationship.status !== "ended" && !fallen.has(relationship.characterId),
  );
  // After the pass below, so a bond opened here starts its count at nothing.
  const opened = openCompanionBonds(campaignId);
  if (!relationships.length) {
    if (opened) {
      publishEphemeral(campaignId, "relationships_updated", {});
    }
    return;
  }
  const transcript = textKey(chapterTranscript);
  const facts: FactCandidate[] = [];

  for (const relationship of relationships) {
    const seen =
      Boolean(transcript) && transcript.includes(textKey(relationship.subjectName));
    const apartChapters = seen ? 0 : Math.min(relationship.apartChapters + 1, 20);
    const note = seen
      ? null
      : longingNote(
          relationship.subjectName,
          relationship.characterName,
          apartChapters,
          // A schemer seeks out their mark as the act would: the nudge
          // reads like any other, to the lead who reads DM-only facts.
          outwardApproval(relationship),
          relationship.romance,
        );
    if (note) {
      facts.push({ category: "npc", subject: relationship.subjectName, fact: note });
    }
    patchRelationship(relationship.id, {
      // A nudge that has been handed to the DM starts its own count over, so
      // an absent friend or lover pulls at the story periodically rather
      // than every single chapter.
      apartChapters: note ? 0 : apartChapters,
      beats: decayBeatCounts(relationship.beats),
    });
  }

  if (facts.length) {
    const inserted = recordExtractedFacts(campaignId, facts, "simulation", { knownBy: "dm" });
    if (inserted.length) {
      publishEphemeral(campaignId, "facts_updated", {});
    }
  }
  if (opened) {
    publishEphemeral(campaignId, "relationships_updated", {});
  }
}

// Every lasting companion in the party has a bond with every character in it
// (issue 580). add_companion opens them as the companion joins; this catches
// a companion who joined before it did, and a character who joined the table
// after the companion, at the next chapter's close. Returns how many opened.
function openCompanionBonds(campaignId: string): number {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return 0;
  }
  let opened = 0;
  for (const sheet of listSheets(campaignId)) {
    // A companion who fell and was not yet dismissed is dead, not someone to
    // open bonds toward (issue 657).
    if (sheet.isCompanion && sheet.companionKind === "party" && !sheet.summon && !heroFell(sheet)) {
      opened += openPartyBonds(campaign, { kind: "companion", name: sheet.name, id: sheet.id });
    }
  }
  return opened;
}
