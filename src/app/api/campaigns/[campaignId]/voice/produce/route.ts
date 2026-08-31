import { z } from "zod";
import type { RtpParameters } from "mediasoup/types";
import { isErrorResponse } from "@/lib/campaign-api";
import { requireVoiceMember } from "@/lib/voice/gate";
import { applyAudibility } from "@/lib/voice/apply";
import { findPeer, produceAudio, publishRoster } from "@/lib/voice/peers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  transportId: z.string().min(1),
  rtpParameters: z.record(z.string(), z.unknown()),
});

// Publishes this peer's microphone. Audio only: the kind is hard-coded rather
// than taken from the request, so no client can publish video into a table
// that has no video feature.
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
    return Response.json({ error: "Malformed produce request." }, { status: 400 });
  }
  const peer = findPeer(campaignId, context.user.id);
  if (!peer) {
    return Response.json({ error: "You are not on the call." }, { status: 409 });
  }
  const producerId = await produceAudio(
    campaignId,
    peer,
    parsed.data.transportId,
    parsed.data.rtpParameters as unknown as RtpParameters,
  );
  if (!producerId) {
    return Response.json({ error: "Unknown transport." }, { status: 404 });
  }
  // A new voice at the table changes the matrix, and the recompute has to
  // happen before anyone is told to consume it.
  await applyAudibility(campaignId);
  // Everyone else needs to know there is something new to consume; their
  // clients answer this by calling /consume again, which is idempotent.
  publishRoster(campaignId);
  return Response.json({ producerId });
}
