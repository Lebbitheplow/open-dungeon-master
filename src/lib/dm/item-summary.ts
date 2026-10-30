// One line per carried magic item for the GAME STATE block: what it is, what
// the engine applies from it, whether it is worn and attuned, and its
// charges. For an item the engine only narrates, the pack's own first
// sentence, so the model narrates it from the text rather than from memory.
// For the narrator's prompt (src/lib/dm/prompt.ts), which owns where it is
// shown.

import { searchItems } from "@/lib/content";
import { chargeMax, chargeRuleOf, chargesLeft } from "@/lib/dm/item-charges";
import { armorOfRow, isWorn } from "@/lib/srd/armor";
import { oneOfKind, wornButIdle } from "@/lib/srd/wear-slots";
import { gearDefOfRow } from "@/lib/srd/magic-gear";
import { matchMagicItem, type TableItemEffect } from "@/lib/srd/magic-items";
import type { EquipmentItem } from "@/lib/schemas/sheet";
import { textKey } from "@/lib/language/text-logic";
import { magicItemBonus, rowName } from "@/lib/srd/item-row";

function effectWords(effect: TableItemEffect): string {
  switch (effect.kind) {
    case "ac_bonus":
      return `+${effect.amount} AC`;
    case "ac_unarmored":
      return `+${effect.amount} AC without armor`;
    case "save_bonus":
      return `+${effect.amount} saves`;
    case "set_ability":
      return `${effect.ability.toUpperCase()} ${effect.score}`;
    case "resistance":
      return `resists ${effect.types.join(", ")}`;
    case "increase_ability":
      return `${effect.ability.toUpperCase()} +${effect.amount} (max ${effect.max})`;
    case "spell_attack_bonus":
      return effect.amount === "named" ? "spell attacks +its bonus" : `+${effect.amount} spell attacks${effect.classes ? ` (${effect.classes.join(" or ")})` : ""}`;
    case "spell_dc_bonus":
      return `+${effect.amount} spell save DC`;
    case "spell_save_advantage":
      return "advantage on saves against spells";
    case "immunity":
      return `immune to ${effect.types.join(", ")} damage`;
    case "condition_immunity":
      return `immune to ${effect.conditions.join(", ")}`;
    case "speed":
      return `${effect.mode} ${effect.feet === "walk" ? "= walking" : `${effect.feet} ft`}`;
    case "weapon_rider":
      return `${effect.weapons.join(", ")}${effect.proficient ? ": proficient" : ""}${effect.damage ? `, +${effect.damage} damage${effect.ranged ? " at range" : ""}` : ""}`;
  }
}

// The pack's first sentence for a magic item the engine does not hold.
function packSentence(name: string): string | null {
  const wanted = textKey(name);
  const row = searchItems({ q: name.trim(), kind: "magic_item", limit: 5 }).find(
    (item) => textKey(item.name) === wanted,
  );
  const desc = String(row?.data?.desc ?? "").replace(/\s+/g, " ").trim();
  if (!desc) {
    return null;
  }
  const first = desc.split(/(?<=[.!?])\s+/)[0] ?? desc;
  return first.length > 160 ? `${first.slice(0, 157)}...` : first;
}

// "Flame Tongue: longsword, +2d6 fire; attuned, worn" or null for an
// ordinary item. `equipment` is the whole pack the item is in: whether it is
// worn is read the armor engine's way, and a worn second cloak says its magic
// is not in effect (src/lib/srd/wear-slots.ts), so the model does not narrate
// both.
export function magicItemLine(item: EquipmentItem, equipment: readonly EquipmentItem[] = [item]): string | null {
  // A workshop item's own magic rides on its line (gearDefOfRow); its effects
  // are the ones magic-items.ts reads off the same line.
  const def = gearDefOfRow(item);
  const worn = item.gear?.magic ? { effects: item.gear.magic.effects, requiresAttunement: item.gear.magic.requiresAttunement } : matchMagicItem(item);
  if (!def && !worn && !magicItemBonus(item.name)) {
    const sentence = packSentence(rowName(item));
    return sentence ? `${item.name}: ${sentence} (narrated)` : null;
  }
  const parts: string[] = [];
  if (def?.base) {
    parts.push(def.base.name.toLowerCase());
  }
  const weapon = def?.weapon;
  if (weapon?.bonus) {
    parts.push(`+${weapon.bonus} to hit and damage`);
  }
  for (const extra of weapon?.extra ?? []) {
    parts.push(`+${extra.dice} ${extra.type === "weapon" ? "damage" : extra.type}${extra.vs ? ` vs ${extra.vs.join("/")}` : ""}`);
  }
  const armor = armorOfRow(item);
  if (armor && armor.bonus) {
    parts.push(`+${armor.bonus} AC`);
  }
  for (const effect of worn?.effects ?? []) {
    parts.push(effectWords(effect));
  }
  const rule = chargeRuleOf(item);
  if (rule) {
    const most = chargeMax(rule);
    parts.push(`${chargesLeft(item, rule, most)}/${most} charges`);
  }
  const state: string[] = [];
  if (item.attuned) {
    state.push("attuned");
  } else if (item.attuning) {
    state.push("attuning at the next rest");
  } else if (def?.requiresAttunement || worn?.requiresAttunement) {
    state.push("not attuned");
  }
  const idle = wornButIdle(item, equipment);
  if (idle) {
    state.push(`worn, not in effect (${oneOfKind(idle) ?? "one of its kind"} at a time)`);
  } else if (isWorn(item, equipment)) {
    state.push("worn");
  }
  return `${item.name}: ${parts.join(", ") || "magic"}${state.length ? `; ${state.join(", ")}` : ""}`;
}
