import { z } from "zod";
import type { RtpCapabilities } from "mediasoup/types";
import { isErrorResponse } from "@/lib/campaign-api";
import { requireVoiceMember } from "@/lib/voice/gate";
import { applyAudibility } from "@/lib/voice/apply";
import { consumeOthers, findPeer } from "@/lib/voice/peers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  rtpCapabilities: z.record(z.string(), z.unknown()),
});

// Subscribes to everyone this peer is not already hearing, rather than to one
// named producer. The client calls it on join and again on every roster
// change, so making it "catch me up" instead of "give me exactly this one"
// means a dropped event self-heals on the next call.
//
// The consumers come back paused; the client resumes them through /resume once
// it has handled them.
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
    return Response.json({ error: "Malformed consume request." }, { status: 400 });
  }
  const peer = findPeer(campaignId, context.user.id);
  if (!peer) {
    return Response.json({ error: "You are not on the call." }, { status: 409 });
  }
  // The matrix has to be current before new consumers are handed out, or a
  // caller could be told to subscribe to somebody they are not allowed to
  // hear and the pause would arrive a beat later.
  await applyAudibility(campaignId);
  const consumers = await consumeOthers(
    campaignId,
    peer,
    parsed.data.rtpCapabilities as unknown as RtpCapabilities,
  );
  return Response.json({ consumers });
}
