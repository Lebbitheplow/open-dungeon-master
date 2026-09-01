import { z } from "zod";
import { isErrorResponse } from "@/lib/campaign-api";
import { requireVoiceMember } from "@/lib/voice/gate";
import { MESH_SIGNAL_MAX_BYTES } from "@/lib/voice/mesh-logic";
import { meshSignal } from "@/lib/voice/mesh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Relays one opaque WebRTC signaling note (SDP or ICE candidate) to one other
// peer's mailbox. The server never parses the payload; it only checks that
// both ends hold seats and that the size is an SDP, not a payload smuggle.
const signalSchema = z.object({
  to: z.string().min(1).max(64),
  data: z.unknown(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireVoiceMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const text = await request.text();
  if (text.length > MESH_SIGNAL_MAX_BYTES) {
    return Response.json({ error: "Signal too large." }, { status: 413 });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid input." }, { status: 400 });
  }
  const parsed = signalSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input." }, { status: 400 });
  }
  if (!meshSignal(campaignId, context.user.id, parsed.data.to, parsed.data.data)) {
    return Response.json({ error: "That peer is not on the call." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
