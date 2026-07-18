import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getDatabase } from "@/lib/db/core";
import {
  getAuditPreImage,
  insertSheetAudit,
  listLaterEntriesTouching,
  markReverted,
  type SheetAuditEntry,
} from "@/lib/db/sheet-audit";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { fullPatchSheetSchema, type CharacterSheet } from "@/lib/schemas/sheet";

// Party-lead undo of audited sheet mutations. An undo restores exactly the
// fields the original mutation wrote, from the full sheet snapshot taken
// before it ran, and records a compensating audit entry (which is itself
// undoable). Side effects outside the sheet (milestones, narration, level-up
// notices) are not rescinded.

export type UndoOutcome =
  | { ok: true; compensating: SheetAuditEntry; sheet: CharacterSheet }
  | { ok: false; error: string };

// Newer live changes on the same character that wrote any of the same
// fields; undoing past them means last-write-wins, so the lead confirms.
export function undoConflictWarnings(
  entry: SheetAuditEntry,
  ignoreTurnId?: string | null,
): string[] {
  const later = listLaterEntriesTouching(entry.campaignId, entry.characterId, entry.seq);
  const warnings: string[] = [];
  for (const other of later) {
    if (ignoreTurnId && other.turnId === ignoreTurnId) {
      continue;
    }
    const overlap = other.patchKeys.filter((key) => entry.patchKeys.includes(key));
    if (overlap.length) {
      warnings.push(
        `A newer ${other.kind} change (${other.reason || "no reason"}) also touched: ${overlap.join(", ")}.`,
      );
    }
  }
  return warnings;
}

export function revertAuditEntry(campaign: Campaign, entry: SheetAuditEntry): UndoOutcome {
  if (entry.revertedAt) {
    return { ok: false, error: "That change was already undone." };
  }
  const preImage = getAuditPreImage(entry.id);
  if (!preImage) {
    return { ok: false, error: "That change predates undo support." };
  }

  const restoreRaw: Record<string, unknown> = {};
  for (const key of Object.keys(preImage.patch)) {
    restoreRaw[key] = preImage.before[key as keyof CharacterSheet];
  }
  const parsed = fullPatchSheetSchema.safeParse(restoreRaw);
  if (!parsed.success) {
    return { ok: false, error: "The recorded pre-image could not be restored." };
  }

  const current = getSheetById(entry.characterId);
  if (!current) {
    return { ok: false, error: "Character not found." };
  }

  let compensating: SheetAuditEntry | null = null;
  getDatabase().transaction(() => {
    patchSheet(entry.characterId, parsed.data);
    compensating = insertSheetAudit({
      campaignId: campaign.id,
      characterId: entry.characterId,
      turnId: entry.turnId,
      actor: "lead",
      kind: "undo",
      delta: parsed.data as Record<string, unknown>,
      reason: `Undid ${entry.kind}${entry.reason ? ` (${entry.reason})` : ""}`,
      seq: allocateSeq(campaign.id),
      before: current,
      patch: parsed.data as Record<string, unknown>,
    });
    markReverted(entry.id, compensating.id);
  })();

  const sheet = getSheetById(entry.characterId)!;
  publishPersisted(campaign.id, "sheet_audit", {
    entry: compensating,
    characterName: sheet.name,
  });
  publishPersisted(campaign.id, "audit_reverted", {
    entryId: entry.id,
    revertedAt: new Date().toISOString(),
  });
  publishPersisted(campaign.id, "sheet_updated", { sheet });
  return { ok: true, compensating: compensating!, sheet };
}
