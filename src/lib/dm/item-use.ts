// The use_item cases the gear engine owns: an item with charges (a wand, a
// staff, a once-a-day power), which spends charges and stays in the pack.
// mutations.ts asks here first; null means "an ordinary consumable", and
// use_item goes on as before (src/lib/dm/resource-tools.ts computeUseItem).
//
// SRD 5.1: activating a magic item is an action in a fight ("Activating an
// Item": most items that need an action, and the wands and staffs all say
// "you can use an action"), an item that asks for attunement works only for
// someone attuned to it, and a creature at 0 hit points uses nothing.

import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { insertRoll } from "@/lib/db/rolls";
import { publishWithSeq } from "@/lib/events";
import { spendAction } from "@/lib/dm/action-budget";
import { canAct } from "@/lib/dm/can-act";
import { carriedItemsMatching } from "@/lib/dm/item-logic";
import { itemSpellCast } from "@/lib/srd/item-spells";
import { recordItemCast } from "@/lib/srd/item-cast-credit";
import {
  chargeMax,
  chargeRuleOf,
  equipmentAfterSpend,
  spendChargesMath,
  writeCharges,
} from "@/lib/dm/item-charges";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { gearDefOfRow } from "@/lib/srd/magic-gear";
import { conditionExtraActions } from "@/lib/srd/condition-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { RollResult } from "@/lib/dice";

function publishRoll(campaign: Campaign, sheet: CharacterSheet, detail: string, result: RollResult) {
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "custom",
    detail,
    result,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
}

// Spends charges from a carried charged item. Null when the item has no
// charges, so use_item treats it as it always has. With `spell`, the charges
// cast that spell from the item (src/lib/srd/item-spells.ts): the table sets
// the cost and the level, and the tool that resolves the spell next spends
// no slot for it (src/lib/srd/item-cast-credit.ts).
export function chargedItemUse(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  itemName: string,
  charges: number | undefined,
  spell?: string,
): Record<string, unknown> | null {
  // A name that fits a charged item and something else as well is a guess:
  // "healing" with a Staff of Healing and a potion in the pack. The charges
  // are not spent on a guess.
  const matching = carriedItemsMatching(sheet.equipment, itemName);
  const chargedMatches = matching.filter((item) => chargeRuleOf(item));
  if (chargedMatches.length && matching.length > 1) {
    return {
      error: `"${itemName}" could mean ${matching.map((item) => item.name).join(" or ")}; name the item exactly. Nothing was spent.`,
    };
  }
  const carried = chargedMatches[0] ?? null;
  const rule = carried ? chargeRuleOf(carried) : null;
  if (!carried || !rule) {
    return null;
  }
  const cast = spell?.trim() ? itemSpellCast(carried, spell, charges) : null;
  if (cast && "error" in cast) {
    return { error: `${cast.error} Nothing was spent.` };
  }
  const count = cast ? cast.charges : Math.max(1, Math.round(charges ?? 1));
  if (sheet.deathSaves?.dead || sheet.currentHp <= 0) {
    return {
      error: `${sheet.name} is ${sheet.deathSaves?.dead ? "dead" : "unconscious at 0 hit points"} and cannot use ${carried.name}.`,
    };
  }
  const def = gearDefOfRow(carried);
  if (def?.requiresAttunement && !carried.attuned) {
    return {
      error: `${carried.name} works only for someone attuned to it, and ${sheet.name} is not; attuning takes a short rest with the item. Nothing was spent.`,
    };
  }
  // In a fight, activating the item is the character's action.
  const encounter = getActiveEncounter(campaign.id);
  let budget: ReturnType<typeof budgetFor> = null;
  if (encounter) {
    const able = canAct({ sheet, encounter, kind: "action" });
    if (!able.ok) {
      return { error: able.error };
    }
    budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionExtraActions(sheet.conditions));
    if (budget) {
      const spent = spendAction(budget, "action", `using ${carried.name}`, sheet.name);
      if (!spent.ok) {
        return { error: spent.error };
      }
      budget = spent.budget;
    }
  }
  const math = spendChargesMath(carried, rule, count);
  if ("error" in math) {
    return { error: `${math.error} Nothing was spent.` };
  }
  if (encounter && budget) {
    storeBudget(encounter, budget);
  }
  if (math.initial) {
    publishRoll(campaign, sheet, `${carried.name}: charges it holds`, math.initial);
  }
  if (math.d20) {
    publishRoll(campaign, sheet, `${carried.name}: the last charge`, math.d20);
  }
  const equipment = equipmentAfterSpend(sheet.equipment, carried, math.charges, math.destroyed);
  writeCharges(campaign.id, sheet, equipment, "use_item", `${carried.name}: ${count} charge${count === 1 ? "" : "s"}`, turnId);
  if (cast) {
    recordItemCast(sheet.id, { spell: cast.spell, level: cast.level, item: carried.name, ...(cast.dc ? { saveDc: cast.dc } : {}) });
  }
  const most = chargeMax(rule);
  return {
    ok: true,
    used: carried.name,
    chargesSpent: count,
    chargesLeft: math.destroyed ? 0 : math.charges,
    ...(most ? { chargesMax: most } : {}),
    ...(math.destroyed ? { destroyed: true } : {}),
    ...(rule.daily ? { power: rule.daily } : {}),
    ...(cast ? { spellCast: cast.spell, spellLevel: cast.level, ...(cast.dc ? { saveDc: cast.dc } : {}) } : {}),
    note: [
      `${count} charge${count === 1 ? "" : "s"} spent; ${math.destroyed ? "the item is gone" : `${math.charges} left`}${
        rule.regain ? (rule.regain === "all" ? ", all back at dawn" : `, ${rule.regain} back at dawn`) : ""
      }.`,
      ...math.notes,
      cast
        ? `${sheet.name} casts ${cast.spell} at level ${cast.level} from ${carried.name}${cast.dc ? ` (save DC ${cast.dc})` : ""}. Resolve it now with the spell's own tool (aoe_damage, cast_at_enemy, heal, cast_buff) naming the spell: that cast spends no slot and uses the item's numbers.`
        : "No spell slot is spent. Resolve what the item does with the tool for it (aoe_damage, apply_damage, set_condition, heal) and narrate it.",
    ].join(" "),
  };
}
