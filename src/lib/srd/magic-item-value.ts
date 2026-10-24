import { COPPER_PER_GOLD } from "@/lib/srd/currency";
import { spellLevelOf } from "@/lib/srd/spell-lists";

// What a magic item is worth, from its rarity, under the 2014 rules this
// engine plays. SRD 5.1 prices no magic item ("The value of magic is far
// beyond simple gold"), so the numbers are the top of each rarity's value
// band in the 2014 Dungeon Master's Guide: Common 100 gp, Uncommon 500 gp,
// Rare 5,000 gp, Very Rare 50,000 gp. A legendary item or an artifact has no
// price and is never for sale. Numbers only; no rules text is reproduced.
//
// A consumable is worth half, which is also the 2014 Player's Handbook's own
// 50 gp for a potion of healing. A magic weapon or armor is worth its
// rarity's value alone: the 2014 rules add nothing for the item it is made
// from. A spell scroll is priced by its spell's level through SRD 5.1's
// Spell Scroll table; a row named only "Spell Scroll" does not say, so it has
// no value here.

export const RARITY_VALUE_GP = { common: 100, uncommon: 500, rare: 5_000, "very rare": 50_000 } as const;
export type PricedRarity = keyof typeof RARITY_VALUE_GP;
type Rarity = PricedRarity | "legendary";

// The pack's rarity as one priced rarity, or null for a legendary item, an
// artifact, and a row whose rarity depends on its version ("uncommon (+1),
// rare (+2), or very rare (+3)", "varies").
export function pricedRarity(raw: string): PricedRarity | null {
  const key = raw.trim().toLowerCase();
  return Object.hasOwn(RARITY_VALUE_GP, key) ? (key as PricedRarity) : null;
}

const CONSUMABLE_CATEGORIES = new Set(["potion", "scroll", "ammunition", "weapon (arrow)", "weapon (any ammunition)"]);
const CONSUMABLE_NAME = /ammunition|^dust of /i;
// A category naming a choice of base ("weapon (any sword)", "armor (medium
// or heavy)") cannot say which item a shelf would hand over.
const CHOICE_WORDS = new Set(["any", "or", "light", "medium", "heavy"]);

// SRD 5.1's magic weapons, armor and shields by the bonus their names
// declare: a weapon or a shield is uncommon at +1, rare at +2 and very rare
// at +3; armor is rare, very rare and legendary.
const BONUS_RARITY: Record<"weapon" | "armor" | "shield", readonly Rarity[]> = {
  weapon: ["uncommon", "rare", "very rare"],
  shield: ["uncommon", "rare", "very rare"],
  armor: ["rare", "very rare", "legendary"],
};

// A +1, +2 or +3 weapon, armor or shield: its bonus's rarity and value, or
// null for a legendary one (+3 armor), which has no price.
export function bonusItemValue(kind: "weapon" | "armor" | "shield", bonus: number): { cp: number; rarity: PricedRarity } | null {
  const rarity = BONUS_RARITY[kind][bonus - 1];
  return rarity && rarity !== "legendary" ? { cp: RARITY_VALUE_GP[rarity] * COPPER_PER_GOLD, rarity } : null;
}

// SRD 5.1, Spell Scroll: a scroll's rarity by the level of the spell on it.
const SCROLL_RARITY: readonly Rarity[] = [
  "common", "common", "uncommon", "uncommon", "rare", "rare", "very rare", "very rare", "very rare", "legendary",
];

const ORDINAL = /\b(cantrip|(\d)(?:st|nd|rd|th)?[- ]level)\b/i;
const SPELL_SCROLL = /^spell scroll(?: |$)/i;

// The rarity of a spell scroll named with its spell or its level ("Spell
// Scroll (Fireball)", "Spell Scroll (3rd level)", "Scroll of Shield"), or
// null when the name gives neither.
export function spellScrollRarity(name: string): PricedRarity | null {
  const trimmed = name.trim();
  const inner = /^spell scroll\s*\(([^)]+)\)$/i.exec(trimmed)?.[1] ?? /^scroll of (.+)$/i.exec(trimmed)?.[1] ?? "";
  if (!inner) {
    return null;
  }
  const ordinal = ORDINAL.exec(inner);
  const level = ordinal ? (/cantrip/i.test(ordinal[1]) ? 0 : Number(ordinal[2])) : spellLevelOf(inner);
  const rarity = level !== null && level >= 0 && level <= 9 ? SCROLL_RARITY[level] : null;
  return rarity && rarity !== "legendary" ? rarity : null;
}

// The item's value in copper, or null when it has none: a legendary item, an
// artifact, a rarity that varies, a spell scroll that names no spell, a base
// left to choice.
export function magicItemValue(item: { name: string; rarity: string; category: string }): { cp: number; rarity: PricedRarity } | null {
  const category = item.category.trim().toLowerCase();
  const scroll = category === "scroll";
  // A spell scroll is its spell's rarity, by the spell or level its name
  // gives; a bare Spell Scroll row has none, whatever rarity a document files
  // it at. Another scroll (a Scroll of Conjuring) is its own rarity.
  const rarity = scroll
    ? spellScrollRarity(item.name) ?? (SPELL_SCROLL.test(item.name.trim()) ? null : pricedRarity(item.rarity))
    : pricedRarity(item.rarity);
  if (!rarity) {
    return null;
  }
  const base = /^(?:weapon|armor) \((.+)\)$/.exec(category)?.[1];
  if (base && base.split(/\s+/).some((word) => CHOICE_WORDS.has(word))) {
    return null;
  }
  const value = RARITY_VALUE_GP[rarity] * COPPER_PER_GOLD;
  const consumable = scroll || CONSUMABLE_CATEGORIES.has(category) || CONSUMABLE_NAME.test(item.name);
  return { cp: consumable ? value / 2 : value, rarity };
}

export function magicItemValueCp(item: { name: string; rarity: string; category: string }): number | null {
  return magicItemValue(item)?.cp ?? null;
}

// The magic items any shop that deals in magic buys back (SRD 5.1, Selling
// Treasure: "Finding someone to buy a potion or a scroll isn't too hard"),
// by the pack row's category: its potions, oils, philters and elixirs are
// filed "potion", its scrolls "scroll".
const EASILY_SOLD = new Set(["potion", "scroll"]);
export function easilySold(row: { category: string }): boolean {
  return EASILY_SOLD.has(row.category.trim().toLowerCase());
}
