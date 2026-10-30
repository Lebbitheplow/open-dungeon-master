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
import { undoConflictLine } from "@/lib/sheet-audit-logic";
import { forgetLongRest } from "@/lib/db/clock";
import { forgetDeath } from "@/lib/dm/revival";
import { recordTurnCorrection } from "@/lib/db/turn-ledger";
import { publishPersisted } from "@/lib/events";
import { fullPatchSheetSchema, type CharacterSheet } from "@/lib/schemas/sheet";

// Party-lead undo of audited sheet mutations. An undo restores exactly the
// fields the original mutation wrote, from the full sheet snapshot taken
// before it ran, and records a compensating audit entry (which is itself
// undoable). Side effects outside the sheet (milestones, narration, level-up
// notices) are not rescinded.

export type UndoOutcome =
  // correctionId: the ledger row the undo wrote (issue #460), or null when
  // the change undone was not the AI's.
  | { ok: true; compensating: SheetAuditEntry; sheet: CharacterSheet; correctionId: string | null }
  | { ok: false; error: string };

// Who undid it, and from where: one change, or every change of a turn.
export type UndoBy = { userId: string; kind: "sheet_undo" | "turn_revert" };

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
      warnings.push(undoConflictLine(getSheetById(entry.characterId)?.name ?? "this character", other.reason, overlap));
    }
  }
  return warnings;
}

export function revertAuditEntry(campaign: Campaign, entry: SheetAuditEntry, by?: UndoBy): UndoOutcome {
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
  let correctionId: string | null = null;
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
    // The AI's change, undone: the correction ledger's row goes in with the
    // undo, or not at all. A person's own change undone is nobody's fix.
    if (by && entry.actor === "dm") {
      correctionId = recordTurnCorrection({
        campaignId: campaign.id,
        turnId: entry.turnId,
        attribution: "direct",
        kind: by.kind,
        auditId: entry.id,
        tool: entry.kind,
        userId: by.userId,
      });
    }
  })();
  // A long rest undone never happened: the 24 hours it started are given
  // back, so the character may rest again (SRD 5.1, one long rest a day).
  if (entry.kind === "rest_long") {
    forgetLongRest(campaign.id, entry.characterId);
  }
  // Nor did a death undone: its moment and its line in the character's story
  // go with it (issue #622).
  const track = entry.delta.deathSaves as { dead?: unknown } | null | undefined;
  const moment =
    entry.kind === "death_state" && track?.dead === true
      ? forgetDeath(campaign.id, entry.characterId, entry.seq, (compensating as SheetAuditEntry | null)?.id ?? entry.id)
      : null;
  if (moment) {
    publishPersisted(campaign.id, "audit_reverted", { entryId: moment, revertedAt: new Date().toISOString() });
  }

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
  return { ok: true, compensating: compensating!, sheet, correctionId };
}
