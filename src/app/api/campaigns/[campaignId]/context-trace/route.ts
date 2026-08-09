import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { getLatestDmTurnId, getDmTurn } from "@/lib/db/dm-turns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What the DM was actually sent last turn, block by block.
//
// Lead only, and not because the numbers are sensitive: the trace is derived
// from the assembled prompt, which carries DM-only facts that are deliberate
// spoilers (knownBy scoping in src/lib/db/facts.ts) and the secret story arc.
// Even reporting a block's token count reveals whether a spoiler block
// existed, so the whole route stays behind the lead gate.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const turnId = getLatestDmTurnId(campaignId);
  const turn = turnId ? getDmTurn(turnId) : null;
  // A campaign that has not taken a turn yet is not an error; the panel shows
  // an empty state rather than a failure.
  if (!turn || !turn.contextTrace) {
    return Response.json({ trace: null, turnId: turnId ?? null });
  }
  return Response.json({ trace: turn.contextTrace, turnId: turn.id, at: turn.updatedAt });
}
