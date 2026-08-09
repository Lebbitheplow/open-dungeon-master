import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getDmTurn } from "@/lib/db/dm-turns";
import {
  getCampaignMessage,
  setMessageVariants,
  type CampaignMessage,
} from "@/lib/db/messages";
import { enqueueDmJob } from "@/lib/dm/queue";
import { requestDmMessage } from "@/lib/dm/model";
import { setDmStatus } from "@/lib/dm/status";
import { stripToolText } from "@/lib/dm/tool-text";
import { enqueueNarrationAudio } from "@/lib/tts";
import { extractStoryText } from "@/lib/story-prompt";
import {
  appendVariant,
  assembleVariantContent,
  buildRenarrateMessages,
  extractFinalTake,
  seedVariants,
  resolveVariantIndex,
  MAX_VARIANTS,
  REROLL_TEMP_OFFSET,
  computeRerollTemperature,
} from "@/lib/dm/renarrate-logic";

// Narration reroll: the DB/IO rim around renarrate-logic.ts.
//
// The safety invariant is the whole point of this module. A reroll makes ONE
// model call, with toolChoice "none" and NO tools array, against the
// conversation the finished turn already stored. It never goes through
// runAdvance, so no dice are rolled, no sheet or encounter moves, no chapter
// closes and the world does not tick. The turn's own rollIds and earlier
// narration segments are reused verbatim, so the "[roll:<id>]" markers land
// byte-identically in every variant.

export type RenarrateResult = { message: CampaignMessage } | { error: string; status: number };

// The narration mp3 is keyed by message id, so a stale take would keep
// playing under new prose. Regenerating overwrites the same file and
// publishes tts_ready, which is all the client needs to swap.
function refreshNarrationAudio(campaign: Campaign, message: CampaignMessage) {
  if (!campaign.gameSettings.ttsEnabled) {
    return;
  }
  void enqueueNarrationAudio(
    campaign.id,
    message.id,
    message.content,
    campaign.gameSettings.ttsVoice,
  );
}

export async function runRenarrate(input: {
  campaignId: string;
  messageId: string;
  guidance: string;
  // Added to the story model's base temperature for this take only, so a lead
  // browsing takes can push for more variation without retuning the campaign.
  tempOffset?: number;
}): Promise<RenarrateResult> {
  const campaign = getCampaignById(input.campaignId);
  if (!campaign) {
    return { error: "Campaign not found.", status: 404 };
  }
  const message = getCampaignMessage(input.messageId);
  if (!message || message.campaignId !== input.campaignId) {
    return { error: "Message not found.", status: 404 };
  }
  if (message.authorType !== "dm") {
    return { error: "Only DM narration can be rerolled.", status: 400 };
  }
  if (!message.dmTurnId) {
    return { error: "This narration predates rerolls; there is no turn to replay.", status: 400 };
  }
  const turn = getDmTurn(message.dmTurnId);
  if (!turn || turn.campaignId !== input.campaignId) {
    return { error: "The turn behind this narration is gone.", status: 400 };
  }
  if (!turn.conversation.length) {
    return { error: "This narration has no stored conversation to replay.", status: 400 };
  }

  const variants = seedVariants(message.variants ?? [], message.content);
  if (variants.length >= MAX_VARIANTS) {
    return { error: `That is all ${MAX_VARIANTS} takes; pick one.`, status: 409 };
  }

  const prompt = buildRenarrateMessages(
    turn.conversation,
    input.guidance,
    // Reroll from the take currently on screen, so successive rerolls keep
    // moving away from what the table just read.
    extractFinalTake(turn.narrationParts, turn.rollIds, message.content),
  );
  let narration = "";
  let failure = "";
  // Queued behind any live narration so the single model server never
  // interleaves two jobs for this campaign.
  await enqueueDmJob(input.campaignId, async () => {
    // The route only starts a reroll from an idle DM, so this cannot bury a
    // parked turn's status; it just tells the rest of the table the DM is
    // working. No dm_delta is streamed: a half-written variant is not canon.
    setDmStatus(input.campaignId, "narrating");
    try {
      const { message: reply, error } = await requestDmMessage(campaign.settings, prompt, {
        // No tools at all, on top of toolChoice "none": a variant that called
        // a tool would re-run mechanics that already resolved.
        toolChoice: "none",
        // Slightly hotter than the first pass, as a relative offset from the
        // story model's base rather than an absolute value that would
        // override whatever the campaign is tuned to.
        temperature: computeRerollTemperature(undefined, input.tempOffset ?? REROLL_TEMP_OFFSET),
      });
      if (error) {
        failure = "The model is unavailable; try again shortly.";
        return;
      }
      // Same cleanup the turn loop applies to streamed narration: reasoning
      // artifacts out, leaked tool text and hand-written roll markers out.
      narration = stripToolText(extractStoryText(reply?.content)).trim();
    } finally {
      setDmStatus(input.campaignId, "idle");
    }
  });

  if (failure) {
    return { error: failure, status: 502 };
  }
  if (!narration) {
    return { error: "The DM returned nothing; try again.", status: 502 };
  }

  const content = assembleVariantContent(turn.narrationParts, turn.rollIds, narration);
  // Re-read after the model call: the message may have moved on while the
  // model was working (a lore-check rewrite, or a double-tapped reroll).
  const current = getCampaignMessage(input.messageId);
  if (!current || current.campaignId !== input.campaignId) {
    return { error: "Message not found.", status: 404 };
  }
  const appended = appendVariant(seedVariants(current.variants ?? [], current.content), content);
  if (appended.capped) {
    return { error: `That is all ${MAX_VARIANTS} takes; pick one.`, status: 409 };
  }
  const updated = setMessageVariants(input.messageId, appended.variants, appended.index);
  if (!updated) {
    return { error: "Could not store the new take.", status: 500 };
  }
  refreshNarrationAudio(campaign, updated);
  return { message: updated };
}

// Browsing the takes: pure bookkeeping, no model call. Kept here rather than
// in the route so a selection refreshes the narration audio too.
export function selectRenarrateVariant(input: {
  campaignId: string;
  messageId: string;
  index: number;
}): RenarrateResult {
  const campaign = getCampaignById(input.campaignId);
  if (!campaign) {
    return { error: "Campaign not found.", status: 404 };
  }
  const message = getCampaignMessage(input.messageId);
  if (!message || message.campaignId !== input.campaignId) {
    return { error: "Message not found.", status: 404 };
  }
  const variants = seedVariants(message.variants ?? [], message.content);
  const index = resolveVariantIndex(variants, input.index);
  if (index < 0) {
    return { error: "No such take.", status: 400 };
  }
  const updated = setMessageVariants(input.messageId, variants, index);
  if (!updated) {
    return { error: "Could not select that take.", status: 500 };
  }
  refreshNarrationAudio(campaign, updated);
  return { message: updated };
}
