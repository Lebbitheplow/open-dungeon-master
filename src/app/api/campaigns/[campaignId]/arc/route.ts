import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { getCampaignById } from "@/lib/db/campaigns";
import { generateStoryArc } from "@/lib/dm/arc";
import { enqueueDmJob } from "@/lib/dm/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The DM's secret story arc. Lead-only on both verbs: the arc is the spine
// the AI steers by and players must never see it (publicCampaign strips it
// from every campaign payload for the same reason).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }
  return Response.json({ arc: campaign.storyArc, dmOutline: campaign.dmOutline });
}

// Party lead: throw the arc away and generate a fresh one from the current
// premise/outline. Runs on the DM queue so it never interleaves with a turn.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  enqueueDmJob(campaignId, () => generateStoryArc(campaignId, { force: true }));
  return Response.json({ ok: true }, { status: 202 });
}
