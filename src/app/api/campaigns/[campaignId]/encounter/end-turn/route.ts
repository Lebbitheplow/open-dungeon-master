import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { endOwnTurn } from "@/lib/dm/encounter-tools";
import { requestDmTurn } from "@/lib/dm/loop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The current player ends their own combat turn. Attacks no longer advance
// the initiative by themselves (movement and bonus actions stay open), so
// this button is the player's reliable way to say "done"; the DM wakes so
// intervening enemies and companions still act.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!endOwnTurn(campaignId, context.user.id)) {
    return Response.json({ error: "It is not your combat turn." }, { status: 409 });
  }
  requestDmTurn(campaignId);
  return Response.json({ ok: true });
}
