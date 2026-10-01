import type { EquipmentItem } from "@/lib/schemas/sheet";
import { matchArmor } from "@/lib/srd/armor";
import { matchWeapon } from "@/lib/srd/weapons";

// Pure consumable knowledge for the use_item tool: healing potion tiers,
// generic consumable detection, and ammunition lookup. Database-free so
// scripts/test-item-logic.mjs imports it directly.

export type ConsumableEffect =
  | { kind: "healing"; expression: string }
  | { kind: "generic" };

const POTION_TIERS: Array<{ pattern: RegExp; expression: string }> = [
  { pattern: /supreme/i, expression: "10d4+20" },
  { pattern: /superior/i, expression: "8d4+8" },
  { pattern: /greater/i, expression: "4d4+4" },
  { pattern: /./, expression: "2d4+2" },
];

// What using this item does. Healing potions get their SRD dice; everything
// else is a generic consumable (decrement only, model narrates the effect).
export function consumableEffect(name: string): ConsumableEffect {
  const lowered = name.toLowerCase();
  const isHealing =
    /potion|vial|elixir|flask|draught|philter/.test(lowered) &&
    /heal|life|cure/.test(lowered) && !/vitality|elixir of health/.test(lowered);
  if (isHealing) {
    const tier = POTION_TIERS.find((entry) => entry.pattern.test(lowered));
    return { kind: "healing", expression: tier?.expression ?? "2d4+2" };
  }
  return { kind: "generic" };
}

// Finds a carried item by fuzzy name (containment either way).
export function findCarriedItem(equipment: EquipmentItem[], term: string): EquipmentItem | null {
  const wanted = term.trim().toLowerCase();
  if (!wanted) {
    return null;
  }
  return (
    equipment.find((item) => item.name.toLowerCase() === wanted) ??
    equipment.find(
      (item) =>
        item.name.toLowerCase().includes(wanted) || wanted.includes(item.name.toLowerCase()),
    ) ??
    // Token fallback so "healing potion" still finds "Potion of Healing".
    equipment.find((item) => {
      const name = item.name.toLowerCase();
      const tokens = wanted.split(/\s+/).filter((token) => token.length > 2);
      return tokens.length > 0 && tokens.every((token) => name.includes(token));
    }) ??
    null
  );
}

// Every carried item a use_item name could mean: the exact name alone when
// one matches, else every item the fuzzy rules above would take. More than
// one means the name is ambiguous (src/lib/dm/item-use.ts refuses to spend a
// charged item on a guess).
export function carriedItemsMatching(equipment: EquipmentItem[], term: string): EquipmentItem[] {
  const wanted = term.trim().toLowerCase();
  if (!wanted) {
    return [];
  }
  const exact = equipment.filter((item) => item.name.toLowerCase() === wanted);
  if (exact.length) {
    return exact;
  }
  const tokens = wanted.split(/\s+/).filter((token) => token.length > 2);
  return equipment.filter((item) => {
    const name = item.name.toLowerCase();
    return (
      name.includes(wanted) ||
      wanted.includes(name) ||
      (tokens.length > 0 && tokens.every((token) => name.includes(token)))
    );
  });
}

// Words that make an item something used up when it is used: a potion, a
// scroll, food, a torch, a flask thrown, a pinch of dust. They win over the
// durable words below, so an Oil of Sharpness or a Scroll of Fireball counts
// down and a Necklace of Fireballs does not.
const CONSUMABLE = /\b(potions?|scrolls?|oils?|elixirs?|philters?|draughts?|vials?|flasks?|rations?|food|water|waterskin|torch(?:es)?|candles?|antitoxin|acid|alchemist'?s? fire|holy water|ball bearings|caltrops|chalk|incense|dust|beads?|pills?|salves?|ointments?|herbs?|berry|berries|bread|meat|ale|wine|arrows?|bolts?|bullets?|needles?|darts?|javelins?|daggers?|tinderbox|matches|smoke|grenade|bomb)\b/i;

// Magic items and gear that are worn, wielded or kept, never used up: a
// wand spends charges, a Bag of Holding holds things, a ring is worn.
const DURABLE = /\b(wands?|staffs?|staves|rods?|rings?|amulets?|cloaks?|capes?|mantles?|robes?|boots|slippers|bags?|belts?|bracers|gauntlets|gloves|helms?|circlets?|headbands?|crowns?|orbs?|figurines?|decks?|horns?|lanterns?|lamps?|mirrors?|necklaces?|periapts?|medallions?|brooches?|pipes|carpets?|brooms?|instruments?|lyres?|drums?|books?|tomes?|manuals?|stones?|gems?|cubes?|spheres?|chimes?|goggles|lenses|eyes of|cap of|hat of|portable hole|rope of|apparatus|armou?r|shields?)\b/i;

// Kept things whose names hold a consumable's word: a waterskin is drunk
// from and refilled (and is the supplies variant's water, src/lib/dm/
// supplies.ts), and a Necklace of Prayer Beads keeps its beads, each a power
// that returns at dawn. They are asked before the consumable words.
const KEPT = /\b(water ?skins?|canteens?|necklaces?|prayer beads)\b/i;

// Why use_item would not use this item up, or null when it is a
// consumable. Weapons are wielded through pc_attack, armor is worn, and a
// durable magic item keeps its place in the pack; ammunition and thrown
// weapons are spent by the attacks that use them, never here.
export function itemUseProblem(name: string): string | null {
  const text = name.trim();
  if (KEPT.test(text)) {
    return /water ?skin|canteen/i.test(text)
      ? "a waterskin is drunk from and refilled, never used up; narrate the drink without use_item."
      : "it is kept, not consumed: a necklace's beads are powers that return at dawn. Narrate its use without use_item.";
  }
  if (CONSUMABLE.test(text) && !/\b(wand|staff|rod|ring)\b/i.test(text)) {
    // A dagger or a javelin is a weapon first: thrown, it is spent by the
    // attack; used here it would vanish for nothing.
    if (matchWeapon(text) && !/\b(potion|oil|scroll|flask|vial)\b/i.test(text)) {
      return "it is a weapon; attacks with it go through pc_attack, which tracks thrown and ammunition use.";
    }
    return null;
  }
  if (matchWeapon(text)) {
    return "it is a weapon; attacks with it go through pc_attack.";
  }
  if (matchArmor(text)) {
    return "it is armor, worn rather than used up.";
  }
  if (DURABLE.test(text)) {
    return "it is kept, not consumed: a wand or staff spends charges on a cast, and worn items work while worn. Narrate its use without use_item.";
  }
  return null;
}
