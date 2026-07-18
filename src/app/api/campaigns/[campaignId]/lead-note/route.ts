import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { LEAD_NOTE_PREFIX } from "@/lib/campaign-types";
import { allocateSeq } from "@/lib/db/campaigns";
import { insertCampaignMessage } from "@/lib/db/messages";
import { requestDmTurn } from "@/lib/dm/loop";
import { publishWithSeq } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Party lead story steering: inject a plot event or table direction the AI
// DM must weave into the story. Optionally wakes the DM immediately.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (context.campaign.status !== "active") {
    return Response.json({ error: "The campaign is not active." }, { status: 409 });
  }

  const raw = await request.json().catch(() => ({}));
  const content = typeof raw?.content === "string" ? raw.content.trim().slice(0, 1000) : "";
  if (!content) {
    return Response.json({ error: "Write the direction first." }, { status: 400 });
  }
  const wake = raw?.wake !== false;

  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    userId: context.user.id,
    content: `${LEAD_NOTE_PREFIX}${content}`,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });

  if (wake) {
    requestDmTurn(campaignId);
  }

  return Response.json({ message }, { status: 201 });
}
