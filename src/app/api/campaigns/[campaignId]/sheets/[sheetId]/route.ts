import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { allocateSeq } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { patchSheetSchema } from "@/lib/schemas/sheet";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Party lead correction of ANY character's sheet, for when the AI DM gets
// a number wrong. Same clamps as self-edits, plus an audit trail entry so
// the table sees who changed what and why.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; sheetId: string }> },
) {
  const { campaignId, sheetId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const sheet = getSheetById(sheetId);
  if (!sheet || sheet.campaignId !== campaignId) {
    return Response.json({ error: "Character not found." }, { status: 404 });
  }

  const raw = await request.json().catch(() => ({}));
  const reason = typeof raw?.reason === "string" ? raw.reason.slice(0, 300) : "";
  const parsed = patchSheetSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid sheet update." },
      { status: 400 },
    );
  }

  const updated = patchSheet(sheet.id, parsed.data);
  if (!updated) {
    return Response.json({ error: "Character not found." }, { status: 404 });
  }

  const entry = insertSheetAudit({
    campaignId,
    characterId: sheet.id,
    turnId: null,
    actor: "lead",
    kind: "lead_edit",
    delta: parsed.data as Record<string, unknown>,
    reason: reason || `Corrected by ${context.user.username}`,
    seq: allocateSeq(campaignId),
  });
  publishPersisted(campaignId, "sheet_audit", { entry, characterName: sheet.name });
  publishPersisted(campaignId, "sheet_updated", { sheet: updated });

  return Response.json({ sheet: updated });
}
