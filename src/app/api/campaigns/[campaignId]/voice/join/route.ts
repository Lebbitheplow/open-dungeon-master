import { isErrorResponse } from "@/lib/campaign-api";
import { requireVoiceMember } from "@/lib/voice/gate";
import { joinRoom, publishRoster, roster } from "@/lib/voice/peers";
import { getOrCreateRoom } from "@/lib/voice/room";
import { applyAudibility } from "@/lib/voice/apply";
import { applyVoiceFloor } from "@/lib/voice/turns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Creates the peer and BOTH transports in one call. mediasoup needs a send and
// a receive transport per peer, and splitting them into two round trips buys
// nothing except a window where a peer exists with half its plumbing.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireVoiceMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  try {
    // The room has to exist before the router capabilities can be read, and
    // joinRoom creates it; this is the same call, so it is already warm.
    const room = await getOrCreateRoom(campaignId);
    const { send, recv } = await joinRoom(campaignId, context.user.id, context.user.username);
    // Somebody joining mid-hold has to arrive already silenced, rather than
    // waiting for the next floor change to catch them.
    await applyVoiceFloor(campaignId);
    await applyAudibility(campaignId);
    publishRoster(campaignId);
    return Response.json({
      routerRtpCapabilities: room.router.rtpCapabilities,
      sendTransport: send,
      recvTransport: recv,
      peers: roster(room),
    });
  } catch (error) {
    // Almost always the media port: taken, blocked, or the worker binary
    // missing from the build. Worth logging loudly because the browser-side
    // symptom is indistinguishable from a network problem.
    console.error("[voice] join failed", error);
    return Response.json(
      { error: "Voice chat could not start on this server." },
      { status: 500 },
    );
  }
}
