import {
  allocateSeq,
  getCampaignById,
  getCampaignSummaryState,
} from "@/lib/db/campaigns";
import { listChapters } from "@/lib/db/chapters";
import { listRecentEventsForCampaign } from "@/lib/db/character-events";
import { getCurrentLocation } from "@/lib/db/locations";
import { insertCampaignMessage, listRecentMessages } from "@/lib/db/messages";
import { campaignSeats } from "@/lib/db/campaigns";
import { insertWhisper } from "@/lib/db/dm-whispers";
import { listActiveFacts } from "@/lib/db/facts";
import { listQuests } from "@/lib/db/quests";
import { recapMaterial, renderRecapMaterial } from "@/lib/dm/recap-logic";
import { hasHumanDm } from "@/lib/dm/viewer";
import { publishEphemeral } from "@/lib/events";
import { publishWithSeq } from "@/lib/events";
import { extractStoryText, stripReasoningArtifacts } from "@/lib/story-prompt";
import { requestDmMessage } from "@/lib/dm/model";

// "Previously, on..." recap inserted when a campaign resumes after a long
// idle gap, so nobody rereads the whole log. Runs on the DM queue right
// before the waking turn.
//
// Two tracks (docs/vtt-parity-implementation-plan.md 13.4): the party's
// recap is written from what the party may know and lands as the shared
// card; a human DM gets a second one, whispered, that adds the secret facts
// and where the world's arcs stand.
export async function runResumeRecap(campaignId: string) {
  const campaign = getCampaignById(campaignId);
  if (!campaign || campaign.status !== "active") {
    return;
  }
  const material = {
    facts: listActiveFacts(campaignId, 60),
    quests: listQuests(campaignId).map((quest) => ({ title: quest.title, source: quest.visibility === "dm" ? "dm-secret" : quest.source, objectives: quest.objectives })),
    arcs: campaign.storyArc?.worldArcs ?? [],
  };
  const partyTrack = renderRecapMaterial(recapMaterial(material, false));
  const { summary } = getCampaignSummaryState(campaignId);
  const lastChapter = listChapters(campaignId)
    .filter((chapter) => chapter.status === "closed")
    .at(-1);
  const location = getCurrentLocation(campaignId);
  const recent = listRecentMessages(campaignId, 12)
    .map((message) => `${message.authorType === "dm" ? "DM" : "Player"}: ${message.content}`)
    .join("\n")
    .slice(-6_000);
  const events = [...listRecentEventsForCampaign(campaignId, 2).values()]
    .flat()
    .map((event) => event.summary)
    .slice(0, 8);

  const { message, error } = await requestDmMessage(
    campaign.settings,
    [
      {
        role: "system",
        content:
          "Write a short 'Previously, on...' recap for a D&D table returning after a break. 3-5 sentences, past tense, second person plural, ending on where the party stands now. Output only the recap.",
      },
      {
        role: "user",
        content: [
          lastChapter
            ? `Last chapter ("${lastChapter.title}"):\n${lastChapter.summary}`
            : "",
          summary ? `Current chapter so far:\n${summary}` : "",
          location ? `Current location: ${location.name}` : "",
          events.length ? `Recent milestones:\n${events.map((entry) => `- ${entry}`).join("\n")}` : "",
          partyTrack,
          `Most recent exchanges:\n${recent}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    {},
  );
  if (error) {
    return;
  }
  const recap = stripReasoningArtifacts(extractStoryText(message?.content) ?? "").trim();
  if (!recap) {
    return;
  }
  const seq = allocateSeq(campaignId);
  const inserted = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    content: `Previously: ${recap.slice(0, 2_000)}`,
  });
  publishWithSeq(campaignId, seq, "message_added", { message: inserted });

  // The DM's own track, only when a person sits in the seat: the secrets
  // and the arcs, as a whisper nobody else receives.
  const seats = campaignSeats(campaign);
  if (hasHumanDm(seats) && seats.humanDmUserId) {
    const dmTrack = renderRecapMaterial(recapMaterial(material, true));
    if (dmTrack) {
      insertWhisper(campaignId, null, [{ userId: seats.humanDmUserId, characterId: "", characterName: "the DM" }], `Previously, for your eyes: what the party does not know and where the world stands.\n\n${dmTrack.slice(0, 2_000)}`);
      publishEphemeral(campaignId, "whispers_updated", { at: Date.now() });
    }
  }
}
