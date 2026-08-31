import { z } from "zod";
import { isErrorResponse } from "@/lib/campaign-api";
import { requireVoiceMember } from "@/lib/voice/gate";
import { findPeer, resumeConsumers } from "@/lib/voice/peers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  consumerIds: z.array(z.string().min(1)).max(64),
});

// Consumers are created paused (see the consume route) and resumed here, once
// the client has built its side of them. Resuming any earlier loses the first
// packets of whatever the other person was saying.
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
    return Response.json({ error: "Malformed resume request." }, { status: 400 });
  }
  const peer = findPeer(campaignId, context.user.id);
  if (!peer) {
    return Response.json({ error: "You are not on the call." }, { status: 409 });
  }
  // Only this peer's own consumers are reachable from here, so the ids cannot
  // be used to resume anything belonging to somebody else.
  await resumeConsumers(campaignId, peer, parsed.data.consumerIds);
  return Response.json({ ok: true });
}
