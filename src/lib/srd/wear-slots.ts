// Where an item is worn, and how many of a kind a character wears at once
// (issue 412). SRD 5.1, Magic Items, Wearing and Wielding Items: "boots go on
// the feet, gloves on the hands, hats and helmets on the head, and rings on
// the finger"; Multiple Items of the Same Kind: "A character can't normally
// wear more than one pair of footwear, one pair of gloves or gauntlets, one
// pair of bracers, one suit of armor, one item of headwear, and one cloak.
// You can make exceptions; a character might be able to wear a circlet under
// a helmet, for example, or to layer two cloaks." And Armor: "You can benefit
// from only one shield at a time."
//
// Before this, `equipped` was one flag per row and nothing asked where the
// row sat, so two cloaks or two pairs of bracers worn (or merely carried on
// a sheet that never touched the wear toggle) both applied their riders.
//
// The place comes from the item's row, never from words read inside a name
// someone wrote (a table plays in any language): armor and shields from the
// armor engine (a magic suit is its suit), a workshop item from the place its
// author picked ("Worn on" in the item form, carried as `gear.wornOn`),
// everything else from its whole name in item-slots.json, which
// scripts/generate-item-slots.mjs reads from the content pack's English rows
// once. An item nothing places (loot the model invents, a line typed in
// another language) has no place and no limit. The DM's exception is a row's `layered` flag: worn
// beside another of its kind on the DM's (or the party lead's) say.
//
// Pure and client-safe, like armor.ts: the sheet, the routes and the rules
// engines read the same answer.
import slotsJson from "@/lib/classes/item-slots.json";
import { armorOfRow, isWorn, type WornItem } from "@/lib/srd/armor";
import { textKey } from "@/lib/language/text-logic";
import { isWornPlace } from "@/lib/srd/worn-places";

export type WearSlot = "armor" | "shield" | "cloak" | "head" | "feet" | "hands" | "wrists" | "neck" | "waist" | "ring" | "eyes" | "robe";

// The SRD's limits. Neck, waist, rings, eyes and robes have none beyond
// attunement.
export const WEAR_SLOT_LIMITS: Partial<Record<WearSlot, number>> = {
  armor: 1,
  shield: 1,
  cloak: 1,
  head: 1,
  feet: 1,
  hands: 1,
  wrists: 1,
};

// "a character wears one cloak at a time": the SRD's own words for each kind.
const ONE_OF: Partial<Record<WearSlot, string>> = {
  armor: "one suit of armor",
  shield: "one shield",
  cloak: "one cloak",
  head: "one item of headwear",
  feet: "one pair of footwear",
  hands: "one pair of gloves or gauntlets",
  wrists: "one pair of bracers",
};

// Each row's whole name, the way matchMagicItem compares one: case and
// spacing aside, a "+1" in front and the owner's note in brackets behind
// ("Cloak of Protection (spare)") set aside.
const BY_NAME = new Map<string, WearSlot>();
for (const [slot, names] of Object.entries((slotsJson as { slots: Record<string, string[]> }).slots)) {
  for (const name of names) {
    if (!BY_NAME.has(textKey(name))) {
      BY_NAME.set(textKey(name), slot as WearSlot);
    }
  }
}

// The place the content pack's row of this name has, or null: what a
// workshop copy of a published item starts with.
export function rowSlot(name: string): WearSlot | null {
  const bare = name.trim().replace(/^\+\d\s+/, "");
  return BY_NAME.get(textKey(bare)) ?? BY_NAME.get(textKey(bare.replace(/\s*\([^()]*\)\s*$/, ""))) ?? null;
}

// Any carried row: the magic engines' rows carry gear of their own shapes,
// and only a workshop suit's `gear.armor` is read here (by the armor engine).
export type SlotRow = Omit<WornItem, "gear"> & { gear?: unknown; layered?: boolean; srdName?: string };

const slotCache = new WeakMap<object, { key: string; slot: WearSlot | null }>();

// Where this row is worn, or null for an item with no place on the body.
export function wearSlotOf(item: SlotRow): WearSlot | null {
  const gear = item.gear as (WornItem["gear"] & { wornOn?: unknown }) | undefined;
  const suit = gear?.armor;
  const own = isWornPlace(gear?.wornOn) ? gear.wornOn : null;
  // An item named in the table's language finds its row by the SRD name
  // the DM gave it (srdName, #408), as the sheet's wear toggle does.
  const rowName = item.srdName?.trim() || item.name;
  const key = `${rowName}\u0000${item.slug ?? ""}\u0000${suit ? JSON.stringify(suit) : ""}\u0000${own ?? ""}`;
  const cached = slotCache.get(item);
  if (cached?.key === key) {
    return cached.slot;
  }
  const armor = armorOfRow(item as WornItem)?.armor ?? null;
  const slot: WearSlot | null = armor ? (armor.category === "shield" ? "shield" : "armor") : (own ?? rowSlot(rowName));
  slotCache.set(item, { key, slot });
  return slot;
}

// What a kind is called in a sentence: "a character wears one cloak at a time".
export function oneOfKind(slot: WearSlot): string | null {
  return ONE_OF[slot] ?? null;
}

