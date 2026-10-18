import type { EquipmentItem } from "@/lib/schemas/sheet";
import { matchArmor } from "@/lib/srd/armor";
import { matchWeapon } from "@/lib/srd/weapons";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { hasItemTag, itemRow, itemTags, type TaggedItem } from "@/lib/srd/item-tags";
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

// Finds a carried item by fuzzy name (containment either way).
export function findCarriedItem(equipment: EquipmentItem[], term: string): EquipmentItem | null {
  const wanted = textKey(term);
  if (!wanted) {
    return null;
  }
  return (
    equipment.find((item) => textKey(item.name) === wanted) ??
    equipment.find(
      (item) =>
        textKey(item.name).includes(wanted) || wanted.includes(textKey(item.name)),
    ) ??
    // Token fallback so "healing potion" still finds "Potion of Healing".
    equipment.find((item) => {
      const name = textKey(item.name);
      const tokens = wanted.split(" ").filter((token) => token.length > 2);
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
  const wanted = textKey(term);
  if (!wanted) {
    return [];
  }
  const exact = equipment.filter((item) => textKey(item.name) === wanted);
  if (exact.length) {
    return exact;
  }
  const tokens = wanted.split(" ").filter((token) => token.length > 2);
  return equipment.filter((item) => {
    const name = textKey(item.name);
    return (
      name.includes(wanted) ||
      wanted.includes(name) ||
      (tokens.length > 0 && tokens.every((token) => name.includes(token)))
    );
  });
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
  if (matchWeapon(item.name) && !tags.includes("potion") && !tags.includes("scroll")) {
    return { error: tags.includes("consumable")
      ? "it is a weapon; attacks with it go through pc_attack, which tracks thrown and ammunition use."
      : "it is a weapon; attacks with it go through pc_attack.", retry: true };
  }
  if (tags.includes("consumable")) {
    return null;
  }
  if (matchArmor(item.name)) {
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

// The row a tool names an item by (srdName), as the row spells it, or why it
// cannot: a name no list holds is asked again rather than stored to mean
// nothing.
export function srdNameFor(srdName: string | undefined, what: string): { srdName?: string } | ToolError {
  const listed = srdName?.trim();
  if (!listed) {
    return {};
  }
  const row = itemRow({ name: listed });
  if (!row) {
    return { error: `${what}: no SRD or pack item is called "${listed}". Send srdName as the item lists name it in English, or leave it out and name what it is in tags. Nothing changed.`, retry: true };
  }
  return { srdName: row.name };
}

// What a tool says a granted item is: the tags it sent, else a spell scroll
// when it names a spell for a thing no row knows.
export function sentItemTags(item: Pick<TaggedItem, "name" | "srdName">, tags: ItemTag[] | undefined, spell: string | undefined): ItemTag[] | undefined {
  return tags ?? (spell?.trim() && !itemRow(item) ? ["consumable", "scroll"] : undefined);
}
