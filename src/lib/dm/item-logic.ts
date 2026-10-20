import type { EquipmentItem } from "@/lib/schemas/sheet";
import { matchArmor } from "@/lib/srd/armor";
import { matchWeapon } from "@/lib/srd/weapons";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { hasItemTag, itemRow, itemTags, listedRow, type TaggedItem } from "@/lib/srd/item-tags";
import { magicItemNamed } from "@/lib/srd/magic-items";
import { itemNames, lineNamed, magicItemBonus, srdNameWithBonus } from "@/lib/srd/item-row";
import type { ItemTag } from "@/lib/schemas/item-tags";

// Pure consumable knowledge for the use_item tool: healing potion tiers,
// generic consumable detection, and ammunition lookup. Database-free so
// scripts/test-item-logic.mjs imports it directly.

export type ConsumableEffect =
  | { kind: "healing"; expression: string }
  | { kind: "generic" };

// What using this item does. A healing potion gets the dice the SRD's
// Potions of Healing table gives its kind (src/lib/srd/item-tags.ts), a plain
// Potion of Healing's when it names none; everything else is a generic
// consumable (decrement only, model narrates the effect).
export function consumableEffect(item: TaggedItem): ConsumableEffect {
  if (!hasItemTag(item, "healing_potion")) {
    return { kind: "generic" };
  }
  return { kind: "healing", expression: itemRow(item)?.potion?.heals ?? "2d4+2" };
}

// Containment either way, the loose rule both lookups below share.
function looselyNames(name: string, wanted: string): boolean {
  const key = textKey(name);
  return key.includes(wanted) || wanted.includes(key);
}

// Token fallback so "healing potion" still finds "Potion of Healing".
function namesEveryWord(name: string, wanted: string): boolean {
  const key = textKey(name);
  const tokens = wanted.split(" ").filter((token) => token.length > 2);
  return tokens.length > 0 && tokens.every((token) => key.includes(token));
}

// Finds a carried item by fuzzy name: the line the name picks out
// (src/lib/srd/item-row.ts lineNamed), else the loose rules over its own
// and its srdName alike, so "healing potion" finds the "Pozione di
// guarigione" the DM named Potion of Healing.
export function findCarriedItem(equipment: EquipmentItem[], term: string): EquipmentItem | null {
  const wanted = textKey(term);
  if (!wanted) {
    return null;
  }
  return (
    equipment[lineNamed(equipment, term)] ??
    equipment.find((item) => itemNames(item).some((name) => looselyNames(name, wanted))) ??
    equipment.find((item) => itemNames(item).some((name) => namesEveryWord(name, wanted))) ??
    null
  );
}

// Every carried item a use_item name could mean: the items by that very
// name, else those whose srdNameWithBonus it is, else every item the fuzzy
// rules above would take. More than one means the name is ambiguous
// (src/lib/dm/item-use.ts refuses to spend a charged item on a guess).
export function carriedItemsMatching(equipment: EquipmentItem[], term: string): EquipmentItem[] {
  const wanted = textKey(term);
  if (!wanted) {
    return [];
  }
  const own = equipment.filter((item) => textKey(item.name) === wanted);
  if (own.length) {
    return own;
  }
  const listed = equipment.filter((item) => textKey(srdNameWithBonus(item)) === wanted);
  if (listed.length) {
    return listed;
  }
  return equipment.filter((item) =>
    itemNames(item).some((name) => looselyNames(name, wanted) || namesEveryWord(name, wanted)),
  );
}

