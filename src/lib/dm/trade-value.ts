// What a thing is worth when it changes hands, from the table rather than
// from the model's word.
//
// SRD 5.1, Selling Treasure: "As a general rule, undamaged weapons, armor,
// and other equipment fetch half their cost when sold in a market." And:
// "Gems, jewelry, and art objects retain their full value in the
// marketplace, and you can sell them for coin or trade them as though they
// were coin." Trade goods, likewise, are "as good as cash".
//
// The list price comes from the content pack; a gem or art object named with
// its value ("Ruby (1000 gp)", "a silver chalice worth 25 gp") carries it in
// its name, which is how treasure is granted. Only treasure does: a value
// written into the name of anything else ("Plate Armor (1 gp)") is not a
// price, or the model could set any price by naming the item.

import { searchItems } from "@/lib/content";
import { matchMagicItem } from "@/lib/srd/magic-items";
import { parseCoins } from "@/lib/srd/currency";

const VALUE_PATTERNS = [
  /\(\s*([\d,]+\s*(?:pp|gp|ep|sp|cp))\s*\)/i,
  /\bworth\s+([\d,]+\s*(?:pp|gp|ep|sp|cp))\b/i,
  /[-:]\s*([\d,]+\s*(?:pp|gp|ep|sp|cp))\s*$/i,
];

// The value written into a name, in copper, whatever the thing is. Null when
// the name names none.
function writtenValue(name: string): number | null {
  for (const pattern of VALUE_PATTERNS) {
    const match = pattern.exec(name);
    if (match) {
      const copper = parseCoins(match[1].replace(/,/g, ""));
      return copper && copper > 0 ? copper : null;
    }
  }
  return null;
}

// The name with any written value taken off: "Plate Armor (1 gp)" is
// "Plate Armor".
export function nameWithoutValue(name: string): string {
  let bare = name;
  for (const pattern of VALUE_PATTERNS) {
    bare = bare.replace(pattern, " ");
  }
  return bare.replace(/\s+/g, " ").trim();
}

const GEMS =
  /\b(gem|gems|gemstone|jewel|jewels|jewelry|jewellery|ruby|rubies|sapphire|emerald|diamond|pearl|opal|topaz|garnet|amethyst|jade|jasper|onyx|agate|quartz|citrine|carnelian|chrysoberyl|chrysoprase|chalcedony|coral|jet|tourmaline|zircon|spinel|peridot|obsidian|bloodstone|moonstone|alexandrite|aquamarine|azurite|hematite|lapis lazuli|malachite|turquoise|tiger eye|sardonyx|jacinth|sard)\b/i;
// Signet rings and reliquaries are adventuring gear with a price of their
// own (5 gp each), so they are not here.
const ART =
  /\b(art object|statuette|idol|chalice|goblet|necklace|bracelet|brooch|circlet|crown|tiara|scepter|sceptre|tapestry|painting|figurine of gold|gold ring|silver ring|anklet|locket|mask of gold|icon)\b/i;
const TRADE_GOODS =
  /\b(ingot|bar of (?:gold|silver|platinum|iron|copper)|(?:gold|silver|platinum) bars?|trade goods?|bolt of (?:silk|linen|cloth|canvas)|pound of (?:saffron|cinnamon|pepper|cloves|ginger|salt)|lb\.? of (?:saffron|cinnamon|pepper|cloves|ginger|salt|silk|iron|copper|silver|gold|platinum))\b/i;

// A jewel or ornament named for what it does rather than what it is made of
// ("Necklace of Fireballs", "Crown of Stars") is a magic item even where no
// table knows it; one named for its material ("a necklace of pearls") is
// jewelry.
const MAGIC_NAMED =
  /\b(?:necklace|brooch|circlet|crown|tiara|scepter|sceptre|bracelet|amulet|ring|gem|pearl|stone|figurine|idol|chalice|goblet|mask|locket|icon) of (?!(?:gold|silver|platinum|electrum|copper|brass|bronze|iron|ivory|jade|pearls?|rubies|emeralds|sapphires|diamonds|gems|jewels|amber|coral|bone|obsidian|onyx|crystal|glass|wood|feathers|beads|teeth|shells?|the\s+\w+\s+(?:guild|house|family|temple))\b)[a-z]/i;

