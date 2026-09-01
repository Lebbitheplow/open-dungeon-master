import { z } from "zod";
import { isErrorResponse } from "@/lib/campaign-api";
import { requireVoiceMember } from "@/lib/voice/gate";
import { meshSetState } from "@/lib/voice/mesh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stateSchema = z.object({
  muted: z.boolean().optional(),
  sayRange: z.enum(["whisper", "normal", "shout"]).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireVoiceMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = stateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid input." }, { status: 400 });
  }
  if (!meshSetState(campaignId, context.user.id, parsed.data)) {
    return Response.json({ error: "Not on the call anymore." }, { status: 410 });
  }
  return Response.json({ ok: true });
}
