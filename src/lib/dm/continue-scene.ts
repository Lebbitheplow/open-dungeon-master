import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getDmTurn } from "@/lib/db/dm-turns";
import {
  getCampaignMessage,
  getLatestDmMessage,
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
  assembleVariantContent,
  extractFinalTake,
  resolveVariantIndex,
  seedVariants,
} from "@/lib/dm/renarrate-logic";
import {
  buildContinueMessages,
  mergeContinuation,
  replaceSelectedVariant,
} from "@/lib/dm/continue-logic";

// Continue scene: the DB/IO rim around continue-logic.ts.
//
// A continue is NOT a turn. It makes ONE model call with toolChoice "none"
// and no tools array against the conversation the finished turn already
// stored, then appends the result to the message in place. It never goes
// through runAdvance, so no counter advances, no chapter closes, the world
// does not tick, the floor does not move and initiative does not pass. Only
// the prose grows.

export type ContinueResult = { message: CampaignMessage } | { error: string; status: number };

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

export async function runContinueScene(input: {
  campaignId: string;
  messageId: string;
}): Promise<ContinueResult> {
  const campaign = getCampaignById(input.campaignId);
  if (!campaign) {
    return { error: "Campaign not found.", status: 404 };
  }
  const message = getCampaignMessage(input.messageId);
  if (!message || message.campaignId !== input.campaignId) {
    return { error: "Message not found.", status: 404 };
  }
  if (message.authorType !== "dm") {
    return { error: "Only DM narration can be continued.", status: 400 };
  }
  // Continuing anything but the newest narration would grow a message the
  // story has already moved past, so the extension would read as a flashback
  // spliced into the middle of the transcript.
  const latest = getLatestDmMessage(input.campaignId);
  if (!latest || latest.id !== message.id) {
    return { error: "Only the latest narration can be continued.", status: 400 };
  }
  if (!message.dmTurnId) {
    return {
      error: "This narration predates scene continues; there is no turn to replay.",
      status: 400,
    };
  }
  const turn = getDmTurn(message.dmTurnId);
  if (!turn || turn.campaignId !== input.campaignId) {
    return { error: "The turn behind this narration is gone.", status: 400 };
  }
  if (!turn.conversation.length) {
    return { error: "This narration has no stored conversation to replay.", status: 400 };
  }

  const currentTake = extractFinalTake(turn.narrationParts, turn.rollIds, message.content);
  const prompt = buildContinueMessages(turn.conversation, currentTake);

  let continuation = "";
  let failure = "";
  await enqueueDmJob(input.campaignId, async () => {
    setDmStatus(input.campaignId, "narrating");
    try {
      const { message: reply, error } = await requestDmMessage(campaign.settings, prompt, {
        // No tools at all on top of toolChoice "none": a continuation that
        // called a tool would resolve mechanics outside any turn.
        toolChoice: "none",
      });
      if (error) {
        failure = "The model is unavailable; try again shortly.";
        return;
      }
      continuation = stripToolText(extractStoryText(reply?.content)).trim();
    } finally {
      setDmStatus(input.campaignId, "idle");
    }
  });

  if (failure) {
    return { error: failure, status: 502 };
  }
  if (!continuation) {
    return { error: "The DM returned nothing; try again.", status: 502 };
  }

  // Re-read after the model call: the message may have moved on while the
  // model was working (a reroll, a lore-check rewrite, a double-tapped
  // continue).
  const current = getCampaignMessage(input.messageId);
  if (!current || current.campaignId !== input.campaignId) {
    return { error: "Message not found.", status: 404 };
  }
  const variants = seedVariants(current.variants ?? [], current.content);
  const index = resolveVariantIndex(variants, current.variantIndex ?? 0);
  if (index < 0) {
    return { error: "Could not find the take to continue.", status: 500 };
  }
  const freshTake = extractFinalTake(turn.narrationParts, turn.rollIds, variants[index]);
  const merged = mergeContinuation(freshTake, continuation);
  if (!merged.appended) {
    return { error: merged.reason ?? "Nothing to add.", status: 409 };
  }

  const content = assembleVariantContent(turn.narrationParts, turn.rollIds, merged.take);
  const updated = setMessageVariants(
    input.messageId,
    replaceSelectedVariant(variants, index, content),
    index,
  );
  if (!updated) {
    return { error: "Could not store the continuation.", status: 500 };
  }
  refreshNarrationAudio(campaign, updated);
  return { message: updated };
}
