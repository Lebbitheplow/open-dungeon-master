import { getCampaignById } from "@/lib/db/campaigns";
import { getLatestDmMessage, updateMessageContent } from "@/lib/db/messages";
import { dmQueuePaused, pauseDmQueue, resumeDmQueue } from "@/lib/dm/queue";
import { runRenarrate } from "@/lib/dm/renarrate";
import { publishPersisted } from "@/lib/events";

// The X-card (docs/vtt-parity-implementation-plan.md 9.1). Anyone at the
// table raises it; the DM queue stops at its gate; the seat that runs the
// story chooses how to go on. The events never say who raised it.

export const X_CARD_REASON = "x-card";
export const WITHDRAWN_TEXT = "[The table stepped back from this passage.]";

export function raiseXCard(campaignId: string): { at: number } {
  pauseDmQueue(campaignId, X_CARD_REASON);
  const at = Date.now();
  publishPersisted(campaignId, "x_card", { at });
  return { at };
}

export function xCardRaised(campaignId: string): boolean {
  return dmQueuePaused(campaignId) === X_CARD_REASON;
}

export type ResumeAction = "continue" | "rewind" | "reroll";

// Continue as it stands, withdraw the last passage, or write it again
// steering away from its subject. The queue reopens in every case.
export async function resumeAfterXCard(
  campaignId: string,
  action: ResumeAction,
): Promise<{ ok: true } | { error: string }> {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return { error: "Campaign not found." };
  }
  const latest = getLatestDmMessage(campaignId);
  let outcome: { ok: true } | { error: string } = { ok: true };
  if (action === "rewind" && latest) {
    const withdrawn = updateMessageContent(latest.id, WITHDRAWN_TEXT);
    if (withdrawn) {
      publishPersisted(campaignId, "message_updated", { message: withdrawn });
    }
  } else if (action === "reroll" && latest) {
    const result = await runRenarrate({
      campaignId,
      messageId: latest.id,
      guidance:
        "Someone at the table asked to step away from the subject of the last passage. Write it again avoiding that subject entirely: take the scene somewhere else, keep every dice result and outcome as it was.",
    });
    if ("error" in result) {
      outcome = { error: result.error };
    } else {
      publishPersisted(campaignId, "message_updated", { message: result.message });
    }
  }
  resumeDmQueue(campaignId);
  publishPersisted(campaignId, "safety_resumed", { at: Date.now(), action });
  return outcome;
}
