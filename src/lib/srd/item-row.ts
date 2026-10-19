// Which row an inventory item is, as every engine looks it up: the SRD or
// pack row the DM named it by (srdName, #408) when its own name is in the
// table's language ("Mantello di protezione" is the Cloak of Protection),
// else its own name. A pack item is also known by its slug, which the
// finders that index slugs read first.
//
// The finders that serve inventory items (matchWeapon, matchArmor,
// matchMagicItem, gearDefFor, checkRidersOf) take the item rather than a
// string, so none can be handed the name the player sees instead of this
// one. A "+1" stays in the item's own name, where magicItemBonus reads it.
//
// Imports nothing, so the armor and magic-gear tables and the sheet read it
// without a cycle.

export type RowItem = { name: string; slug?: string | null; srdName?: string };

export function rowName(item: RowItem): string {
  return item.srdName ?? item.name;
}