// Why use_item would not use this item up, or null when it is a
// consumable, by what the item is (src/lib/srd/item-tags.ts). Weapons are
// wielded through pc_attack, armor is worn, and a durable magic item keeps
// its place in the pack; ammunition and thrown weapons are spent by the
// attacks that use them, never here.
export function itemUseProblem(item: TaggedItem): ToolError | null {
  const tags = itemTags(item);
  if (tags.includes("kept")) {
    return { error: tags.includes("water")
      ? "a waterskin is drunk from and refilled, never used up; narrate the drink without use_item."
      : "it is kept, not consumed: a necklace's beads are powers that return at dawn. Narrate its use without use_item.", retry: true };
  }
  // A dagger or a javelin is a weapon first: thrown, it is spent by the
  // attack; used here it would vanish for nothing. A potion or an oil the
  // weapon tables also name is the potion.
  if (matchWeapon(item) && !tags.includes("potion") && !tags.includes("scroll")) {
    return { error: tags.includes("consumable")
      ? "it is a weapon; attacks with it go through pc_attack, which tracks thrown and ammunition use."
      : "it is a weapon; attacks with it go through pc_attack.", retry: true };
  }
  if (tags.includes("consumable")) {
    return null;
  }
  if (matchArmor(item)) {
    return { error: "it is armor, worn rather than used up.", retry: true };
  }
  if (tags.includes("durable")) {
    return { error: "it is kept, not consumed: a wand or staff spends charges on a cast, and worn items work while worn. Narrate its use without use_item.", retry: true };
  }
  return null;
}

// An item a character does not carry. A name the table's rules know (isTableGearName)
// is the game saying no; a name nobody knows is the call's to fix, from what
// they do carry.
export function notCarried(who: string, carried: string[], name: string, known: boolean): ToolError {
  return known
    ? { error: `${who} does not carry "${name}".`, refused: "rules" }
    : {
        error: `${who} carries nothing called "${name}", and no item by that name is known. ${
          carried.length ? `They carry: ${carried.join(", ")}.` : "They carry nothing."
        } Send the one meant, by the name on the sheet.`,
        retry: true,
      };
}

// The row a tool names an item by (srdName), as the lists spell it, or why
// it cannot. Only a name a list holds is taken (src/lib/srd/item-tags.ts
// listedRow, or a magic item's own name): a name no list holds, or one a
// finder would only guess at ("Sword" is no Greatsword, "Weapon" no
// weapon), is asked again rather than stored to mean something else. A
// bonus is asked for in the item's name, the one place the engines read it
// (src/lib/srd/item-row.ts magicItemBonus): the row stored for "Longsword
// +1" would be the Longsword, and the +1 lost. A row the lists name with a
// bonus ("Weapon +1", which a bare "Weapon" finds) is a family of items,
// not one.
export function srdNameFor(srdName: string | undefined, what: string): { srdName?: string } | ToolError {
  const listed = srdName?.trim();
  if (!listed) {
    return {};
  }
  const bonus = magicItemBonus(listed);
  if (bonus) {
    return { error: `${what}: srdName "${listed}" carries a bonus, which belongs in name. Keep "+${bonus}" in name and send srdName as the item without it ("Longsword" for a +1 longsword). Nothing changed.`, retry: true };
  }
  const row = magicItemNamed(listed)?.name ?? listedRow(listed)?.name;
  if (!row) {
    const nearest = itemRow({ name: listed })?.name;
    return { error: `${what}: no SRD or pack item is called "${listed}"${nearest ? ` (the nearest is "${nearest}")` : ""}. Send srdName exactly as the item lists name it in English, or leave it out and name what it is in tags. Nothing changed.`, retry: true };
  }
  if (magicItemBonus(row)) {
    return { error: `${what}: srdName "${listed}" is the lists' "${row}", a family of +1 to +3 items rather than one item. Send srdName as the item it is ("Longsword" for a +1 longsword) with the bonus in name, or leave it out and name what it is in tags. Nothing changed.`, retry: true };
  }
  return { srdName: row };
}

// What a tool says a granted item is: the tags it sent, else a spell scroll
// when it names a spell for a thing no row knows.
export function sentItemTags(item: Pick<TaggedItem, "name" | "srdName">, tags: ItemTag[] | undefined, spell: string | undefined): ItemTag[] | undefined {
  return tags ?? (spell?.trim() && !itemRow(item) ? ["consumable", "scroll"] : undefined);
}
