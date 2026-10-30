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
// And dusk, twelve hours on.
const DUSK_HOUR = 18;

// The pure reads (the rule, the most, the count now) live in
// src/lib/srd/item-charge-rules.ts so the sheet can show them too.
import { chargeMax, chargeRuleOf, chargesLeft } from "@/lib/srd/item-charge-rules";
import type { ToolError } from "@/lib/dm/tool-errors";
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
): ToolError | {
  charges: number;
  destroyed: boolean;
  notes: string[];
  d20?: ReturnType<typeof rollExpression>;
  initial?: ReturnType<typeof rollExpression>;
  // The lesser item the row turns into (a nonmagical quarterstaff).
  becomes?: string;
  // The charges a 20 on the last charge's d20 brought back.
  regained?: ReturnType<typeof rollExpression>;
} {
  let initial: ReturnType<typeof rollExpression> | undefined;
  if (typeof item.charges !== "number" && typeof rule.max === "string") {
    initial = rollExpression(rule.max);
  }
  const left = chargesLeft(item, rule, initial?.total);
  if (count > left) {
    const regains = rule.regain
      ? rule.regain === "all"
        ? `It regains all its charges at ${rule.regainAtDusk ? "dusk" : "dawn"}.`
        : `It regains ${rule.regain} charges at ${rule.regainAtDusk ? "dusk" : "dawn"}.`
      : "It does not regain charges.";
    return {
      error: `${item.name} has ${left} charge${left === 1 ? "" : "s"} left and this use needs ${count}. ${regains}`,
      refused: "rules",
    };
  }
  let after = left - count;
  const notes: string[] = [];
  let destroyed = false;
  let d20: ReturnType<typeof rollExpression> | undefined;
  let becomes: string | undefined;
  let regained: ReturnType<typeof rollExpression> | undefined;
  // A spell the item casts at will spends nothing, so it spends no last
  // charge either: an empty staff's d20 was rolled when it emptied.
  const spentLast = count > 0 && after === 0;
  // SRD 5.1, the staffs and wands: "If you expend the last charge, roll a
  // d20", and the item's own text says what a 1, and for some a 20, does.
  if (spentLast && (rule.lastChargeD20 || rule.lastChargeBecomes || rule.lastChargeRegain)) {
    d20 = rollExpression("1d20");
    if (d20.total === 1 && rule.lastChargeBecomes) {
      becomes = rule.lastChargeBecomes;
      notes.push(`The last charge is spent and the d20 shows 1: ${item.name} loses its magic and is a ${becomes} from now on.`);
    } else if (d20.total === 1 && rule.lastChargeD20) {
      destroyed = true;
      notes.push(`The last charge is spent and the d20 shows 1: ${item.name} crumbles and is destroyed.`);
    } else if (d20.total === 20 && rule.lastChargeRegain) {
      regained = rollExpression(rule.lastChargeRegain);
      after = Math.min(chargeMax(rule), Math.max(0, regained.total));
      notes.push(`The last charge is spent and the d20 shows 20: ${item.name} regains ${rule.lastChargeRegain} charges (${after}).`);
    } else {
      notes.push(`The last charge is spent; the d20 shows ${d20.total}, so ${item.name} holds together.`);
    }
  } else if (spentLast && rule.spentAway) {
    destroyed = true;
    notes.push(`The last charge is spent: ${item.name} is used up.`);
  }
  return {
    charges: after,
    destroyed,
    notes,
    ...(d20 ? { d20 } : {}),
    ...(initial ? { initial } : {}),
    ...(becomes ? { becomes } : {}),
    ...(regained ? { regained } : {}),
  };
}

// The pack after a use: the row's count lowered, the row gone when the item
// was destroyed (one of a stack), or a plain row in its place when its magic
// left it (`becomes`: a Staff of Striking's nonmagical quarterstaff, held as
// the staff was and attuned to nobody).
export function equipmentAfterSpend(
  equipment: EquipmentItem[],
  item: EquipmentItem,
  charges: number,
  destroyed: boolean,
  becomes?: string,
): EquipmentItem[] {
  const out: EquipmentItem[] = [];
  for (const entry of equipment) {
    if (entry !== item) {
      out.push(entry);
      continue;
    }
    if (destroyed || becomes) {
      if (entry.qty > 1) {
        out.push({ ...entry, qty: entry.qty - 1, charges: undefined });
      }
      if (becomes) {
        out.push({ name: becomes, qty: 1, ...(entry.equipped ? { equipped: true } : {}) });
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

// How many dusks fall after `from` and at or before `to` (SRD 5.1, Robe of
// Stars: "Daily at dusk, 1d6 removed stars reappear").
export function dusksBetween(from: number, to: number): number {
  return dawnsBetween(from - (DUSK_HOUR - DAWN_HOUR) * MINUTES_PER_HOUR, to - (DUSK_HOUR - DAWN_HOUR) * MINUTES_PER_HOUR);
}

// Every dawn the clock crosses, each charged item that regains at dawn rolls
// what it regains (never past its most); an item whose text brings its uses
// back at dusk, at each dusk. Called by advanceClock, so a rest, travel and
// pass_time all bring the same dawn. A roll card is published for each item
// so the table sees the dice.
export function rechargeAtDawn(campaignId: string, from: number, to: number): string[] {
  const dawns = Math.min(30, dawnsBetween(from, to));
  const dusks = Math.min(30, dusksBetween(from, to));
  if (!dawns && !dusks) {
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
      const days = rule.regainAtDusk ? dusks : dawns;
      for (let dawn = 0; dawn < days && charges < most; dawn += 1) {
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
          detail: `${item.name} regains charges at ${rule.regainAtDusk ? "dusk" : "dawn"}`,
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
