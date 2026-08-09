import { getCampaignById } from "@/lib/db/campaigns";
import {
  claimFailedDmTurn,
  getAwaitingTurn,
  getDmTurn,
  getLatestDmTurnId,
  listPendingForTurn,
  saveDmTurn,
  type DmTurn,
  type PendingRoll,
} from "@/lib/db/dm-turns";
import { clearMessageDmTurn, findMessageForDmTurn } from "@/lib/db/messages";
import { getRoll } from "@/lib/db/rolls";
import { publishPersisted } from "@/lib/events";
import { enqueueDmJob } from "@/lib/dm/queue";
import { setDmStatus } from "@/lib/dm/status";
import { fakeRollMarkerRegex } from "@/lib/dm/tool-text";
import { MAX_MODEL_CALLS, reenterDmTurn } from "@/lib/dm/turn";
import {
  assistantTextOf,
  checkRetryEligible,
  danglingToolCallIds,
  retryCallIndex,
  rewindHaltedCall,
} from "@/lib/dm/retry-turn-logic";

// Retrying a halted DM turn. When a turn throws, finalize() writes the
// "DM ran into a problem" notice and parks the row at status 'failed' with
// its whole conversation intact: system prompt, game state, every tool call
// and every tool result. The party's action is already in the transcript, so
// the fix is to re-enter THAT turn rather than ask anyone to retype anything.
//
// Whispers: a failed turn deliberately leaves the player whispers it carried
// pending (finalize() returns before markPlayerWhispersAnswered), so the next
// turn retries them. The retry reuses the same turn row, so playerWhisperIds
// and answeredWhisperCharacterIds come back with it: ensureWhisperReplies
// only chases the senders still unanswered, and finalize() only marks the
// ones that got a reply. Eligibility also refuses a turn that is no longer
// the campaign's latest, which is what stops a newer turn and a retry from
// both answering the same whisper.

// Handed to the model on re-entry. Some tools run before turn.ts echoes the
// assistant message that called them, so a crash can leave real, applied
// changes with no trace in the conversation; the model needs to know that
// rather than redo them.
const RETRY_NOTE =
  "[System] Your last attempt at this turn was interrupted by an internal error and nothing you wrote then reached the table. Pick the scene back up and narrate it now. Some bookkeeping from that attempt may already have taken effect (a move, a recorded event, a closed beat): if a tool reports something is already done, accept it and keep going rather than repeating it.";

export type RetryRequest = { campaignId: string; turnId: string };
export type RetryResult = { ok: true; turnId: string } | { ok: false; status: number; error: string };

// A tool call the halted turn never answered, where the answer is a physical
// roll the player already submitted (the crash landed between the roll
// resolving and resumeDmTurn appending it). Mirrors the payload shape
// resumeDmTurn uses so the model reads it exactly the same way.
function resolvedRollResult(
  turn: DmTurn,
  pendings: PendingRoll[],
  toolCallId: string,
): string | null {
  const pending = pendings.find(
    (entry) => entry.toolCallId === toolCallId && entry.status !== "pending" && entry.rollId,
  );
  const roll = pending?.rollId ? getRoll(pending.rollId) : null;
  if (!pending || !roll) {
    return null;
  }
  if (!turn.rollIds.includes(roll.id)) {
    turn.rollIds.push(roll.id);
  }
  return JSON.stringify({
    total: roll.total,
    dice: roll.breakdown.terms,
    ...(pending.dc !== null ? { dc: pending.dc, success: roll.total >= pending.dc } : {}),
    ...(roll.breakdown.crit ? { crit: roll.breakdown.crit } : {}),
    rolledBy: pending.status === "submitted" ? "the player, with physical dice" : "the server",
    note: "Narrate this real result. Do not roll again for the same action.",
    ...(pending.combatNote ? { combat: pending.combatNote } : {}),
  });
}

