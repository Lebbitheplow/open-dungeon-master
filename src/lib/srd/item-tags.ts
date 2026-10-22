// What an item is, as the engines read it: a potion, a torch, a focus, a
// ration, ammunition. One rule for every table language: the tags an item
// carries, else the tags of the row it names, found by its slug or its whole
// English name (the content pack's rows and the SRD potions' kinds, read
// into src/lib/classes/item-tags.json by scripts/generate-item-tags.mjs; the
// SRD gear, weapon, armor and poison tables and the bundled magic items for
// the spellings they know), never by words read inside the name someone
// wrote. An item no row knows (loot the model invents, a homebrew item, a
// line a player typed in their language) is what its stored tags say, and
// nothing when it has none.
//
// Pure, so the sheet, the engines and the test scripts read the same tags.

import { catalogName } from "@/lib/srd/adventuring-gear";
import { rowArmor } from "@/lib/srd/armor";
import { matchMagicItem } from "@/lib/srd/magic-items";
import { rowWeapon } from "@/lib/srd/weapons";
import { rowName } from "@/lib/srd/item-row";
import { findPoison } from "@/lib/srd/afflictions";
import itemTagsJson from "@/lib/classes/item-tags.json";
import { textKey } from "@/lib/language/text-logic";
import { pluralForms } from "@/lib/srd/name-forms";
import type { ItemTag } from "@/lib/schemas/item-tags";

export type TaggedItem = {
  name: string;
  slug?: string;
  // The row's English name, when the item's own name is the table's.
  srdName?: string;
  tags?: readonly ItemTag[];
  identified?: boolean;
  // A homebrew item's snapshot (src/lib/homebrew/item-data.ts), whatever
  // else it holds.
  gear?: { tags?: readonly ItemTag[]; [field: string]: unknown };
};

// One kind of an SRD potion whose table gives its number: Healing's dice, a
// giant's Strength, the damage type resisted.
export type PotionKind = { heals?: string; strength?: number; resists?: string };

export type ItemRow = { name: string; tags: readonly ItemTag[]; potion?: PotionKind };

const TABLE = itemTagsJson as unknown as {
  items: Array<[string, string, ItemTag[]]>;
  added: Array<[string, ItemTag[]]>;
  potions: Array<[string, ItemTag[], PotionKind]>;
};

// A row's key: its whole name with a trailing count and a magic bonus aside
// ("Arrows (20)", "+1 Shield").
function rowKey(name: string): string {
  return textKey(name.replace(/\(\s*\d+\s*\)\s*$/, " "))
    .split(" ")
    .filter((part) => !/^[+-]/.test(part))
    .join(" ");
}

const BY_SLUG = new Map<string, ItemRow>();
const BY_KEY = new Map<string, ItemRow>();
function index(row: ItemRow) {
  const key = rowKey(row.name);
  for (const form of key ? pluralForms(key) : []) {
    if (!BY_KEY.has(form)) {
      BY_KEY.set(form, row);
    }
  }
}
// The SRD's Potions of Healing, by kind: the rows a healing potion names.
export const HEALING_POTIONS = TABLE.potions.filter(([, , kind]) => kind.heals).map(([name]) => name);

// The potions' kinds first: "Potion of Healing" is the kind its table gives
// the dice of.
for (const [name, tags, potion] of TABLE.potions) {
  index({ name, tags, potion });
}
for (const [name, tags] of TABLE.added) {
  index({ name, tags });
}
for (const [name, slug, tags] of TABLE.items) {
  const row = { name, tags };
  BY_SLUG.set(slug, row);
  index(row);
}

// By the whole name, else the name before a trailing note ("Spell Scroll
// (Fireball)", "Oil (flask)").
function rowNamed(name: string): ItemRow | null {
  return BY_KEY.get(rowKey(name)) ?? BY_KEY.get(rowKey(name.replace(/\s*\([^)]*\)\s*$/, ""))) ?? null;
}

// The row an item names: by its slug, else by its row's name
// (src/lib/srd/item-row.ts) as the tables spell it, else by the weapon,
// armor or poison that name is ("+1 Longsword"). Null for a name no table
// knows.
export function itemRow(item: Pick<TaggedItem, "name" | "slug" | "srdName">): ItemRow | null {
  const bySlug = item.slug ? BY_SLUG.get(item.slug) : undefined;
  if (bySlug) {
    return bySlug;
  }
  const name = rowName(item);
  const spelled = matchMagicItem(item)?.name ?? catalogName(name) ?? name;
  const found = rowNamed(spelled) ?? rowNamed(name);
  if (found) {
    return found;
  }
  const named = rowWeapon(item)?.name ?? rowArmor(item)?.name ?? findPoison(name)?.name;
  return named ? (rowNamed(named) ?? { name: named, tags: [] }) : null;
}

// An item's tags: its row's, with its own when it carries them or a
// homebrew item's entry's (a silvered Longsword is the Longsword's and
// "silvered"). An unidentified item has none: its name is the party's
// description and its secret is never written on the sheet.
export function itemTags(item: TaggedItem): readonly ItemTag[] {
  if (item.identified === false) {
    return [];
  }
  const own = item.tags ?? item.gear?.tags ?? [];
  const row = itemRow(item)?.tags ?? [];
  return own.length ? [...new Set([...row, ...own])] : row;
}

export function hasItemTag(item: TaggedItem, tag: ItemTag): boolean {
  return itemTags(item).includes(tag);
}
