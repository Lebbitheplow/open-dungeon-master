import { isErrorResponse } from "@/lib/campaign-api";
import { gainsFor } from "@/lib/voice/apply";
import { requireVoiceMember } from "@/lib/voice/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// How loudly this caller hears each other person. Follows the same privacy
// pattern as the fogged battle map and world facts: the voice_audibility_changed
// event is contentless, and each listener pulls only their own row of the
// matrix. Broadcasting the whole thing would leak the shape of every private
// conversation at the table.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireVoiceMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ gains: gainsFor(campaignId, context.user.id) });
}