export function requestTurnRetry(request: RetryRequest): RetryResult {
  const { campaignId, turnId } = request;
  const campaign = getCampaignById(campaignId);
  const turn = getDmTurn(turnId);
  const pendings = turn ? listPendingForTurn(turnId) : [];
  const eligibility = checkRetryEligible({
    campaignId,
    campaignActive: campaign?.status === "active",
    turn,
    latestTurnId: getLatestDmTurnId(campaignId),
    openPendingRollCount: pendings.filter((entry) => entry.status === "pending").length,
  });
  if (!eligibility.ok) {
    return eligibility;
  }
  if (!campaign) {
    // Unreachable once eligibility passed; narrows the type for the job below.
    return { ok: false, status: 404, error: "Campaign not found." };
  }

  // The claim, and the only race guard that matters: two players hitting
  // Retry at the same instant both pass the checks above, but this
  // conditional UPDATE only reports changes for one of them.
  const claimed = claimFailedDmTurn(turnId);
  if (!claimed) {
    return { ok: false, status: 409, error: "That turn is already being retried." };
  }

  // Drop the notice's turn link so the banner disappears for everyone at
  // once. If this retry fails too, finalize() writes a fresh notice carrying
  // the link again, so the affordance comes back without ever going stale.
  const notice = findMessageForDmTurn(turnId);
  if (notice) {
    const updated = clearMessageDmTurn(notice.id, turnId);
    if (updated) {
      publishPersisted(campaignId, "message_updated", { message: updated });
    }
  }

  // Undo the model call the crash swallowed: its narration never reached the
  // conversation, so the retried model would otherwise write that beat twice.
  const rewind = rewindHaltedCall({
    narrationParts: claimed.narrationParts,
    callIndex: claimed.callIndex,
    assistantText: assistantTextOf(claimed.conversation).replace(fakeRollMarkerRegex(), ""),
  });
  claimed.narrationParts = rewind.narrationParts;
  // A turn that burned its whole call budget resumes at the forced-narration
  // call so the retry always produces prose instead of another tool loop.
  claimed.callIndex = retryCallIndex(rewind.callIndex, MAX_MODEL_CALLS);
  // Repair the conversation before it goes back to the model: a throw partway
  // through the tool loop can persist an assistant message whose tool_calls
  // were only partly answered, and strict OpenAI-compatible backends reject
  // that shape outright.
  for (const toolCallId of danglingToolCallIds(claimed.conversation)) {
    claimed.conversation.push({
      role: "tool",
      tool_call_id: toolCallId,
      content:
        resolvedRollResult(claimed, pendings, toolCallId) ??
        JSON.stringify({
          error:
            "The DM hit an internal error before this call finished. Do not call it again; continue from what you already have.",
        }),
    });
  }

  // Tool calls that ran before the crash are already applied (the party moved,
  // the event was recorded) but the conversation has no assistant echo of
  // them, so the model cannot see them. Say so plainly rather than let it
  // rediscover the same bookkeeping. Deduped: a second retry must not stack a
  // second copy of the note.
  const lastMessage = claimed.conversation[claimed.conversation.length - 1];
  if (lastMessage?.content !== RETRY_NOTE) {
    claimed.conversation.push({ role: "user", content: RETRY_NOTE });
  }
  saveDmTurn(claimed);

  setDmStatus(campaignId, "thinking");
  // Through the per-campaign serial queue like every other DM job, so a retry
  // can never run alongside a turn a player's action just started.
  enqueueDmJob(campaignId, async () => {
    // Re-read after the queue hands over: the row is the source of truth and
    // this job may have waited behind another. Anything that moved the turn
    // off 'running' (the stale reaper, a rollback) means the retry lost it.
    // The latest-turn test runs again here because dm_turns rows are only
    // created inside a queue job, so an action posted just before the Retry
    // click can have become a whole new turn while this one waited.
    const fresh = getDmTurn(turnId);
    const freshCampaign = getCampaignById(campaignId);
    if (
      !fresh ||
      fresh.status !== "running" ||
      freshCampaign?.status !== "active" ||
      getLatestDmTurnId(campaignId) !== turnId
    ) {
      abandonRetry(campaignId, turnId);
      return;
    }
    try {
      await reenterDmTurn(freshCampaign, fresh);
    } catch (error) {
      // advance() finalizes its own failures, so this only catches a throw
      // from building the turn context. Without it the row would sit at
      // 'running' and the table would watch a DM that never speaks.
      console.error("[dm-retry] re-entry failed", error);
      abandonRetry(campaignId, turnId);
    }
  });

  return { ok: true, turnId };
}

// Put an abandoned retry back where it found things: the turn failed (it never
// did narrate), the table not waiting on a DM that is not coming. No new
// notice is written, because the original one is still in the transcript; its
// turn link is gone, so no stale retry can be offered on a turn the story has
// passed.
function abandonRetry(campaignId: string, turnId: string) {
  const turn = getDmTurn(turnId);
  if (turn && turn.status === "running") {
    turn.status = "failed";
    saveDmTurn(turn);
  }
  // A turn parked on physical dice owns the status line; only the idle case is
  // ours to restore.
  setDmStatus(campaignId, getAwaitingTurn(campaignId) ? "awaiting_rolls" : "idle");
}
