import type { Campaign } from "@/lib/db/campaigns";
import { requestDmMessage } from "@/lib/dm/model";
import {
  cleanPartyDraft,
  PARTY_BACKSTORY_MAX,
  PARTY_DRAFT_SYSTEM,
  partyDraftRequest,
  type DraftCharacter,
} from "@/lib/dm/party-story";
import { withLanguage } from "@/lib/dm/table-language-logic";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { stripReasoningArtifacts } from "@/lib/story-prompt";

// The party backstory's "Draft from our backstories" button: one model call
// that ties the seated characters' own backstories together. It writes
// nothing; the draft goes back to the card, the table edits it, and only a
// save stores it (src/app/api/campaigns/[campaignId]/party/backstory). The
// story model rather than the utility one, because the answer is prose the
// players read. The rules of what is asked live in party-story.ts.
export async function draftPartyBackstory(
  campaign: Campaign,
  characters: DraftCharacter[],
  current: string,
): Promise<{ text: string; error?: string }> {
  const { message, error } = await requestDmMessage(
    campaign.settings,
    [
      { role: "system", content: withLanguage(PARTY_DRAFT_SYSTEM, campaign.gameSettings.tableLanguage) },
      {
        role: "user",
        content: partyDraftRequest({
          characters,
          premise: campaign.description,
          setting: campaign.theme || campaign.gameSettings.genre.replace(/_/g, " "),
          current: current.trim().slice(0, PARTY_BACKSTORY_MAX),
        }),
      },
    ],
    { timeoutMs: arcTextTimeoutMs() },
  );
  if (error) {
    return { text: "", error: "The story model could not be reached." };
  }
  const text = cleanPartyDraft(stripReasoningArtifacts(String(message?.content ?? "")));
  return text ? { text } : { text: "", error: "The story model returned nothing usable." };
}
