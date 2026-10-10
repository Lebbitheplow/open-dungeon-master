// What a spell's material component does to the caster's sheet once a cast
// is made (src/lib/dm/cast-guard.ts): a component item used up, or one bought
// from the purse. The plan itself is made before any spend
// (src/lib/dm/cast-rules.ts materialPlan). Split out of cast-guard.ts.

import type { CharacterSheet, EquipmentItem, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { fromCopper, purseCopper } from "@/lib/srd/currency";
import type { MaterialPlan } from "@/lib/dm/cast-materials";

type CastResult = Record<string, unknown>;

// Equipment after the casting takes what it uses up: so many from each
// row, the row gone at 0.
function withoutTaken(equipment: EquipmentItem[], taken: Map<number, number>): EquipmentItem[] {
  return equipment.flatMap((item, at) => {
    const take = taken.get(at) ?? 0;
    if (!take) {
      return [item];
    }
    const qty = Math.max(1, item.qty ?? 1) - take;
    return qty > 0 ? [{ ...item, qty }] : [];
  });
}

// The sheet fields a material plan changes, with a line for the result.
export function materialPatch(
  sheet: CharacterSheet,
  plan: MaterialPlan,
  result: CastResult,
): FullPatchSheetInput {
  if (plan.kind !== "components") {
    return {};
  }
  const lines: string[] = [];
  const taken = new Map<number, number>();
  for (const use of plan.uses) {
    if (use.consume) {
      taken.set(use.index, (taken.get(use.index) ?? 0) + use.take);
      lines.push(`${use.take > 1 ? `${use.take} × ` : ""}${use.itemName} consumed by the spell`);
    } else {
      lines.push(`${use.itemName} is the material component; the spell does not use it up`);
    }
  }
  let equipment = taken.size ? withoutTaken(sheet.equipment, taken) : sheet.equipment;
  let copper = purseCopper({ gold: sheet.gold ?? 0, copper: sheet.copper ?? 0 });
  for (const buy of plan.bought) {
    copper -= buy.copper;
    if (buy.consume) {
      lines.push(`${buy.qty > 1 ? `${buy.qty} × ` : ""}${buy.name} bought for the spell and consumed by it`);
    } else {
      equipment = [...equipment, { name: buy.name, qty: buy.qty } as EquipmentItem];
      lines.push(`${buy.qty > 1 ? `${buy.qty} × ` : ""}${buy.name} bought for the spell and kept for the next casting`);
    }
  }
  if (lines.length) {
    result.material = `${lines.join("; ")}.`;
  }
  const left = fromCopper(copper);
  return {
    ...(equipment !== sheet.equipment ? { equipment } : {}),
    ...(plan.bought.length ? { gold: left.gold, copper: left.copper } : {}),
  };
}
