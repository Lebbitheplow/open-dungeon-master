import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { getAuditEntry } from "@/lib/db/sheet-audit";
import { revertAuditEntry, undoConflictWarnings } from "@/lib/sheet-undo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Party lead undoes one audited sheet change. If newer changes touched the
// same fields, respond 409 with warnings first; the client retries with
// confirm: true and the restore wins (field-level, last write wins).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; entryId: string }> },
) {
  const { campaignId, entryId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const entry = getAuditEntry(entryId);
  if (!entry || entry.campaignId !== campaignId) {
    return Response.json({ error: "Audit entry not found." }, { status: 404 });
  }
  if (entry.revertedAt) {
    return Response.json({ error: "That change was already undone." }, { status: 400 });
  }
  if (!entry.undoable) {
    return Response.json({ error: "That change predates undo support." }, { status: 400 });
  }

  const raw = await request.json().catch(() => ({}));
  const confirm = raw?.confirm === true;
  const warnings = undoConflictWarnings(entry);
  if (warnings.length && !confirm) {
    return Response.json({ warnings }, { status: 409 });
  }

  const outcome = revertAuditEntry(context.campaign, entry);
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: 400 });
  }
  return Response.json({ ok: true, sheet: outcome.sheet });
}