// A magic item is never treasure-by-weight, whatever it is made of: a Pearl
// of Power, a Gem of Seeing, a Necklace of Fireballs. Known from the
// bundled magic item table, and from the pack's magic items when it is here.
function isMagicItem(name: string): boolean {
  const bare = nameWithoutValue(name);
  if (!bare) {
    return false;
  }
  if (matchMagicItem(bare) || MAGIC_NAMED.test(bare)) {
    return true;
  }
  const wanted = bare.toLowerCase();
  return searchItems({ q: bare, kind: "magic_item", limit: 8 }).some((item) => {
    const known = item.name.trim().toLowerCase();
    return known === wanted || wanted.startsWith(`${known} (`) || wanted.startsWith(`${known},`);
  });
}

// The pack's rows whose name is exactly this one. The search matches any
// name containing the words and sorts by name, so the plain "Shield" sits
// behind a page of Animated and Arrow-Catching Shields: every page is read
// until the names run out, not only the first few rows.
const PAGE = 200;
function packItemsNamed(bare: string): ReturnType<typeof searchItems> {
  const wanted = bare.trim().toLowerCase();
  if (!wanted) {
    return [];
  }
  const found: ReturnType<typeof searchItems> = [];
  for (let offset = 0; offset < PAGE * 10; offset += PAGE) {
    const page = searchItems({ q: bare, limit: PAGE, offset });
    found.push(...page.filter((item) => item.name.trim().toLowerCase() === wanted));
    if (page.length < PAGE) {
      break;
    }
  }
  return found;
}

// A piece of ordinary gear the pack prices (a Signet Ring at 5 gp): it sells
// for half like any other equipment.
function isPricedGear(name: string): boolean {
  const wanted = nameWithoutValue(name).toLowerCase();
  if (!wanted) {
    return false;
  }
  return packItemsNamed(nameWithoutValue(name)).some(
    (item) => item.kind !== "magic_item" && Boolean(item.cost && parseCoins(item.cost.replace(/,/g, ""))),
  );
}

// Whether a thing is treasure that keeps its value: a gem, a piece of
// jewelry or art, a trade good, and not a magic item or priced gear.
function isTreasure(name: string): boolean {
  const bare = nameWithoutValue(name);
  if (!(GEMS.test(bare) || ART.test(bare) || TRADE_GOODS.test(bare))) {
    return false;
  }
  return !isMagicItem(name) && !isPricedGear(name);
}

// The value written into a treasure's name, in copper: "(50 gp)", "worth
// 25 gp", "- 750 gp". Null for anything that is not treasure, and for a
// name that names no value.
export function valueInName(name: string): number | null {
  const written = writtenValue(name);
  return written !== null && isTreasure(name) ? written : null;
}

// Gems, jewelry, art objects and trade goods keep their full value.
export function keepsFullValue(name: string): boolean {
  return isTreasure(name);
}

// The pack's list price for exactly this item, in copper, or null. A value
// written into the name is set aside first, so "Longsword (15 gp)" is priced
// as a longsword.
export function packListCp(name: string): number | null {
  const bare = nameWithoutValue(name);
  // A priced row first: the pack lists some names twice (Shield as armor
  // and as gear), and a magic item of the same name carries no cost.
  const rows = packItemsNamed(bare);
  const known = rows.find((item) => item.kind !== "magic_item" && Boolean(item.cost)) ?? rows[0];
  const copper = known?.cost ? parseCoins(known.cost.replace(/,/g, "")) : null;
  return copper && copper > 0 ? copper : null;
}

// The list price the table holds for a thing: the pack's price when it knows
// the item, else the value in a treasure's name. Null when neither knows it.
export function listPriceCp(name: string): number | null {
  return packListCp(name) ?? valueInName(name);
}

// What a seller is paid for one, from its list price: full for gems, art
// and trade goods, half for everything else.
export function saleValueCp(name: string, listCp: number): number {
  return keepsFullValue(name) ? listCp : Math.max(1, Math.floor(listCp / 2));
}
