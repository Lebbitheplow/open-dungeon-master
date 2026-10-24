import { capsFor, isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { getLatestDmTurnId, getDmTurn } from "@/lib/db/dm-turns";
import { traceForViewer } from "@/lib/dm/context-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What the DM was actually sent last turn, block by block.
//
// Lead only, and not because the numbers are sensitive: the trace is derived
// from the assembled prompt, which carries DM-only facts that are deliberate
// spoilers (knownBy scoping in src/lib/db/facts.ts) and the secret story arc.
// Even reporting a block's token count reveals whether a spoiler block
// existed, so the whole route stays behind the lead gate. For the same
// reason the storyteller's own section (an NPC's act, who is open to
// advances) is cut out of it, row and tokens, for the lead who steers an AI
// table: they play a character it is kept from (src/lib/dm/viewer.ts).

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
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
  return Response.json({ trace: traceForViewer(turn.contextTrace, capsFor(context)), turnId: turn.id, at: turn.updatedAt });
}
