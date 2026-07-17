import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import {
  allMembersReady,
  latestSeq,
  listMembers,
  setCampaignStatus,
} from "@/lib/db/campaigns";
import { listRecentMessages } from "@/lib/db/messages";
import { listRecentRolls } from "@/lib/db/rolls";
import { listSheets } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const { campaign, user } = context;
  return Response.json({
    campaign,
    me: { id: user.id, username: user.username },
    members: listMembers(campaignId),
    sheets: listSheets(campaignId),
    messages: listRecentMessages(campaignId, 100),
    rolls: listRecentRolls(campaignId, 20),
    latestSeq: latestSeq(campaignId),
  });
}

const patchSchema = z.object({
  status: z.enum(["active", "ended"]).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const { campaign, user } = context;
  if (campaign.ownerUserId !== user.id) {
    return Response.json({ error: "Only the campaign owner can do that." }, { status: 403 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.status) {
    return Response.json({ error: "Invalid update." }, { status: 400 });
  }

  const nextStatus = parsed.data.status;
  if (nextStatus === "active") {
    if (campaign.status !== "lobby") {
      return Response.json({ error: "Campaign has already started." }, { status: 400 });
    }
    if (!allMembersReady(campaignId)) {
      return Response.json({ error: "Everyone must ready up first." }, { status: 400 });
    }
    const sheetCount = listSheets(campaignId).length;
    const memberCount = listMembers(campaignId).length;
    if (sheetCount < memberCount) {
      return Response.json(
        { error: "Every player needs a character before the adventure starts." },
        { status: 400 },
      );
    }
  }

  setCampaignStatus(campaignId, nextStatus);
  publishPersisted(campaignId, "campaign_updated", { status: nextStatus });

  return Response.json({ ok: true, status: nextStatus });
}
