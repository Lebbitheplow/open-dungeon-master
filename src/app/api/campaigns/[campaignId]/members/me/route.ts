import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { listMembers, setMemberHoldRolls, setMemberRealDice } from "@/lib/db/campaigns";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchMeSchema = z
  .object({
    useRealDice: z.boolean().optional(),
    // Shake to roll: park every roll for this player to release. Not gated
    // by the dice policy because the server still draws the numbers.
    holdRolls: z.boolean().optional(),
  })
  .refine((data) => data.useRealDice !== undefined || data.holdRolls !== undefined);

// Per-member preferences: physical dice opt-in and hold-my-rolls.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = patchMeSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid member update." }, { status: 400 });
  }

  if (context.campaign.gameSettings.dicePolicy !== "real_allowed" && parsed.data.useRealDice) {
    return Response.json(
      { error: "This campaign does not allow physical dice." },
      { status: 400 },
    );
  }

  if (parsed.data.useRealDice !== undefined) {
    setMemberRealDice(campaignId, context.user.id, parsed.data.useRealDice);
  }
  if (parsed.data.holdRolls !== undefined) {
    setMemberHoldRolls(campaignId, context.user.id, parsed.data.holdRolls);
  }
  const member = listMembers(campaignId).find((entry) => entry.userId === context.user.id);
  publishPersisted(campaignId, "member_updated", { member });
  return Response.json({ member });
}
