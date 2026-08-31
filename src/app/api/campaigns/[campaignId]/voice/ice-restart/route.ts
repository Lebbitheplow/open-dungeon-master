import { z } from "zod";
import { isErrorResponse } from "@/lib/campaign-api";
import { requireVoiceMember } from "@/lib/voice/gate";
import { findPeer, restartIce } from "@/lib/voice/peers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  transportId: z.string().min(1),
});

// Recovering a connection that dropped without the peer going away: a laptop
// waking from sleep, a phone moving from wifi to mobile data, a NAT rebinding
// underneath a long session.
//
// ICE restart renegotiates the candidate pair on the existing transport, so
// the producer, the consumers and the peer's place in the room all survive.
// Tearing down and rejoining would work too, but it would drop the call for a
// hiccup that lasts a second.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireVoiceMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Malformed ICE restart." }, { status: 400 });
  }
  const peer = findPeer(campaignId, context.user.id);
  if (!peer) {
    return Response.json({ error: "You are not on the call." }, { status: 409 });
  }
  const iceParameters = await restartIce(peer, parsed.data.transportId);
  if (!iceParameters) {
    return Response.json({ error: "Unknown transport." }, { status: 404 });
  }
  return Response.json({ iceParameters });
}
