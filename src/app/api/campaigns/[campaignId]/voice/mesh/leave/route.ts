import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { meshLeave } from "@/lib/voice/mesh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// requireMember, not the voice gate, for the same reason as the SFU's leave:
// hanging up must still work after voice was switched off mid-call.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  meshLeave(campaignId, context.user.id);
  return Response.json({ ok: true });
}
