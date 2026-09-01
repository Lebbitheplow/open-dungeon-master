import { isErrorResponse } from "@/lib/campaign-api";
import { requireVoiceMember } from "@/lib/voice/gate";
import { meshHeartbeat } from "@/lib/voice/mesh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness and mail in one round trip: refreshes this peer's seat and drains
// their signal mailbox. 410 tells a client whose seat was reaped (laptop
// slept too long) to rejoin rather than heartbeat into the void.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireVoiceMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const signals = meshHeartbeat(campaignId, context.user.id);
  if (signals === null) {
    return Response.json({ error: "Not on the call anymore." }, { status: 410 });
  }
  return Response.json({ signals });
}
