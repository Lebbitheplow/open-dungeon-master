import type { EquipmentItem } from "@/lib/schemas/sheet";
import { matchArmor } from "@/lib/srd/armor";
import { matchWeapon } from "@/lib/srd/weapons";
import type { ToolError } from "@/lib/dm/tool-errors";
import { hasItemTag, itemRow, itemTags, type TaggedItem } from "@/lib/srd/item-tags";
import { magicItemNamed } from "@/lib/srd/magic-items";
import { lineNamed, linesNamed, magicItemBonus } from "@/lib/srd/item-row";
import type { ItemTag } from "@/lib/schemas/item-tags";
import { compositeGearNamed } from "@/lib/srd/magic-gear";

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

// The carried item a tool's name picks out (src/lib/srd/item-row.ts
// lineNamed): "Potion of Healing" finds the "Pozione di guarigione" the DM
// named by it, and "healing potion" finds neither.
export function findCarriedItem(equipment: EquipmentItem[], term: string): EquipmentItem | null {
  return equipment[lineNamed(equipment, term)] ?? null;
}

// Every carried item a use_item name picks out. More than one means the
// name is ambiguous (src/lib/dm/item-use.ts refuses to spend a charged item
// on a guess): two lines answer to "Potion of Healing" when both are one
// under names of their own.
export function carriedItemsMatching(equipment: EquipmentItem[], term: string): EquipmentItem[] {
  return linesNamed(equipment, term);
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
      // Said of every kept item (a Necklace of Adaptation as well as Prayer
      // Beads), so it names no one item's rule.
      : "it is kept, not consumed: it works while it is worn or carried, and a power it has comes back with time rather than being used up. Narrate its use without use_item.", retry: true };
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

// What a tool that puts an item in a pack tells the model, as a hit says it
// applied its damage: a model that grants it again leaves two, and one told
// only of the coin hands the item over or trades something in besides.
export function alreadyInPack(who: string, paid: boolean): string {
  return paid
    ? `The trade is done: the server put it in ${who}'s pack and took the coin, and nothing else changed hands. Do NOT call grant_item, modify_gold or handle_item for this trade.`
    : `The server already put it in ${who}'s pack. Do NOT call grant_item for it.`;
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
// it cannot. Only a whole name a list or table holds is taken (the row
// src/lib/srd/item-tags.ts itemRow finds, a magic item's own name, or a
// magic weapon or armor with its base as src/lib/srd/magic-gear.ts composes
// them), so a weapon goes by its table's name too ("Light Crossbow" as well
// as the book's "Crossbow, light", the setting gear's "Revolver"): a name no
// list holds ("Sword" is no Greatsword, "Weapon" no weapon) is asked again
// rather than stored to mean something else. A
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
  const row = compositeGearNamed(listed)?.name ?? magicItemNamed(listed)?.name ?? itemRow({ name: listed })?.name;
  if (!row) {
    return { error: `${what}: no SRD or pack item is called "${listed}". Send srdName exactly as the item lists name it in English, or leave it out and name what it is in tags. Nothing changed.`, retry: true };
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
