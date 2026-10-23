// What a thing is worth when it changes hands, from the table rather than
// from the model's word.
//
// SRD 5.1, Selling Treasure: "As a general rule, undamaged weapons, armor,
// and other equipment fetch half their cost when sold in a market." And:
// "Gems, jewelry, and art objects retain their full value in the
// marketplace, and you can sell them for coin or trade them as though they
// were coin." Trade goods, likewise, are "as good as cash".
//
// The list price comes from the content pack. The pack prices no magic item,
// so one is worth its rarity's value under the 2014 rules
// (src/lib/srd/magic-item-value.ts).
// Anything the table does not price carries the worth the tool that gave it
// set, in gold pieces (`worth`: grant_item, reveal_item, a purchase at the
// model's price). A name is never read for a price: "Ruby (1000 gp)" is only
// a name, and the model could set any price by naming the item.

import { searchItems } from "@/lib/content";
import { magicItemNamed } from "@/lib/srd/magic-items";
import { bonusItemValue, easilySold, magicItemValue, type PricedRarity } from "@/lib/srd/magic-item-value";
import { magicItemBonus, rowName, srdNameWithBonus, withoutBonus, type RowItem } from "@/lib/srd/item-row";
import { COPPER_PER_GOLD, packCostCopper } from "@/lib/srd/currency";
import { textKey } from "@/lib/language/text-logic";
import { hasItemTag, type TaggedItem } from "@/lib/srd/item-tags";
import type { ItemTag } from "@/lib/schemas/item-tags";
import type { ToolError } from "@/lib/dm/tool-errors";
import { gearPriceCopper } from "@/lib/srd/adventuring-gear";

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
  if (magicItemNamed(bare)) {
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
  const listed = rowName(item);
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
  const copper = known?.cost ? packCostCopper(known.cost) : null;
  // A row the pack prices at nothing (its 2014 "Acid" next to "Acid (vial)")
  // takes the SRD 5.1 table's price for the same thing.
  return copper && copper > 0 ? copper : gearPriceCopper(name);
}

// The value of the pack's magic item of exactly this name, by its whole name
// or the name before a trailing note, with the rarity that sets it. Null for
// a name the pack has no magic item of, and for one no rarity prices (an
// artifact, a rarity that varies). The first row a rarity prices answers: the
// SRD's Belt of Giant Strength varies, the pack's Level Up (a5e) copy calls it rare.
// A weapon or armor the pack prices, with a bonus in its name ("Longsword
// +1", "+2 Plate"), is priced by that bonus.
export function packMagicValue(name: string): { cp: number; rarity: PricedRarity } | null {
  const bonused = bonusValue(name);
  if (bonused) {
    return bonused;
  }
  for (const row of packMagicRows(name)) {
    const value = magicItemValue(row);
    if (value) {
      return value;
    }
  }
  // A scroll the pack files once, as "Spell Scroll", is priced by the spell
  // its own name carries ("Spell Scroll (Fireball)").
  return magicItemValue({ name, rarity: "", category: "scroll" });
}

// The pack's magic items of exactly this name, or of the name before a
// trailing note ("Spell Scroll (Fireball)" is the pack's Spell Scroll).
function packMagicRows(name: string): ReturnType<typeof searchItems> {
  const magic = (bare: string) => packItemsNamed(bare).filter((item) => item.kind === "magic_item");
  const whole = magic(name);
  return whole.length ? whole : magic(withoutNote(name));
}

// Whether a shop buys this magic item back (SRD 5.1, Selling Treasure): a
// potion or a scroll, by the category of the pack row its srdName names, so
// a "Pozione di guarigione" sells as its Potion of Healing does.
export function soldToShops(item: TradedItem): boolean {
  return packMagicRows(srdNameWithBonus(item)).some(easilySold);
}

// A weapon, armor or shield the pack prices, with the bonus its name
// declares, at SRD 5.1's rarity for that bonus. Read before the pack's own
// rows: its Level Up (a5e) copy files a "Shield +2" as very rare, where the SRD
// the rules follow makes it rare.
function bonusValue(name: string): { cp: number; rarity: PricedRarity } | null {
  const bonus = magicItemBonus(name);
  const base = bonus ? withoutBonus(name) : name;
  if (base === name) {
    return null;
  }
  const row = packItemsNamed(base).find((item) => (item.kind === "weapon" || item.kind === "armor") && packListCp(item.name) !== null);
  const kind = row?.kind === "weapon" ? "weapon" : row?.category === "shield" ? "shield" : "armor";
  return row ? bonusItemValue(kind, bonus) : null;
}

// The magic item value the table holds for a thing, or null when it is no
// magic item or the pack prices it as gear (a Shield, a Potion of healing).
export function magicValueOf(item: TradedItem): { cp: number; rarity: PricedRarity } | null {
  const listed = srdNameWithBonus(item);
  return packListCp(listed) === null ? packMagicValue(listed) : null;
}

// The table's own price for a thing by name: the pack's list price, else a
// magic item's value by its rarity.
function tablePriceCp(name: string): number | null {
  return packListCp(name) ?? packMagicValue(name)?.cp ?? null;
}

// The list price the table holds for a thing: the pack's price or a magic
// item's value when it knows the item, else the worth it was given. Null
// when neither knows it. The pack is read by srdNameWithBonus
// (src/lib/srd/item-row.ts), so a "Spada lunga +1" is no 15 gp longsword, as
// a "Longsword +1" is not.
export function listPriceCp(item: TradedItem): number | null {
  return tablePriceCp(srdNameWithBonus(item)) ?? (item.worth ? Math.round(item.worth * COPPER_PER_GOLD) : null);
}

// Why a worth cannot be given to this item, or null when it can: the table's
// price is the item's, whatever worth a tool names.
export function worthProblem(item: RowItem, worth: number | undefined, what: string): ToolError | null {
  if (worth === undefined || tablePriceCp(srdNameWithBonus(item)) === null) {
    return null;
  }
  return {
    error: `${what}: "${item.name}" has a price the rules set (the content pack's list price, or a magic item's value by its rarity under the 2014 rules), which is its worth; leave worth out. Nothing changed.`,
    retry: true,
  };
}

// What a seller is paid for one, from its list price: full for gems, art
// and trade goods, half for everything else.
export function saleValueCp(item: TradedItem, listCp: number): number {
  return keepsFullValue(item) ? listCp : Math.max(1, Math.floor(listCp / 2));
}
