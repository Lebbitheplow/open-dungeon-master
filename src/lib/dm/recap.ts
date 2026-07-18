import {
  allocateSeq,
  getCampaignById,
  getCampaignSummaryState,
} from "@/lib/db/campaigns";
import { listRecentEventsForCampaign } from "@/lib/db/character-events";
import { getCurrentLocation } from "@/lib/db/locations";
import { insertCampaignMessage, listRecentMessages } from "@/lib/db/messages";
import { publishWithSeq } from "@/lib/events";
import { extractStoryText, stripReasoningArtifacts } from "@/lib/story-prompt";
import { requestDmMessage } from "@/lib/dm/model";

// "Previously, on..." recap inserted when a campaign resumes after a long
// idle gap, so nobody rereads the whole log. Runs on the DM queue right
// before the waking turn.
export async function runResumeRecap(campaignId: string) {
  const campaign = getCampaignById(campaignId);
  if (!campaign || campaign.status !== "active") {
    return;
  }
  const { summary } = getCampaignSummaryState(campaignId);
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
          summary ? `Story so far:\n${summary}` : "",
          location ? `Current location: ${location.name}` : "",
          events.length ? `Recent milestones:\n${events.map((entry) => `- ${entry}`).join("\n")}` : "",
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
}
