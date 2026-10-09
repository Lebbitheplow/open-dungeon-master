// One line per carried magic item for the GAME STATE block: what it is, what
// the engine applies from it, whether it is worn and attuned, and its
// charges. For an item the engine only narrates, the pack's own first
// sentence, so the model narrates it from the text rather than from memory.
// For the narrator's prompt (src/lib/dm/prompt.ts), which owns where it is
// shown.

import { searchItems } from "@/lib/content";
import { chargeMax, chargeRuleOf, chargesLeft } from "@/lib/dm/item-charges";
import { armorOfRow } from "@/lib/srd/armor";
import { gearDefOfRow } from "@/lib/srd/magic-gear";
import { matchMagicItem, type MagicItemEffect } from "@/lib/srd/magic-items";
import type { EquipmentItem } from "@/lib/schemas/sheet";

function effectWords(effect: MagicItemEffect): string {
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
  }
}

// The pack's first sentence for a magic item the engine does not hold.
function packSentence(name: string): string | null {
  const wanted = name.trim().toLowerCase();
  const row = searchItems({ q: name.trim(), kind: "magic_item", limit: 5 }).find(
    (item) => item.name.trim().toLowerCase() === wanted,
  );
  const desc = String(row?.data?.desc ?? "").replace(/\s+/g, " ").trim();
  if (!desc) {
    return null;
  }
  const first = desc.split(/(?<=[.!?])\s+/)[0] ?? desc;
  return first.length > 160 ? `${first.slice(0, 157)}...` : first;
}

// "Flame Tongue: longsword, +2d6 fire; attuned, worn" or null for an
// ordinary item.
export function magicItemLine(item: EquipmentItem, equipmentWorn = true): string | null {
  // A workshop item's own magic rides on its line (gearDefOfRow); its effects
  // are the ones magic-items.ts reads off the same line.
  const def = gearDefOfRow(item);
  const worn = item.gear?.magic ? { effects: item.gear.magic.effects, requiresAttunement: item.gear.magic.requiresAttunement } : matchMagicItem(item.name, item.slug);
  const bonusByName = /(?:^|[\s,(])\+([123])(?![0-9])/.exec(item.name);
  if (!def && !worn && !bonusByName) {
    const sentence = packSentence(item.name);
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
  if (item.equipped === true || (item.equipped === undefined && equipmentWorn)) {
    state.push("worn");
  }
  return `${item.name}: ${parts.join(", ") || "magic"}${state.length ? `; ${state.join(", ")}` : ""}`;
}
