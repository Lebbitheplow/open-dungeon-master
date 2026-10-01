// How many charges a carried magic item holds, and its most: pure reads of
// the equipment row and the generated rule (src/lib/srd/magic-gear.ts).
//
// Split out of src/lib/dm/item-charges.ts (which re-exports them and keeps
// the spending and the dawn regain) so the character sheet can show "4/7"
// with the engine's own count, without importing a module that reaches the
// database.
import { gearDefFor, type ChargeRule } from "@/lib/srd/magic-gear";
import type { EquipmentItem } from "@/lib/schemas/sheet";

// The charge rule of a carried row, or null for an item with no charges.
export function chargeRuleOf(item: Pick<EquipmentItem, "name" | "slug" | "gear">): ChargeRule | null {
  const homebrew = (item.gear as { charges?: { max?: number; recharge?: string } } | undefined)?.charges;
  if (homebrew?.max && homebrew.max > 0) {
    return {
      max: homebrew.max,
      ...(/dawn|day|long rest/i.test(homebrew.recharge ?? "dawn") ? { regain: "all" } : {}),
    };
  }
  return gearDefFor(item.name, item.slug)?.charges ?? null;
}

// The most an item can hold: its number, or the most its dice can roll (a
// Luck Blade's 1d4 - 1 is at most 3).
export function chargeMax(rule: ChargeRule): number {
  if (typeof rule.max === "number") {
    return rule.max;
  }
  const match = /^(\d+)d(\d+)([+-]\d+)?$/i.exec(rule.max.replace(/\s+/g, ""));
  return match ? Math.max(0, Number(match[1]) * Number(match[2]) + Number(match[3] ?? 0)) : 0;
}

// How many charges a row holds now. A row that never recorded a count is
// full; one whose most is dice (rolled once, when the item is first used)
// reads its count from `rolled`.
export function chargesLeft(item: Pick<EquipmentItem, "charges">, rule: ChargeRule, rolled?: number): number {
  if (typeof item.charges === "number") {
    return item.charges;
  }
  return typeof rule.max === "number" ? rule.max : Math.max(0, rolled ?? 0);
}
