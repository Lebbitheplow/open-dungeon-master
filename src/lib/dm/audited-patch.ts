import { allocateSeq } from "@/lib/db/campaigns";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";

// The hands an audit row names: the GM (the AI's engine, or a person in the
// GM's seat), the party lead correcting, or the character's own player.
export type AuditActor = "dm" | "lead" | "player";

// A sheet change the engine makes on its own, as time passes (a condition
// running out, a torch burning down, a day's rations eaten, a Wild Shape's
// hours ending), written with its audit row the way a GM tool's change is:
// the sheet as it stood just before, the fields written, and why in plain
// words. These went straight to the sheet, so neither an undo nor "Revert
// this turn" could put them back (issue #622). The row carries the turn the
// work runs in (src/lib/db/sheet-audit.ts).
//
// Returns the updated sheet, or null when the character is gone.
export function patchSheetAudited(
  campaignId: string,
  sheetId: string,
  patch: FullPatchSheetInput,
  // `actor`: who made the change, as the audit trail names it ("dm" unless
  // said: the engine on the GM's behalf).
  record: { kind: string; reason: string; delta?: Record<string, unknown>; actor?: AuditActor },
): CharacterSheet | null {
  // Read here, not handed in: a caller's copy may predate a write made since
  // (a carrier a save spent), and the undo restores from this.
  const before = getSheetById(sheetId);
  if (!before) {
    return null;
  }
  const updated = patchSheet(sheetId, patch);
  if (!updated) {
    return null;
  }
  const entry = insertSheetAudit({
    campaignId,
    characterId: sheetId,
    kind: record.kind,
    delta: record.delta ?? (patch as Record<string, unknown>),
    reason: record.reason,
    seq: allocateSeq(campaignId),
    before,
    patch: patch as Record<string, unknown>,
    ...(record.actor ? { actor: record.actor } : {}),
  });
  publishPersisted(campaignId, "sheet_audit", { entry, characterName: before.name });
  publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  return updated;
}
