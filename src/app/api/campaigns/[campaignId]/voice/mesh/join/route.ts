import { isErrorResponse } from "@/lib/campaign-api";
import { requireVoiceMember } from "@/lib/voice/gate";
import { MESH_HEARTBEAT_MS } from "@/lib/voice/mesh-logic";
import { meshIceServers, meshJoin } from "@/lib/voice/mesh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Takes a seat in the mesh room. The response carries everything the browser
// needs to start calling the peers already there: the roster (the newcomer
// makes the offers, so joins never glare) and the ICE servers.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireVoiceMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const peers = meshJoin(campaignId, context.user.id, context.user.username);
  return Response.json({
    peers,
    iceServers: await meshIceServers(),
    heartbeatMs: MESH_HEARTBEAT_MS,
  });
}
