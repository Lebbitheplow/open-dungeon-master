// Which row an inventory item is, as every engine looks it up: the SRD or
// pack row the DM named it by (srdName, #408) when its own name is in the
// table's language ("Mantello di protezione" is the Cloak of Protection),
// else its own name without the bonus it declares, since no row is named
// with one ("Arrows +1" are arrows). A pack item is also known by its slug,
// which the finders that index slugs read first.
//
// The finders that serve inventory items (matchWeapon, matchArmor,
// matchMagicItem, gearDefFor, checkRidersOf) take the item rather than a
// string, so none can be handed the name the player sees instead of this
// one. A "+1" stays in the item's own name, where magicItemBonus reads it;
// srdName never carries one (src/lib/dm/item-logic.ts srdNameFor).
//
// Imports only text-logic, by a relative path, so the armor and magic-gear
// tables, the sheet and the scripts that load the item math without the
// path alias read it without a cycle.
import { textKey } from "../language/text-logic.ts";

export type RowItem = { name: string; slug?: string | null; srdName?: string };

export function rowName(item: RowItem): string {
  return item.srdName ?? withoutBonus(item.name);
}

// The bonus a magic item's name declares: "+1 Longsword", "Plate +2",
// "Shield, +3". Shared with the weapon engine (attack-logic.ts) because
// both sides read the same naming convention off the same equipment list.
export function magicItemBonus(name: string): number {
  const match = /(?:^|[\s,(])\+([123])(?![0-9])/.exec(name);
  return match ? Number(match[1]) : 0;
}

// A name without the one bonus it declares, in front or behind: "+1
// Longsword" and "Longsword, +1" are a Longsword. A name listing several
// ("Weapon, +1, +2, or +3") is a family's own row and stays whole, as does a
// bonus inside a note ("Rations (+1 day)").
export function withoutBonus(name: string): string {
  if ((name.match(/\+[123](?![0-9])/g) ?? []).length !== 1) {
    return name;
  }
  return name.replace(/(?:^|,?\s+)\+[123](?![0-9])\s*/, " ").trim();
}

// The item's srdName with the bonus its own name declares ("Spada lunga +1"
// is a "Longsword +1"), else its own name: the name the item lists would
// give it. A name a tool is sent is in that convention, so a carried item
// answers to it, and the pack prices by it.
export function srdNameWithBonus(item: RowItem): string {
  const bonus = item.srdName ? magicItemBonus(item.name) : 0;
  return bonus ? `${item.srdName} +${bonus}` : (item.srdName ?? item.name);
}

// Both names a carried item answers to, for the loose rules.
export function itemNames(item: RowItem): string[] {
  return [item.name, srdNameWithBonus(item)];
}

// The line a tool's item name picks out, or -1: the one by that very name,
// which names one line on the sheet, else one whose srdNameWithBonus it is.
// A starting-kit "Longsword" is the one "Longsword" takes beside the "Spada
// lunga" the DM granted later.
export function lineNamed(items: readonly RowItem[], name: string): number {
  const wanted = textKey(name);
  if (!wanted) {
    return -1;
  }
  const own = items.findIndex((item) => textKey(item.name) === wanted);
  return own >= 0 ? own : items.findIndex((item) => textKey(srdNameWithBonus(item)) === wanted);
}
