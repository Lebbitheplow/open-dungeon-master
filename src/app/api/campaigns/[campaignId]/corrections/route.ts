import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { CORRECTION_REASONS } from "@/lib/correction-reasons";
import { setCorrectionReason } from "@/lib/db/turn-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The reason chip (issue #460): after a fix is made, its maker may say why
// with one tap, or not at all. The fix never waits on this. Only the rows
// the caller made in this campaign change; anything else is left alone.

const bodySchema = z.object({
  ids: z.array(z.string().min(1).max(80)).min(1).max(200),
  reason: z.enum(CORRECTION_REASONS),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Name the fixes and one reason." }, { status: 400 });
  }
  const changed = setCorrectionReason(campaignId, context.user.id, parsed.data.ids, parsed.data.reason);
  return Response.json({ ok: true, changed });
}
