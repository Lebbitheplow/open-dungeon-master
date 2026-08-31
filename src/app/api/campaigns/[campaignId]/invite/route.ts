import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { regenerateInviteCode } from "@/lib/db/campaigns";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rotate the campaign's invite code. Until now a code lived as long as the
// campaign, so one leaked screenshot meant strangers could join forever; the
// lead can now cut every old link off in one click.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const inviteCode = regenerateInviteCode(campaignId);
  if (!inviteCode) {
    return Response.json({ error: "Could not regenerate the invite code." }, { status: 500 });
  }

  publishPersisted(campaignId, "campaign_updated", { inviteCode });
  return Response.json({ inviteCode });
}
