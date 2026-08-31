import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { applyAudibility } from "@/lib/voice/apply";
import { leaveRoom, publishRoster } from "@/lib/voice/peers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hanging up. Deliberately requireMember rather than requireVoiceMember: if
// the table switched voice off while somebody was connected, they still need
// to be able to leave, and a 403 here would strand their peer until the ICE
// timeout reaped it.
//
// Also the target of a sendBeacon on page unload, which is the fast path for
// cleanup. The slow, reliable path is the transport's own ICE timeout
// (src/lib/voice/peers.ts), because a beacon is best-effort and a crashed tab
// sends nothing at all.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const left = leaveRoom(campaignId, context.user.id);
  if (left) {
    await applyAudibility(campaignId);
    publishRoster(campaignId);
  }
  return Response.json({ ok: true });
}
