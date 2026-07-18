import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { allocateSeq, setPartyLead } from "@/lib/db/campaigns";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getUserById } from "@/lib/db/users";
import { publishPersisted, publishWithSeq } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Transfer the party lead. The current lead can hand it off; the owner can
// always reclaim or reassign it (their safety valve if a lead goes AWOL).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const { campaign, user } = context;
  if (user.id !== campaign.leadUserId && user.id !== campaign.ownerUserId) {
    return Response.json(
      { error: "Only the party lead or the owner can transfer the lead." },
      { status: 403 },
    );
  }

  const raw = await request.json().catch(() => ({}));
  const targetUserId = typeof raw?.userId === "string" ? raw.userId : "";
  const target = targetUserId ? getUserById(targetUserId) : null;
  if (!target || !setPartyLead(campaignId, target.id)) {
    return Response.json({ error: "That user is not in this campaign." }, { status: 400 });
  }

  publishPersisted(campaignId, "campaign_updated", { leadUserId: target.id });
  if (target.id !== campaign.leadUserId) {
    const seq = allocateSeq(campaignId);
    const message = insertCampaignMessage({
      campaignId,
      seq,
      authorType: "system",
      content: `${target.username} is now the party lead.`,
    });
    publishWithSeq(campaignId, seq, "message_added", { message });
  }

  return Response.json({ leadUserId: target.id });
}
