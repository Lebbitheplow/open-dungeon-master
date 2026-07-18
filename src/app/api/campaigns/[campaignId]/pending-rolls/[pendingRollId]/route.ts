import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { allocateSeq } from "@/lib/db/campaigns";
import {
  getPendingRoll,
  listPendingForTurn,
  resolvePendingRoll,
} from "@/lib/db/dm-turns";
import { insertRoll } from "@/lib/db/rolls";
import { rollExpression, rollExpressionWithDice } from "@/lib/dice";
import { resumeDmTurn } from "@/lib/dm/turn";
import { enqueueDmJob } from "@/lib/dm/queue";
import { publishWithSeq } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const submitSchema = z.union([
  z.object({ dice: z.array(z.number().int().min(1).max(100)).min(1).max(120) }),
  z.object({ fallback: z.literal("digital") }),
]);

// A player (or, for the digital fallback, the owner) resolves a parked
// physical roll. When the turn has no pending rolls left, the DM resumes.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; pendingRollId: string }> },
) {
  const { campaignId, pendingRollId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const pending = getPendingRoll(pendingRollId);
  if (!pending || pending.campaignId !== campaignId) {
    return Response.json({ error: "Roll not found." }, { status: 404 });
  }
  if (pending.status !== "pending") {
    return Response.json({ error: "That roll was already resolved." }, { status: 409 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = submitSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid roll submission." }, { status: 400 });
  }

  const isFallback = "fallback" in parsed.data;
  const isRoller = pending.userId === context.user.id;
  const isOwner = context.campaign.role === "owner";
  if (isFallback ? !isRoller && !isOwner : !isRoller) {
    return Response.json({ error: "This is not your roll." }, { status: 403 });
  }

  let outcome;
  try {
    outcome = isFallback
      ? rollExpression(pending.expression)
      : rollExpressionWithDice(pending.expression, (parsed.data as { dice: number[] }).dice);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid dice values." },
      { status: 400 },
    );
  }

  const roll = insertRoll({
    campaignId,
    characterId: pending.characterId,
    requestedBy: "player",
    kind: pending.kind,
    detail: isFallback ? pending.detail : `${pending.detail || pending.kind} (physical)`.trim(),
    advantage: pending.advantage,
    dc: pending.dc,
    result: outcome,
  });

  const resolved = resolvePendingRoll(
    pendingRollId,
    isFallback ? "fallback" : "submitted",
    roll.id,
  );
  if (!resolved) {
    return Response.json({ error: "That roll was already resolved." }, { status: 409 });
  }

  publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", {
    roll,
    pendingRollId,
  });

  const remaining = listPendingForTurn(pending.turnId).filter(
    (entry) => entry.status === "pending",
  );
  if (!remaining.length) {
    enqueueDmJob(campaignId, () => resumeDmTurn(campaignId, pending.turnId));
  }

  return Response.json({ roll });
}
