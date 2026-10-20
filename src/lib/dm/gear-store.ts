// The plumbing handle_item's two halves share (src/lib/dm/gear-tool.ts,
// src/lib/dm/gear-ground.ts): its refusals, the acting combatant's running
// budget, and a sheet's equipment saved with its audit row.
import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { Encounter } from "@/lib/db/encounters";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { TurnBudget } from "@/lib/dm/action-budget";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { attacksAllowedFor, budgetFor } from "@/lib/dm/turn-budget";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { conditionTurnShape } from "@/lib/srd/condition-effects";

export const retry = (error: string): ToolResult => ({ error, retry: true });
export const refuse = (error: string): ToolResult => ({ error, refused: "rules" });

// The fight's running budget for this combatant, when it is their turn.
export function ownBudget(encounter: Encounter | null, sheet: CharacterSheet): TurnBudget | null {
  return budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
}

function audit(campaign: Campaign, turnId: string | null, sheet: CharacterSheet, kind: string, delta: Record<string, unknown>, reason: string, patch: Record<string, unknown>) {
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId,
    kind,
    delta,
    reason,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
}

export function saveEquipment(campaign: Campaign, turn: DmTurn | null, sheet: CharacterSheet, equipment: EquipmentItem[], kind: string, delta: Record<string, unknown>, reason: string) {
  const updated = patchSheet(sheet.id, { equipment });
  audit(campaign, turn?.id ?? null, sheet, kind, delta, reason, { equipment });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}
