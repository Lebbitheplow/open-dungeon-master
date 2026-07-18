import { z } from "zod";
import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { listAuditForTurn } from "@/lib/db/sheet-audit";
import { revertAuditEntry, undoConflictWarnings } from "@/lib/sheet-undo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  turnId: z.string().min(1).max(80),
  confirm: z.boolean().optional(),
});

// Party lead reverts every live sheet change from one DM turn, newest
// first, so each field lands back on its pre-turn value.
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
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid revert request." }, { status: 400 });
  }
  const { turnId, confirm } = parsed.data;

  const entries = listAuditForTurn(campaignId, turnId).filter(
    (entry) => entry.undoable && entry.kind !== "undo",
  );
  if (!entries.length) {
    return Response.json({ error: "Nothing left to revert for that turn." }, { status: 400 });
  }

  // Changes recorded after this turn conflict; changes inside it are being
  // reverted anyway, so they are ignored.
  const warnings = entries.flatMap((entry) => undoConflictWarnings(entry, turnId));
  if (warnings.length && !confirm) {
    return Response.json({ warnings: [...new Set(warnings)] }, { status: 409 });
  }

  const errors: string[] = [];
  for (const entry of [...entries].sort((a, b) => b.seq - a.seq)) {
    const outcome = revertAuditEntry(context.campaign, entry);
    if (!outcome.ok) {
      errors.push(outcome.error);
    }
  }
  if (errors.length === entries.length) {
    return Response.json({ error: errors[0] }, { status: 400 });
  }
  return Response.json({ ok: true, reverted: entries.length - errors.length });
}
