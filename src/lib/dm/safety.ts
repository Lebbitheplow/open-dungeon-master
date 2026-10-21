import { getCampaignById } from "@/lib/db/campaigns";
import { getDatabase } from "@/lib/db/core";
import { getLatestDmMessage, updateMessageContent } from "@/lib/db/messages";
import { dmQueuePausedFor, pauseDmQueue, resumeDmQueue } from "@/lib/dm/queue";
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

// Raised whatever else holds the queue: a table break taken first does not
// hide a card raised during it.
export function xCardRaised(campaignId: string): boolean {
  return dmQueuePausedFor(campaignId, X_CARD_REASON);
}

// The pause is held in memory, so a restart lowered every raised X-card
// without anyone choosing how to go on: the snapshot stopped showing it and
// the queue ran its next job. The persisted events still say it is up, so
// a starting server raises it again for every table whose latest X-card
// event is the card itself rather than a resume, before anything is queued
// behind it (src/lib/dm/restart-recovery.ts). Returns those tables.
export function restoreXCardPauses(): string[] {
  // SQLite answers the bare `type` from the row that holds MAX(seq).
  const latest = getDatabase()
    .prepare(
      `SELECT campaign_id AS campaignId, type, MAX(seq) AS seq FROM campaign_events
        WHERE type IN ('x_card', 'safety_resumed') GROUP BY campaign_id`,
    )
    .all() as Array<{ campaignId: string; type: string; seq: number }>;
  const raised = latest.filter((row) => row.type === "x_card").map((row) => row.campaignId);
  for (const campaignId of raised) {
    pauseDmQueue(campaignId, X_CARD_REASON);
  }
  return raised;
}

export type ResumeAction = "continue" | "rewind" | "reroll";

// Continue as it stands, withdraw the last passage, or write it again
// steering away from its subject. The card comes down in every case; a
// table break still up keeps the queue paused until it is resumed too.
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
    const withdrawn = updateMessageContent(latest.id, WITHDRAWN_TEXT, []);
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
  resumeDmQueue(campaignId, X_CARD_REASON);
  publishPersisted(campaignId, "safety_resumed", { at: Date.now(), action });
  return outcome;
}
