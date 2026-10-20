import { COPPER_PER_GOLD } from "@/lib/srd/currency";

// What a magic item is worth, from its rarity. The SRD 5.1 the rulebook
// follows gives magic items no price ("The value of magic is far beyond
// simple gold"), so the content pack carries none; SRD 5.2, Magic Item
// Rarity, gives each rarity one for a table that lets characters buy and
// sell them: Common 100 gp, Uncommon 400 gp, Rare 4,000 gp, Very Rare
// 40,000 gp, Legendary 200,000 gp, and an artifact is priceless.
//
// A consumable other than a spell scroll is worth half. A magic weapon or
// armor adds the cost of the item it is made from: +1 plate armor is the
// rare 4,000 gp and plate's 1,500 gp. A spell scroll is priced by its
// spell's level, which a row named only "Spell Scroll" does not say, so it
// has no value here.

export const RARITY_VALUE_GP = { common: 100, uncommon: 400, rare: 4_000, "very rare": 40_000, legendary: 200_000 } as const;
export type PricedRarity = keyof typeof RARITY_VALUE_GP;

// The pack's rarity as one priced rarity, or null for an artifact and for a
// row whose rarity depends on its version ("uncommon (+1), rare (+2), or
// very rare (+3)", "varies").
export function pricedRarity(raw: string): PricedRarity | null {
  const key = raw.trim().toLowerCase();
  return Object.hasOwn(RARITY_VALUE_GP, key) ? (key as PricedRarity) : null;
}

const CONSUMABLE_CATEGORIES = new Set(["potion", "scroll", "ammunition", "weapon (arrow)", "weapon (any ammunition)"]);
const CONSUMABLE_NAME = /ammunition|^dust of /i;
// A category naming a choice of base ("weapon (any sword)", "armor (medium
// or heavy)") cannot say which item it is, so neither its cost nor what a
// shelf would hand over is known.
const CHOICE_WORDS = new Set(["any", "or", "light", "medium", "heavy"]);

// SRD 5.1's magic weapons, armor and shields by the bonus their names
// declare: a weapon or a shield is uncommon at +1, rare at +2 and very rare
// at +3; armor is rare, very rare and legendary.
const BONUS_RARITY: Record<"weapon" | "armor" | "shield", readonly PricedRarity[]> = {
  weapon: ["uncommon", "rare", "very rare"],
  shield: ["uncommon", "rare", "very rare"],
  armor: ["rare", "very rare", "legendary"],
};

// A +1, +2 or +3 weapon, armor or shield: its bonus's rarity value and the
// cost of the item it is. The pack files these only as one row whose rarity
// varies ("Weapon, +1, +2, or +3"), so the bonus says which.
export function bonusItemValue(kind: "weapon" | "armor" | "shield", bonus: number, baseCp: number): { cp: number; rarity: PricedRarity } | null {
  const rarity = BONUS_RARITY[kind][bonus - 1];
  return rarity ? { cp: RARITY_VALUE_GP[rarity] * COPPER_PER_GOLD + baseCp, rarity } : null;
}

// The item's value in copper, or null when it has none: an artifact, a
// rarity that varies, a spell scroll, a base left to choice. baseCostCp
// prices the named weapon or armor ("plate", "longsword") from the pack.
export function magicItemValueCp(
  item: { name: string; rarity: string; category: string },
  baseCostCp: (base: string) => number | null,
): number | null {
  const rarity = pricedRarity(item.rarity);
  if (!rarity || /^spell scroll/i.test(item.name.trim())) {
    return null;
  }
  const category = item.category.trim().toLowerCase();
  const base = /^(?:weapon|armor) \((.+)\)$/.exec(category)?.[1];
  if (base && base.split(/\s+/).some((word) => CHOICE_WORDS.has(word))) {
    return null;
  }
  const value = RARITY_VALUE_GP[rarity] * COPPER_PER_GOLD;
  const consumable = CONSUMABLE_CATEGORIES.has(category) || CONSUMABLE_NAME.test(item.name);
  return (consumable ? value / 2 : value) + (base ? baseCostCp(base) ?? 0 : 0);
}
