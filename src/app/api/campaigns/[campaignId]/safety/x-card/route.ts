import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { raiseXCard, xCardRaised } from "@/lib/dm/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Any member raises the X-card (docs/vtt-parity-implementation-plan.md
// 9.1). No body, no confirmation, and the event carries no name.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!context.campaign.gameSettings.safety.xCard) {
    return Response.json({ error: "This table does not use the X-card." }, { status: 400 });
  }
  if (xCardRaised(campaignId)) {
    return Response.json({ ok: true, already: true });
  }
  raiseXCard(campaignId);
  return Response.json({ ok: true });
}
