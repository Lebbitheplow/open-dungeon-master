// Slow's hold on a spell (SRD 5.1): a slowed creature that casts a spell
// with a casting time of 1 action rolls a d20; on an 11 or higher the spell
// does not take effect until its next turn, and it must use its action on
// that turn to complete it, or the spell is wasted.
//
// The cast guard (cast-guard.ts) rolls it once the cast is paid for: the
// slot and this turn's action are spent and the spell does nothing yet. The
// "slowed casting" mark keeps the spell and its slot until the end of the
// caster's next turn (turn-end.ts untilTurnEndOf); casting it again on that
// turn completes it for the turn's action and no slot.

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { textKey } from "@/lib/language/text-logic";
import { insertRoll } from "@/lib/db/rolls";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { addConditionInstance, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const SLOWED_CASTING = "slowed casting";

const sameSpell = (a: string, b: string) => textKey(a) === textKey(b);

// The casting Slow held back that this call completes, or null. Only on the
// caster's next turn: the mark's turn has begun.
export function heldBySlow(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">, spell: string): { slotLevel: number | null } | null {
  const mark = sheet.conditions.find((entry) => entry.trim().toLowerCase() === SLOWED_CASTING);
  const meta = mark ? (sheet.conditionMeta as ConditionMetaMap)[mark] : undefined;
  return meta?.spell && sameSpell(meta.spell, spell) && meta.turnBegun ? { slotLevel: meta.slotLevel ?? null } : null;
}

// Rolls Slow's d20 for a cast it applies to; true when the spell is held.
export function slowHoldsCast(campaign: Campaign, sheet: CharacterSheet, spell: string): boolean {
  const outcome = rollExpression("1d20");
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "custom",
    detail: `Slow: ${sheet.name} casts ${spell} (11 or higher and it waits for their next turn)`,
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
  return outcome.total >= 11;
}

// Lays (or clears, with no spell) the mark of a casting Slow held back.
export function markSlowedCast(campaignId: string, sheetId: string, held: { spell: string; slotLevel: number | null } | null) {
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return;
  }
  const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, [SLOWED_CASTING]);
  const next = held
    ? addConditionInstance(cleared.conditions, cleared.meta, SLOWED_CASTING, {
        spell: held.spell,
        source: sheetId,
        untilTurnEndOf: sheetId,
        ...(held.slotLevel ? { slotLevel: held.slotLevel } : {}),
      })
    : cleared;
  const updated = patchSheet(sheetId, { conditions: next.conditions, conditionMeta: next.meta });
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
}
