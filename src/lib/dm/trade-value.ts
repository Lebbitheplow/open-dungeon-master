// What a thing is worth when it changes hands, from the table rather than
// from the model's word.
//
// SRD 5.1, Selling Treasure: "As a general rule, undamaged weapons, armor,
// and other equipment fetch half their cost when sold in a market." And:
// "Gems, jewelry, and art objects retain their full value in the
// marketplace, and you can sell them for coin or trade them as though they
// were coin." Trade goods, likewise, are "as good as cash".
//
// The list price comes from the content pack. Anything the pack does not
// price carries the worth the tool that gave it set, in gold pieces
// (`worth`: grant_item, reveal_item, a purchase at the model's price). A name
// is never read for a price: "Ruby (1000 gp)" is only a name, and the model
// could set any price by naming the item.

import { searchItems } from "@/lib/content";
import { matchMagicItem } from "@/lib/srd/magic-items";
import { COPPER_PER_GOLD, parseCoins } from "@/lib/srd/currency";
import { textKey } from "@/lib/language/text-logic";
import { hasItemTag, type TaggedItem } from "@/lib/srd/item-tags";
import type { ItemTag } from "@/lib/schemas/item-tags";
import type { ToolError } from "@/lib/dm/tool-errors";

export type TradedItem = TaggedItem & { worth?: number };

// The name before a trailing note: "Plate Armor (1 gp)" is priced as plate
// armor, never at the note.
function withoutNote(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// A magic item is never treasure-by-weight, whatever it is made of: a Pearl
// of Power, a Gem of Seeing, a Necklace of Fireballs. Known from the
// bundled magic item table, and from the pack's magic items when it is here.
function isMagicItem(name: string): boolean {
  const bare = withoutNote(name);
  if (!bare) {
    return false;
  }
  if (matchMagicItem(bare)) {
    return true;
  }
  const wanted = textKey(bare);
  return searchItems({ q: bare, kind: "magic_item", limit: 8 }).some((item) => {
    const known = textKey(item.name);
    return known === wanted || wanted.startsWith(`${known} (`) || wanted.startsWith(`${known},`);
  });
}

// The pack's rows whose name is exactly this one. The search matches any
// name containing the words and sorts by name, so the plain "Shield" sits
// behind a page of Animated and Arrow-Catching Shields: every page is read
// until the names run out, not only the first few rows.
const PAGE = 200;
function packItemsNamed(bare: string): ReturnType<typeof searchItems> {
  const wanted = textKey(bare);
  if (!wanted) {
    return [];
  }
  const found: ReturnType<typeof searchItems> = [];
  for (let offset = 0; offset < PAGE * 10; offset += PAGE) {
    const page = searchItems({ q: bare, limit: PAGE, offset });
    found.push(...page.filter((item) => textKey(item.name) === wanted));
    if (page.length < PAGE) {
      break;
    }
  }
  return found;
}

// A piece of ordinary gear the pack prices (a Signet Ring at 5 gp): it sells
// for half like any other equipment.
function isPricedGear(name: string): boolean {
  return packListCp(name) !== null;
}

// Whether a thing is treasure that keeps its value: a gem, a piece of
// jewelry or art, a trade good (src/lib/srd/item-tags.ts), and not a magic
// item or priced gear.
const TREASURE: ItemTag[] = ["gem", "art_object", "trade_good"];
function isTreasure(item: TradedItem): boolean {
  if (!TREASURE.some((tag) => hasItemTag(item, tag))) {
    return false;
  }
  const listed = item.srdName ?? item.name;
  return !isMagicItem(listed) && !isPricedGear(listed);
}

// Gems, jewelry, art objects and trade goods keep their full value.
export function keepsFullValue(item: TradedItem): boolean {
  return isTreasure(item);
}

// The pack's list price for exactly this item, in copper, or null: by its
// whole name, else the name before a trailing note.
export function packListCp(name: string): number | null {
  // A priced row first: the pack lists some names twice (Shield as armor
  // and as gear), and a magic item of the same name carries no cost.
  const named = packItemsNamed(name);
  const rows = named.length ? named : packItemsNamed(withoutNote(name));
  const known = rows.find((item) => item.kind !== "magic_item" && Boolean(item.cost)) ?? rows[0];
  const copper = known?.cost ? parseCoins(known.cost.replace(/,/g, "")) : null;
  return copper && copper > 0 ? copper : null;
}

// The list price the table holds for a thing: the pack's price when it knows
// the item, else the worth it was given. Null when neither knows it.
export function listPriceCp(item: TradedItem): number | null {
  return packListCp(item.srdName ?? item.name) ?? (item.worth ? Math.round(item.worth * COPPER_PER_GOLD) : null);
}

// Why a worth cannot be given to this item, or null when it can: the pack's
// price is the item's, whatever worth a tool names.
export function worthProblem(name: string, worth: number | undefined, what: string): ToolError | null {
  if (worth === undefined || packListCp(name) === null) {
    return null;
  }
  return { error: `${what}: "${name}" has a list price in the content pack, which is its worth; leave worth out. Nothing changed.`, retry: true };
}

// What a seller is paid for one, from its list price: full for gems, art
// and trade goods, half for everything else.
export function saleValueCp(item: TradedItem, listCp: number): number {
  return keepsFullValue(item) ? listCp : Math.max(1, Math.floor(listCp / 2));
}
