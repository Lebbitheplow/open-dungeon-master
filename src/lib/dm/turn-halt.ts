import { DM_HALTED_PREFIX } from "@/lib/campaign-types";
import { allocateSeq, getCampaignById } from "@/lib/db/campaigns";
import { createDmTurn, getAwaitingTurn, getDmTurn, saveDmTurn, type DmTurn } from "@/lib/db/dm-turns";
import { insertCampaignMessage } from "@/lib/db/messages";
import { runOutsideDmJob, type DmJobControl } from "@/lib/dm/job-control";
import { takeNarrationSeq } from "@/lib/dm/narration-slot";
import { setDmStatus } from "@/lib/dm/status";
import { publishEphemeral, publishWithSeq } from "@/lib/events";

// A turn that could not finish: the "DM ran into a problem" notice, and the
// row parked as failed with its conversation intact. `claimed` is the place
// a player's reply made the narration take, when one did
// (src/lib/dm/narration-slot.ts). Also what a starting server writes for a
// turn the last process was running when it stopped
// (src/lib/dm/restart-recovery.ts), and what the queue writes for a turn it
// stopped (src/lib/dm/queue.ts).
export function haltDmTurn(campaignId: string, turn: DmTurn, failed: string, claimed: number | null = null) {
  const seq = claimed ?? allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    glyph: "cue-bell",
    content: `${DM_HALTED_PREFIX}${failed}`,
    // Link the notice to the halted turn so the lead can retry it from its
    // persisted conversation (src/lib/dm/retry-turn.ts) instead of retyping
    // the action, which would duplicate it in the transcript.
    dmTurnId: turn.id,
  });
  publishWithSeq(campaignId, claimed === null ? seq : allocateSeq(campaignId), "message_added", { message });
  setDmStatus(campaignId, "idle");
  turn.status = "failed";
  saveDmTurn(turn);
}

// The whole conversation of a turn that stopped before it had a prompt
// (issue #383). There is nothing to replay, so Retry starts the turn over
// (src/lib/dm/retry-turn.ts); the row exists so the notice can carry the
// link the Retry button reads, as every other halted turn's does.
export const UNBUILT_TURN_MARK = "[odm:turn-not-built]";

export function isUnbuiltTurn(turn: Pick<DmTurn, "conversation">): boolean {
  return turn.conversation.length === 1 && turn.conversation[0]?.content === UNBUILT_TURN_MARK;
}

export function haltUnbuiltTurn(campaignId: string, reason: string): DmTurn {
  const turn = createDmTurn(campaignId, [{ role: "user", content: UNBUILT_TURN_MARK }]);
  haltDmTurn(campaignId, turn, reason);
  return turn;
}

// A job the queue stopped and then gave up waiting on (src/lib/dm/queue.ts):
// it never unwound, so nothing it would have written on the way out was
// written. A turn gets the notice and the Retry its failure would have
// written; any other job only lets go of the status line it held.
export function haltAbandonedJob(control: DmJobControl): void {
  runOutsideDmJob(() => {
    const { campaignId } = control;
    const reason = control.stopReason ?? "the turn stopped answering.";
    if (control.kind === "turn" && getCampaignById(campaignId)?.status === "active") {
      const turn = control.turnId ? getDmTurn(control.turnId) : null;
      if (turn) {
        if (turn.status === "running") {
          const claimed = takeNarrationSeq(campaignId, turn.id);
          // The draft bubble held what the stopped call had streamed; it
          // goes, as the notice takes the narration's place.
          publishEphemeral(campaignId, "dm_draft_reset", {});
          haltDmTurn(campaignId, turn, reason, claimed);
        }
      } else {
        haltUnbuiltTurn(campaignId, reason);
      }
    }
    setDmStatus(campaignId, getAwaitingTurn(campaignId) ? "awaiting_rolls" : "idle");
  });
}
