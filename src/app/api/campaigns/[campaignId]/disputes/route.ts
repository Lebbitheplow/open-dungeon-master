import { z } from "zod";
import { capsFor, isErrorResponse, requireMember, requireVoice } from "@/lib/campaign-api";
import { allocateSeq } from "@/lib/db/campaigns";
import { insertDispute, listOpenDisputes, openDisputeForMessage, publicDispute } from "@/lib/db/disputes";
import { getCampaignMessage } from "@/lib/db/messages";
import { DISPUTE_REASON_MAX, disputeRefusal } from "@/lib/dm/dispute-logic";
import { narratorIsAi } from "@/lib/dm/viewer";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Disputed rulings (src/lib/dm/dispute-logic.ts). Open ones are party
// knowledge: everyone sees who objected and to what.
export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ disputes: listOpenDisputes(campaignId).map(publicDispute) });
}

const raiseSchema = z.object({
  messageId: z.string().trim().min(1).max(80),
  reason: z.string().trim().max(DISPUTE_REASON_MAX).default(""),
});

// A player flags a passage the AI narrated. Whoever steers the story
// answers it (the dispute route beside this one).
export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireVoice(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = raiseSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Say which passage, in a few words." }, { status: 400 });
  }
  const message = getCampaignMessage(parsed.data.messageId);
  const refusal = disputeRefusal({
    narratorIsAi: narratorIsAi(context.campaign.gameSettings.dmMode),
    message: message && message.campaignId === campaignId ? message : null,
    raiserSteersStory: capsFor(context).steersStory,
    alreadyOpen: openDisputeForMessage(campaignId, parsed.data.messageId) !== null,
  });
  if (refusal) {
    return Response.json({ error: refusal }, { status: 400 });
  }
  const dispute = insertDispute({
    campaignId,
    messageId: parsed.data.messageId,
    raisedByUserId: context.user.id,
    reason: parsed.data.reason,
    seq: allocateSeq(campaignId),
  });
  publishPersisted(campaignId, "ruling_disputed", { dispute: publicDispute(dispute) });
  return Response.json({ dispute: publicDispute(dispute) }, { status: 201 });
}
