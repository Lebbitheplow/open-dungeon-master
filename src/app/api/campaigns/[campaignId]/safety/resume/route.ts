import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { resumeAfterXCard } from "@/lib/dm/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["continue", "rewind", "reroll"]).default("continue") });

// Whoever runs the story lets the table breathe out.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid action." }, { status: 400 });
  }
  const outcome = await resumeAfterXCard(campaignId, parsed.data.action);
  if ("error" in outcome) {
    return Response.json({ ok: true, warning: outcome.error });
  }
  return Response.json({ ok: true });
}
