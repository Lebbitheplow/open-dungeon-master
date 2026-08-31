import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { draftBeat } from "@/lib/dm/beats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Drafts a beat from the mechanical record of the uncaptured stretch: what the
// players typed, what the dice did, what changed on the sheets.
//
// This is the only model call a pure human-DM campaign makes, and it writes
// nothing. The draft comes back as text for the DM to edit; recording it is a
// separate, deliberate POST to ../beats.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const { campaign } = context;
  if (campaign.status !== "active") {
    return Response.json({ error: "The adventure has not started yet." }, { status: 400 });
  }

  const { draft, error } = await draftBeat(campaign);
  if (error) {
    return Response.json({ error }, { status: 409 });
  }
  return Response.json({ draft });
}
