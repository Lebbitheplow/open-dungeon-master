// What a spell's material component does to the caster's sheet once a cast
// is made (src/lib/dm/cast-guard.ts): a component item used up, or one bought
// from the purse. The plan itself is made before any spend
// (src/lib/dm/cast-rules.ts materialPlan). Split out of cast-guard.ts.

import type { CharacterSheet, EquipmentItem, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { fromCopper, purseCopper } from "@/lib/srd/currency";
import type { MaterialPlan } from "@/lib/dm/cast-rules";

type CastResult = Record<string, unknown>;

// Equipment after a material is taken: one from the row, the row gone at 0.
function withoutOne(equipment: EquipmentItem[], index: number): EquipmentItem[] {
  return equipment.flatMap((item, at) => {
    if (at !== index) {
      return [item];
    }
    const qty = Math.max(1, item.qty ?? 1) - 1;
    return qty > 0 ? [{ ...item, qty }] : [];
  });
}

// The sheet fields a material plan changes, with a line for the result.
export function materialPatch(
  sheet: CharacterSheet,
  plan: MaterialPlan,
  result: CastResult,
): FullPatchSheetInput {
  if (plan.kind === "item") {
    if (!plan.consume) {
      result.material = `${plan.itemName} is the material component; the spell does not use it up.`;
      return {};
    }
    result.material = `${plan.itemName} is consumed by the spell.`;
    return { equipment: withoutOne(sheet.equipment, plan.index) };
  }
  if (plan.kind === "purse") {
    const left = fromCopper(purseCopper({ gold: sheet.gold ?? 0, copper: sheet.copper ?? 0 }) - plan.copper);
    result.material = plan.consume
      ? `${plan.keepAs} was bought for the spell and consumed by it; the coin is gone.`
      : `${plan.keepAs} was bought for the spell and is kept for the next casting.`;
    return {
      gold: left.gold,
      copper: left.copper,
      ...(plan.consume ? {} : { equipment: [...sheet.equipment, { name: plan.keepAs, qty: 1 } as EquipmentItem] }),
    };
  }
  return {};
}
