import { z } from "zod";
import { isErrorResponse } from "@/lib/campaign-api";
import { requireVoiceMember } from "@/lib/voice/gate";
import { findPeer, publishRoster, setHandRaised } from "@/lib/voice/peers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  raised: z.boolean(),
});

// Asking for the floor without talking over whoever holds it. Deliberately
// only a request: it never moves the floor by itself. The DM grants it through
// the floor controls they already have, so there is one way the floor changes
// rather than two (src/lib/voice/turn-logic.ts).
//
// The hand comes down by itself when its owner is given the floor, which is
// handled server-side in applyVoiceFloor.
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
    return Response.json({ error: "Malformed hand request." }, { status: 400 });
  }
  const peer = findPeer(campaignId, context.user.id);
  if (!peer) {
    return Response.json({ error: "You are not on the call." }, { status: 409 });
  }
  setHandRaised(peer, parsed.data.raised);
  publishRoster(campaignId);
  return Response.json({ ok: true, handRaisedAt: peer.handRaisedAt });
}
