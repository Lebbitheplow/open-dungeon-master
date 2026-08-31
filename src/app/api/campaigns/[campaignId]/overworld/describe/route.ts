import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { describeOverworld } from "@/lib/dm/overworld-describe";
import { trackUtilityCall } from "@/lib/dm/call-tracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "A chain of islands off a storm coast" in, generator dials and a handful
// of place names out. Writes nothing: the answer is a suggestion the DM then
// previews, rerolls against, and only then applies.
const describeSchema = z.object({
  description: z.string().trim().min(3).max(1_000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = describeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Describe the region first." }, { status: 400 });
  }
  const outcome = await trackUtilityCall(campaignId, "map", () =>
    describeOverworld(context.campaign, parsed.data.description),
  );
  return "error" in outcome
    ? Response.json({ error: outcome.error }, { status: 409 })
    : Response.json({ plan: outcome.plan });
}
