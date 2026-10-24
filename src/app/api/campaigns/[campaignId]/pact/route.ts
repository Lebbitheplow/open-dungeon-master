import { isErrorResponse, requireMember, seesStorytellerSecrets } from "@/lib/campaign-api";
import { pactsForPlayer, pactsForStoryteller } from "@/lib/dm/pact-players";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: the pacts this member's own characters are in (issue 503 Phase 7):
// who is in it, who leads, what it plans and when, and that character's own
// secret actions, never another player's. Whoever runs the story reads every
// pact; the lead of an AI table reads only their own character's, like any
// player. An agent reads it the same way (odm_get_pact).
export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({
    pacts: pactsForPlayer(context.campaign, context.user.id),
    ...(seesStorytellerSecrets(context) ? { all: pactsForStoryteller(context.campaign) } : {}),
  });
}
