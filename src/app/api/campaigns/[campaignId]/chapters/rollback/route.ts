import { z } from "zod";
import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { computeRollbackScope, performRollback, warningsForRollback } from "@/lib/dm/rollback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  chapterIndex: z.number().int().min(1),
  confirm: z.boolean().default(false),
});

// Party lead: rewind the campaign to the start of a chapter. Without
// confirm the response is a 409 carrying the consequences, mirroring the
// sheet-undo confirm flow; the client re-POSTs with confirm: true.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid rewind request." }, { status: 400 });
  }
  const { chapterIndex, confirm } = parsed.data;

  const scope = computeRollbackScope(campaignId, chapterIndex);
  if (!scope) {
    return Response.json(
      { error: "No rewind point exists for that chapter." },
      { status: 404 },
    );
  }
  const warnings = warningsForRollback(scope);
  if (!confirm) {
    return Response.json({ warnings }, { status: 409 });
  }

  const result = await performRollback(campaignId, chapterIndex);
  if (!result.ok) {
    return Response.json(
      { error: result.error ?? "The rewind failed." },
      { status: 500 },
    );
  }
  return Response.json({ ok: true });
}
