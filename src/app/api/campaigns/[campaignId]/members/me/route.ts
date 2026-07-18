import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { setMemberRealDice, listMembers } from "@/lib/db/campaigns";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchMeSchema = z.object({
  useRealDice: z.boolean(),
});

// Per-member preferences (currently: physical dice opt-in).
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

  setMemberRealDice(campaignId, context.user.id, parsed.data.useRealDice);
  const member = listMembers(campaignId).find((entry) => entry.userId === context.user.id);
  publishPersisted(campaignId, "member_updated", { member });
  return Response.json({ member });
}
