// Magic item charges: how many an item holds, spending them, and what comes
// back at dawn.
//
// SRD 5.1, "Magic Items", Charges: "Some magic items have charges that must
// be expended to activate their properties. The number of charges an item
// has remaining is revealed when an identify spell is cast on it." A wand of
// magic missiles has 7 and regains 1d6 + 1 daily at dawn; if its last charge
// is spent, a d20 is rolled and on a 1 it crumbles into ashes. Before this
// nothing tracked a charge: use_item deleted the wand on its first use.
//
// The count lives on the equipment row (`charges`). A row with no count is
// full, so every wand ever granted starts with all its charges. The rule for
// an item (its most, what it regains, what its last charge does) comes from
// the generated table (src/lib/srd/magic-gear.ts) or a homebrew entry's own
// charges.

import { allocateSeq } from "@/lib/db/campaigns";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { insertRoll } from "@/lib/db/rolls";
import { listSheets, patchSheet } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { MINUTES_PER_DAY, MINUTES_PER_HOUR } from "@/lib/dm/calendar";
import type { ChargeRule } from "@/lib/srd/magic-gear";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";

// The hour the day's dawn falls on (src/lib/dm/calendar.ts calls the hours
// before it "before dawn").
const DAWN_HOUR = 6;

// The pure reads (the rule, the most, the count now) live in
// src/lib/srd/item-charge-rules.ts so the sheet can show them too.
import { chargeMax, chargeRuleOf, chargesLeft } from "@/lib/srd/item-charge-rules";
export { chargeMax, chargeRuleOf, chargesLeft };

// How many dawns fall after `from` and at or before `to`, both minutes on
// the campaign clock.
export function dawnsBetween(from: number, to: number): number {
  if (to <= from) {
    return 0;
  }
  const offset = DAWN_HOUR * MINUTES_PER_HOUR;
  return Math.floor((to - offset) / MINUTES_PER_DAY) - Math.floor((from - offset) / MINUTES_PER_DAY);
}

// What spending `count` charges from a row does, rolled where the rules roll:
// the count left, whether the item is gone, and the notes for the result.
// Pure apart from the dice; the caller writes the sheet.
export function spendChargesMath(
  item: EquipmentItem,
  rule: ChargeRule,
  count: number,
): { error: string } | { charges: number; destroyed: boolean; notes: string[]; d20?: ReturnType<typeof rollExpression>; initial?: ReturnType<typeof rollExpression> } {
  let initial: ReturnType<typeof rollExpression> | undefined;
  if (typeof item.charges !== "number" && typeof rule.max === "string") {
    initial = rollExpression(rule.max);
  }
  const left = chargesLeft(item, rule, initial?.total);
  if (count > left) {
    const regains = rule.regain
      ? rule.regain === "all"
        ? "It regains all its charges at dawn."
        : `It regains ${rule.regain} charges at dawn.`
      : "It does not regain charges.";
    return {
      error: `${item.name} has ${left} charge${left === 1 ? "" : "s"} left and this use needs ${count}. ${regains}`,
    };
  }
  const after = left - count;
  const notes: string[] = [];
  let destroyed = false;
  let d20: ReturnType<typeof rollExpression> | undefined;
  if (after === 0 && rule.lastChargeD20) {
    d20 = rollExpression("1d20");
    if (d20.total === 1) {
      destroyed = true;
      notes.push(`The last charge is spent and the d20 shows 1: ${item.name} crumbles and is destroyed.`);
    } else {
      notes.push(`The last charge is spent; the d20 shows ${d20.total}, so ${item.name} holds together.`);
    }
  } else if (after === 0 && rule.spentAway) {
    destroyed = true;
    notes.push(`The last charge is spent: ${item.name} is used up.`);
  }
  return { charges: after, destroyed, notes, ...(d20 ? { d20 } : {}), ...(initial ? { initial } : {}) };
}

// The pack after a use: the row's count lowered, or the row gone when the
// item was destroyed (one of a stack).
export function equipmentAfterSpend(
  equipment: EquipmentItem[],
  item: EquipmentItem,
  charges: number,
  destroyed: boolean,
): EquipmentItem[] {
  const out: EquipmentItem[] = [];
  for (const entry of equipment) {
    if (entry !== item) {
      out.push(entry);
      continue;
    }
    if (destroyed) {
      if (entry.qty > 1) {
        out.push({ ...entry, qty: entry.qty - 1, charges: undefined });
      }
      continue;
    }
    out.push({ ...entry, charges });
  }
  return out.map((entry) => {
    if (entry.charges !== undefined) {
      return entry;
    }
    const { charges: _unused, ...rest } = entry;
    void _unused;
    return rest;
  });
}

// Every dawn the clock crosses, each charged item that regains at dawn rolls
// what it regains (never past its most). Called by advanceClock, so a rest,
// travel and pass_time all bring the same dawn. A roll card is published for
// each item so the table sees the dice.
export function rechargeAtDawn(campaignId: string, from: number, to: number): string[] {
  const dawns = Math.min(30, dawnsBetween(from, to));
  if (!dawns) {
    return [];
  }
  const recharged: string[] = [];
  for (const sheet of listSheets(campaignId)) {
    let changed = false;
    const equipment = sheet.equipment.map((item) => {
      const rule = chargeRuleOf(item);
      if (!rule?.regain || typeof item.charges !== "number") {
        return item;
      }
      const most = chargeMax(rule);
      let charges = item.charges;
      for (let dawn = 0; dawn < dawns && charges < most; dawn += 1) {
        if (rule.regain === "all") {
          charges = most;
          continue;
        }
        const rolled = rollExpression(rule.regain);
        const roll = insertRoll({
          campaignId,
          characterId: sheet.id,
          requestedBy: "dm",
          kind: "custom",
          detail: `${item.name} regains charges at dawn`,
          result: rolled,
        });
        publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", { roll, source: "digital" });
        charges = Math.min(most, charges + Math.max(0, rolled.total));
      }
      if (charges === item.charges) {
        return item;
      }
      changed = true;
      recharged.push(`${sheet.name}'s ${item.name}: ${charges}/${most}`);
      return { ...item, charges };
    });
    if (changed) {
      writeCharges(campaignId, sheet, equipment, "dawn_recharge", "charges regained at dawn");
    }
  }
  return recharged;
}

export function writeCharges(
  campaignId: string,
  sheet: CharacterSheet,
  equipment: EquipmentItem[],
  kind: string,
  reason: string,
  turnId: string | null = null,
) {
  const patch = { equipment };
  const updated = patchSheet(sheet.id, patch);
  const entry = insertSheetAudit({
    campaignId,
    characterId: sheet.id,
    turnId,
    kind,
    delta: { equipment: equipment.filter((item) => typeof item.charges === "number").map((item) => ({ name: item.name, charges: item.charges })) },
    reason,
    seq: allocateSeq(campaignId),
    before: sheet,
    patch,
  });
  publishPersisted(campaignId, "sheet_audit", { entry, characterName: sheet.name });
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
}
