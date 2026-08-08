import { z } from "zod";
import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { requestTurnRetry } from "@/lib/dm/retry-turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Retry a halted DM turn: re-enters the turn from its persisted conversation
// so the party's action is not consumed twice. Lead only, like every other
// story-steering control; the eligibility and race guards live in
// src/lib/dm/retry-turn.ts so they are shared by any future caller.

const retrySchema = z.object({
  turnId: z.string().min(1).max(80),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = retrySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid retry request." }, { status: 400 });
  }

  const result = requestTurnRetry({ campaignId, turnId: parsed.data.turnId });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true, turnId: result.turnId });
}
