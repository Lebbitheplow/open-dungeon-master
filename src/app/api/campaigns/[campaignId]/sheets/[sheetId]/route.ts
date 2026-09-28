import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { allocateSeq, campaignSeats } from "@/lib/db/campaigns";
import { coherentCorrection } from "@/lib/dm/correction-rules";
import { sheetForViewer } from "@/lib/dm/sheet-view";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { fullPatchSheetSchema } from "@/lib/schemas/sheet";
import { layOver } from "@/lib/schemas/parse-keeping-valid";
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
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const sheet = getSheetById(sheetId);
  if (!sheet || sheet.campaignId !== campaignId) {
    return Response.json({ error: "Character not found." }, { status: 404 });
  }

  const raw = await request.json().catch(() => ({}));
  const reason = typeof raw?.reason === "string" ? raw.reason.slice(0, 300) : "";
  // The spell lists an edit leaves out keep their stored value: a client
  // built before the cantrip, pending and spellbook lists (or the per-class
  // casters) sends only prepared and known, and must not wipe the rest.
  if (raw && typeof raw === "object" && raw.spellcasting && typeof raw.spellcasting === "object") {
    raw.spellcasting = layOver(sheet.spellcasting ?? {}, raw.spellcasting);
  }
  const parsed = fullPatchSheetSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid sheet update." },
      { status: 400 },
    );
  }

  // Permissive, and still a sheet: a counter cannot hold more spent than it
  // has (src/lib/dm/correction-rules.ts). What was held is said in the
  // answer, and the audit row records what was stored.
  const { patch, held } = coherentCorrection(parsed.data);
  const updated = patchSheet(sheet.id, patch);
  if (!updated) {
    return Response.json({ error: "Character not found." }, { status: 404 });
  }

  const entry = insertSheetAudit({
    campaignId,
    characterId: sheet.id,
    turnId: null,
    actor: "lead",
    kind: "lead_edit",
    delta: patch as Record<string, unknown>,
    reason: reason || `Corrected by ${context.user.username}`,
    seq: allocateSeq(campaignId),
    before: sheet,
    patch: patch as Record<string, unknown>,
  });
  publishPersisted(campaignId, "sheet_audit", { entry, characterName: sheet.name });
  publishPersisted(campaignId, "sheet_updated", { sheet: updated });

  // The lead corrects numbers; the owner's notes are still the owner's.
  return Response.json({
    sheet: sheetForViewer(updated, campaignSeats(context.campaign), context.user.id),
    ...(held.length ? { held } : {}),
  });
}
