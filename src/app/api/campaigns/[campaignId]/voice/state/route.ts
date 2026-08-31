import { z } from "zod";
import { isErrorResponse } from "@/lib/campaign-api";
import { requireVoiceMember } from "@/lib/voice/gate";
import { applyAudibility } from "@/lib/voice/apply";
import { findPeer, publishRoster, setMuted, setSayRange } from "@/lib/voice/peers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  muted: z.boolean().optional(),
  // How far this peer's voice carries, when the say-range rule is on.
  sayRange: z.enum(["whisper", "normal", "shout"]).optional(),
});

// The peer's own mic switch. Enforced by pausing the producer server-side, so
// a mute means the audio never leaves this browser's uplink, rather than being
// dropped at the listeners where it would already have been transmitted.
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
    return Response.json({ error: "Malformed state change." }, { status: 400 });
  }
  const peer = findPeer(campaignId, context.user.id);
  if (!peer) {
    return Response.json({ error: "You are not on the call." }, { status: 409 });
  }
  if (parsed.data.muted !== undefined) {
    await setMuted(peer, parsed.data.muted);
  }
  if (parsed.data.sayRange) {
    setSayRange(peer, parsed.data.sayRange);
    // Range is a speaker-side input to the audibility rules, so changing it
    // has to recompute who can hear them.
    await applyAudibility(campaignId);
  }
  publishRoster(campaignId);
  return Response.json({ ok: true, muted: peer.muted, sayRange: peer.sayRange });
}
