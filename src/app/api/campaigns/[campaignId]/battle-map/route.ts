import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { buildPlayerMapView } from "@/lib/battlemap/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The caller's fogged projection of the active battle map. Per-character
// fog of war means this is always self-scoped and server-filtered; the
// shared stream carries only the contentless battle_map_updated ping.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ view: buildPlayerMapView(campaignId, context.user.id) });
}
