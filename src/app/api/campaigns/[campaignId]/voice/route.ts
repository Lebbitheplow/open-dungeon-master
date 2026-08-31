import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { voiceAvailability } from "@/lib/voice/gate";
import { roster } from "@/lib/voice/peers";
import { getRoom } from "@/lib/voice/room";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The state a client needs before it decides whether to offer a Join button.
// Uses requireMember rather than requireVoiceMember on purpose: when voice is
// switched off this still has to answer, so the UI can say why instead of
// showing a control that would never connect.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const availability = voiceAvailability(context.campaign);
  const room = getRoom(campaignId);
  return Response.json({
    available: availability.available,
    unavailableReason: availability.reason,
    // Whether this caller already holds a peer, so a remount (or a second tab)
    // can tell "nobody is on the call" from "you are on the call".
    joined: Boolean(room?.peers.has(context.user.id)),
    peers: roster(room),
  });
}
