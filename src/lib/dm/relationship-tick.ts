import { listRelationships, patchRelationship } from "@/lib/db/relationships";
import { recordExtractedFacts } from "@/lib/db/facts";
import { publishEphemeral } from "@/lib/events";
import { decayBeatCounts, longingNote } from "@/lib/dm/relationship-logic";
import type { FactCandidate } from "@/lib/dm/fact-logic";

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
  const relationships = listRelationships(campaignId).filter(
    (relationship) => relationship.status !== "ended",
  );
  if (!relationships.length) {
    return;
  }
  const transcript = chapterTranscript.toLowerCase();
  const facts: FactCandidate[] = [];

  for (const relationship of relationships) {
    const seen =
      Boolean(transcript) && transcript.includes(relationship.subjectName.toLowerCase());
    const apartChapters = seen ? 0 : Math.min(relationship.apartChapters + 1, 20);
    const note = seen
      ? null
      : longingNote(
          relationship.subjectName,
          relationship.characterName,
          apartChapters,
          relationship.approval,
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
}
