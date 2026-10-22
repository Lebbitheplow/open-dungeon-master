// The SRD weapon or armor a content-pack row of another document is built on,
// which scripts/generate-item-tags.mjs writes onto the row from its English
// name ("Kite shield" is a shield, "Wormsilk Whip" a whip). The weapon and
// armor finders read it by the item's slug or its row's whole name, so a row
// the SRD tables do not name still swings or is worn as its base.
//
// Imports only the table and the row's name, so weapons.ts and armor.ts read
// it without a cycle through item-tags.ts.
import itemTagsJson from "@/lib/classes/item-tags.json";
import { textKey } from "@/lib/language/text-logic";
import { rowName, type RowItem } from "@/lib/srd/item-row";

const ROWS = (itemTagsJson as unknown as { items: Array<[string, string, unknown, string?]> }).items;
const bySlug = new Map<string, string>();
const byKey = new Map<string, string>();
for (const [name, slug, , base] of ROWS) {
  if (base) {
    bySlug.set(slug, base);
    byKey.set(textKey(name), base);
  }
}

export function packBaseOf(item: RowItem): string | null {
  return (item.slug ? bySlug.get(item.slug) : undefined) ?? byKey.get(textKey(rowName(item))) ?? null;
}
