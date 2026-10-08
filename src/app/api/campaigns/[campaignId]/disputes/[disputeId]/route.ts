import { z } from "zod";
import { capsFor, isErrorResponse, requireMember } from "@/lib/campaign-api";
import { allocateSeq, campaignSeats, listMembers } from "@/lib/db/campaigns";
import { castVote, getDispute, openVote, publicDispute, settleDispute, type RulingDispute } from "@/lib/db/disputes";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getUserById } from "@/lib/db/users";
import { disputeTranscriptLine, tallyEarly, tallyVotes } from "@/lib/dm/dispute-logic";
import { isDmSeat } from "@/lib/dm/viewer";
import { publishPersisted, publishWithSeq } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.object({
  // uphold / overrule / vote / tally: whoever steers the story.
  // cast: a member with a party slot, while the vote is open.
  // withdraw: the player who raised it.
  action: z.enum(["uphold", "overrule", "vote", "cast", "tally", "withdraw"]),
  vote: z.enum(["uphold", "overrule"]).optional(),
});

// Settling writes one system line into the transcript, so the table reads
// the outcome where the ruling was, and the narrator reads it on its next
// turn. The fix itself (undo, revert the turn) stays the steerer's call.
function settle(
  campaignId: string,
  dispute: RulingDispute,
  status: "upheld" | "overruled" | "withdrawn",
  decidedBy: string | null,
  byVote: boolean,
) {
  const settled = settleDispute(dispute.id, status, decidedBy);
  if (!settled) {
    return null;
  }
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    content: disputeTranscriptLine({
      status,
      raisedBy: getUserById(dispute.raisedByUserId)?.username ?? "A player",
      reason: dispute.reason,
      byVote,
    }),
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
  publishPersisted(campaignId, "ruling_resolved", { dispute: publicDispute(settled) });
  return settled;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; disputeId: string }> },
) {
  const { campaignId, disputeId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid action." }, { status: 400 });
  }
  const dispute = getDispute(disputeId);
  if (!dispute || dispute.campaignId !== campaignId) {
    return Response.json({ error: "Dispute not found." }, { status: 404 });
  }
  if (dispute.status !== "open" && dispute.status !== "voting") {
    return Response.json({ error: "That dispute is already settled." }, { status: 400 });
  }
  const { action, vote } = parsed.data;
  const steers = capsFor(context).steersStory;
  const seats = campaignSeats(context.campaign);

  if (action === "withdraw") {
    if (dispute.raisedByUserId !== context.user.id) {
      return Response.json({ error: "Only whoever raised it can withdraw it." }, { status: 403 });
    }
    const settled = settle(campaignId, dispute, "withdrawn", context.user.id, false);
    return settled ? Response.json({ dispute: publicDispute(settled) }) : Response.json({ error: "Already settled." }, { status: 400 });
  }

  if (action === "cast") {
    if (dispute.status !== "voting") {
      return Response.json({ error: "There is no vote open on that dispute." }, { status: 400 });
    }
    if (!vote) {
      return Response.json({ error: "Say uphold or overrule." }, { status: 400 });
    }
    const voted = castVote(disputeId, context.user.id, vote);
    if (!voted) {
      return Response.json({ error: "You have no vote on this one." }, { status: 403 });
    }
    const tally = tallyVotes(voted.votes, voted.voterIds);
    if (tally.outcome) {
      const settled = settle(campaignId, voted, tally.outcome, null, true);
      return Response.json({ dispute: publicDispute(settled ?? voted) });
    }
    publishPersisted(campaignId, "ruling_disputed", { dispute: publicDispute(voted) });
    return Response.json({ dispute: publicDispute(voted) });
  }

  if (!steers) {
    return Response.json({ error: "Only whoever steers the story can rule on that." }, { status: 403 });
  }
  if (action === "vote") {
    if (dispute.status !== "open") {
      return Response.json({ error: "The vote is already open." }, { status: 400 });
    }
    // Every seat with a party slot votes; the DM seats are who called it.
    const voterIds = listMembers(campaignId)
      .map((member) => member.userId)
      .filter((userId) => !isDmSeat(seats, userId));
    const opened = openVote(disputeId, voterIds);
    if (!opened) {
      return Response.json({ error: "Already settled." }, { status: 400 });
    }
    const tally = tallyVotes(opened.votes, opened.voterIds);
    if (tally.outcome) {
      const settled = settle(campaignId, opened, tally.outcome, context.user.id, true);
      return Response.json({ dispute: publicDispute(settled ?? opened) });
    }
    publishPersisted(campaignId, "ruling_disputed", { dispute: publicDispute(opened) });
    return Response.json({ dispute: publicDispute(opened) });
  }
  if (action === "tally") {
    if (dispute.status !== "voting") {
      return Response.json({ error: "There is no vote to count." }, { status: 400 });
    }
    const settled = settle(campaignId, dispute, tallyEarly(dispute.votes, dispute.voterIds), context.user.id, true);
    return settled ? Response.json({ dispute: publicDispute(settled) }) : Response.json({ error: "Already settled." }, { status: 400 });
  }
  const settled = settle(campaignId, dispute, action === "uphold" ? "upheld" : "overruled", context.user.id, false);
  return settled ? Response.json({ dispute: publicDispute(settled) }) : Response.json({ error: "Already settled." }, { status: 400 });
}