// The answer for a pack, kept while every row is the same row with the same
// flags (the engines ask once per item of the same pack).
const countedCache = new WeakMap<readonly object[], { items: object[]; flags: string; counted: Set<object> }>();
const flagsOf = (equipment: readonly SlotRow[]) =>
  equipment.map((item) => `${item.equipped}|${item.attuned}|${item.layered}|${item.name}|${item.srdName ?? ""}|${item.slug ?? ""}`).join("\u0001");

// The worn rows whose magic counts: everything worn, except that a limited
// place keeps only as many as it holds. Within a place the rows the DM let
// stand beside another (`layered`) always count; the rest count in order,
// an attuned row before an unattuned one, so a sheet carrying two cloaks
// counts the one it is attuned to. Armor and shields are left whole here:
// the armor engine already counts the best suit and the best shield
// (computeArmorClass), with the wearer's Dexterity, which this cannot see.
export function countedWorn<T extends SlotRow>(equipment: readonly T[]): Set<T> {
  const cached = countedCache.get(equipment);
  const flags = flagsOf(equipment);
  if (cached && cached.flags === flags && cached.items.length === equipment.length && cached.items.every((item, index) => item === equipment[index])) {
    return cached.counted as Set<T>;
  }
  const counted = new Set<T>();
  const byPlace = new Map<WearSlot, T[]>();
  for (const item of equipment) {
    if (!isWorn(item, equipment)) {
      continue;
    }
    const slot = wearSlotOf(item);
    if (!slot || slot === "armor" || slot === "shield" || !WEAR_SLOT_LIMITS[slot]) {
      counted.add(item);
      continue;
    }
    byPlace.set(slot, [...(byPlace.get(slot) ?? []), item]);
  }
  for (const [slot, items] of byPlace) {
    const limit = WEAR_SLOT_LIMITS[slot] ?? items.length;
    for (const item of items.filter((entry) => entry.layered)) {
      counted.add(item);
    }
    const rest = items.filter((entry) => !entry.layered);
    const ordered = [...rest.filter((entry) => entry.attuned), ...rest.filter((entry) => !entry.attuned)];
    for (const item of ordered.slice(0, limit)) {
      counted.add(item);
    }
  }
  countedCache.set(equipment, { items: [...equipment], flags, counted });
  return counted;
}

// Whether this row is worn and its place lets it count.
export function countsAsWorn<T extends SlotRow>(item: T, equipment: readonly T[]): boolean {
  return countedWorn(equipment).has(item);
}

// A worn row whose magic does not count: a second cloak, a third... The
// sheet marks it, and the DM's game state says so.
export function wornButIdle<T extends SlotRow>(item: T, equipment: readonly T[]): WearSlot | null {
  if (!isWorn(item, equipment) || countsAsWorn(item, equipment)) {
    return null;
  }
  return wearSlotOf(item);
}

export type WearConflict = {
  item: string;
  slot: WearSlot;
  // The worn rows filling the place, which come off for this one to go on.
  wearing: string[];
};

// What putting this row on would push past its place's limit, or null.
// `equipment` is the pack as it stands, this row included. A row the DM let
// stand beside another never fills a place.
export function wearConflict<T extends SlotRow>(item: T, equipment: readonly T[]): WearConflict | null {
  const slot = wearSlotOf(item);
  const limit = slot ? WEAR_SLOT_LIMITS[slot] : undefined;
  if (!slot || !limit) {
    return null;
  }
  const filling = equipment.filter(
    (entry) => entry !== item && !entry.layered && isWorn(entry, equipment) && wearSlotOf(entry) === slot,
  );
  return filling.length >= limit ? { item: item.name, slot, wearing: filling.map((entry) => entry.name) } : null;
}

const listOf = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

// The refusal, in one sentence a player can act on.
export function wearConflictText(conflict: WearConflict, who: string): string {
  const kind = oneOfKind(conflict.slot) ?? "one of those";
  const them = conflict.wearing.length > 1 ? "them" : "it";
  return `${who} already wears ${listOf(conflict.wearing)}, and a character wears ${kind} at a time: take ${them} off first, or the DM may allow both.`;
}

// The question the sheet asks before a swap: "Grey Cloak goes where Cloak of
// Protection is: a character wears one cloak at a time."
export function swapQuestion(conflict: WearConflict): string {
  const kind = oneOfKind(conflict.slot) ?? "one of its kind";
  return `${conflict.item} goes where ${listOf(conflict.wearing)} ${conflict.wearing.length > 1 ? "are" : "is"}: a character wears ${kind} at a time.`;
}

// The first conflict a change to the pack makes: a row that was not worn and
// now is, in a place the rows worn after the change overfill. Rows the change
// leaves alone are never blamed, so a pack that already held two (written
// before this rule) does not block taking something else off.
export function firstWearConflict<T extends SlotRow>(before: readonly T[], after: readonly T[]): WearConflict | null {
  for (const [index, item] of after.entries()) {
    const was = before[index];
    if (!isWorn(item, after) || item.layered || (was && isWorn(was, before))) {
      continue;
    }
    const conflict = wearConflict(item, after);
    if (conflict) {
      return conflict;
    }
  }
  return null;
}
