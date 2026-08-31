import { z } from "zod";
import type { DtlsParameters } from "mediasoup/types";
import { isErrorResponse } from "@/lib/campaign-api";
import { requireVoiceMember } from "@/lib/voice/gate";
import { connectTransport, findPeer } from "@/lib/voice/peers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// dtlsParameters is mediasoup's own wire shape and is validated by the worker
// itself, so this only checks that the envelope is present rather than
// re-describing a structure that is not ours to define.
const schema = z.object({
  transportId: z.string().min(1),
  dtlsParameters: z.record(z.string(), z.unknown()),
});

// The DTLS handshake half of transport setup. Fired by mediasoup-client's
// "connect" event on each transport, once per transport per session.
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
    return Response.json({ error: "Malformed transport connect." }, { status: 400 });
  }
  const peer = findPeer(campaignId, context.user.id);
  if (!peer) {
    return Response.json({ error: "You are not on the call." }, { status: 409 });
  }
  // The transport id is matched against this peer's own two transports, so a
  // caller cannot connect somebody else's.
  const connected = await connectTransport(
    peer,
    parsed.data.transportId,
    parsed.data.dtlsParameters as unknown as DtlsParameters,
  );
  if (!connected) {
    return Response.json({ error: "Unknown transport." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
