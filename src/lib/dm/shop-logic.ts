import { COPPER_PER_GOLD, formatPrice, packCostCopper } from "@/lib/srd/currency";
import { compareNames, textKey } from "@/lib/language/text-logic";
import { lineNamed } from "@/lib/srd/item-row";

// Shops (docs/vtt-parity-implementation-plan.md 11.1): pure pricing and
// stocking. Prices come from the content pack's cost strings, marked up by
// the settlement's size; a haggle moves the markup one step; the keeper
// buys at half. Stock is a list of lines the DM or a preset writes.
//
// A shelf a person wrote by hand is kept apart from the stock it starts
// (#171): the stock is what is on the shelf now, after the table's
// purchases and sales; the prepared shelf is what a restock refills it to.
// A shop stocked from the pack has no prepared shelf and rerolls instead.

export const SHOP_SIZES = ["hamlet", "village", "town", "city"] as const;
export type ShopSize = (typeof SHOP_SIZES)[number];

export const SHOP_KINDS = ["general", "smith", "apothecary", "outfitter", "curiosities"] as const;
export type ShopKind = (typeof SHOP_KINDS)[number];

// srdName: the SRD or pack row a line named in the table's language is,
// picked from the catalog, so what is bought is that row.
export type StockLine = { itemName: string; qty: number; priceCp: number; note: string; srdName?: string };

// The dearest a shelf line may be priced, in copper (a million gold): high
// enough for any legendary item, low enough that a typed slip cannot put a
// number on the shelf no purse could ever be compared against.
export const MAX_STOCK_PRICE_CP = 100_000_000;

export type Shop = {
  id: string;
  campaignId: string;
  locationId: string;
  locationName: string;
  name: string;
  keeperNpcId: string;
  kind: ShopKind;
  size: ShopSize;
  stock: StockLine[];
  // The shelf as its author wrote it, or null for a shop the pack stocks.
  preparedStock: StockLine[] | null;
  // A multiplier on the pack's cost: 1.0 is list price. Clamped to the ladder.
  markup: number;
  buys: boolean;
  restockDays: number;
  // The clock instant of the last restock, so the next is due after
  // restockDays of in-world time.
  restockedAt: number;
  // Characters who already haggled here; one try per visit.
  haggledBy: string[];
  createdAt: string;
  updatedAt: string;
};

// The markup ladder a haggle walks: a village starts a notch above list,
// a city at list, and nothing goes below a fifth off or above double.
export const MARKUP_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 2] as const;

export const SIZE_MARKUP: Record<ShopSize, number> = { hamlet: 1.25, village: 1.1, town: 1, city: 1 };
export const SIZE_STOCK_LINES: Record<ShopSize, number> = { hamlet: 6, village: 10, town: 16, city: 24 };

export function normalizeShopSize(raw: unknown): ShopSize {
  return (SHOP_SIZES as readonly string[]).includes(String(raw)) ? (raw as ShopSize) : "village";
}

export function normalizeShopKind(raw: unknown): ShopKind {
  return (SHOP_KINDS as readonly string[]).includes(String(raw)) ? (raw as ShopKind) : "general";
}

export function clampMarkup(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(MARKUP_STEPS[MARKUP_STEPS.length - 1], Math.max(MARKUP_STEPS[0], value));
}

// The nearest rung of the ladder, so a haggle always has a next step.
function markupRung(markup: number): number {
  let best = 0;
  for (const [index, step] of MARKUP_STEPS.entries()) {
    if (Math.abs(step - markup) < Math.abs(MARKUP_STEPS[best] - markup)) {
      best = index;
    }
  }
  return best;
}

// A won haggle drops the markup a step; a lost one raises it a step, which
// is why a haggle is a gamble and not a free discount.
export function haggleStep(markup: number, success: boolean): number {
  const rung = markupRung(clampMarkup(markup));
  const next = success ? Math.max(0, rung - 1) : Math.min(MARKUP_STEPS.length - 1, rung + 1);
  return MARKUP_STEPS[next];
}

// The haggle's DC: harder in a small place with fewer buyers to lose.
export function haggleDc(size: ShopSize): number {
  return size === "hamlet" ? 17 : size === "village" ? 15 : size === "town" ? 13 : 12;
}

// A pack cost string ("15 gp", "2 sp", "5,000 gp") in copper, or null.
export function costToCopper(cost: string): number | null {
  const parsed = packCostCopper(cost);
  return parsed === null || parsed <= 0 ? null : parsed;
}

// What the keeper asks, and what they pay: list times markup, rounded to
// whole copper, never under a copper; buying back at half list.
export function askingPriceCp(listCp: number, markup: number): number {
  return Math.max(1, Math.round(listCp * clampMarkup(markup)));
}

export function offerPriceCp(listCp: number): number {
  return Math.max(1, Math.floor(listCp / 2));
}

// A stock line by the names a carried line answers to (lineNamed): its
// whole name, else the row it is listed as, so "Longsword" buys the "Spada
// lunga" picked from the catalog. A miss is refused with the shelf listed.
export function findStockLine(stock: StockLine[], name: string): StockLine | null {
  const rows = stock.map((line) => ({ name: line.itemName, srdName: line.srdName }));
  return stock[lineNamed(rows, name)] ?? null;
}

// Take qty of a line out of the stock, dropping it at zero; null when the
// shop has fewer than asked.
export function takeStock(stock: StockLine[], itemName: string, qty: number): StockLine[] | null {
  const line = findStockLine(stock, itemName);
  if (!line || line.qty < qty) {
    return null;
  }
  return stock.map((entry) => (entry === line ? { ...entry, qty: entry.qty - qty } : entry)).filter((entry) => entry.qty > 0);
}

// Put qty of an item into stock at the keeper's list price, merging by name,
// with the row it is.
export function addStock(stock: StockLine[], itemName: string, qty: number, priceCp: number, srdName?: string): StockLine[] {
  const existing = stock.find((line) => textKey(line.itemName) === textKey(itemName));
  if (existing) {
    return stock.map((line) => (line === existing ? { ...line, qty: line.qty + qty } : line));
  }
  return [...stock, { itemName: itemName.slice(0, 80), qty, priceCp: Math.max(1, Math.round(priceCp)), note: "", ...(srdName ? { srdName } : {}) }];
}

// The magic a shelf of this size carries (SRD 5.2, Magic Item Rarity):
// common items are often sold in towns and cities, uncommon and rare ones
// usually only in cities, and nothing rarer is for sale. A curiosity shop
// the DM puts in a village still keeps its commons.
export const SHELF_RARITIES: Record<ShopSize, readonly string[]> = {
  hamlet: ["common"],
  village: ["common"],
  town: ["common"],
  city: ["common", "uncommon", "rare"],
};

// How much of a shelf each rarity takes, by weight, so a city's curiosity
// shop is mostly things a party might afford beside a few to save for.
// Goods with no rarity weigh as commons.
const RARITY_WEIGHT: Record<string, number> = { "": 3, common: 3, uncommon: 2, rare: 1 };

// One of the items left: a rarity by its weight when the pool mixes them,
// then any item of it.
function pickIndex(items: ReadonlyArray<{ rarity: string }>, random: () => number): number {
  const tiers = [...new Set(items.map((item) => item.rarity))];
  if (tiers.length < 2) {
    return Math.floor(random() * items.length);
  }
  const weights = tiers.map((tier) => RARITY_WEIGHT[tier] ?? 1);
  let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
  const tier = tiers.find((_, index) => (roll -= weights[index]) < 0) ?? tiers[tiers.length - 1];
  const inTier = items.flatMap((item, index) => (item.rarity === tier ? [index] : []));
  return inTier[Math.floor(random() * inTier.length)];
}

// Stock from a pool of priced items: the staples the pool marks first, then
// a fixed count of lines for the size, chosen by the dice handed in; a few of
// each of the cheap things and one of anything dear. A magic item comes only
// in the rarities the size sells.
export function stockFromPool(
  pool: Array<{ name: string; cost: string; category?: string; staple?: boolean; rarity?: string }>,
  size: ShopSize,
  random: () => number = Math.random,
): StockLine[] {
  const priced = pool
    .filter((item) => !item.rarity || SHELF_RARITIES[size].includes(item.rarity))
    .map((item) => ({ name: item.name, cp: costToCopper(item.cost), staple: Boolean(item.staple), rarity: item.rarity ?? "" }))
    .filter((item): item is { name: string; cp: number; staple: boolean; rarity: string } => item.cp !== null);
  const line = (item: { name: string; cp: number }): StockLine => {
    const qty = item.cp >= 50 * COPPER_PER_GOLD ? 1 : item.cp >= 5 * COPPER_PER_GOLD ? 1 + Math.floor(random() * 3) : 2 + Math.floor(random() * 6);
    return { itemName: item.name, qty, priceCp: item.cp, note: "" };
  };
  const byName = (a: StockLine, b: StockLine) => compareNames(a.itemName, b.itemName);
  const staples = priced.filter((item) => item.staple).map(line).sort(byName);
  const picked: StockLine[] = [];
  const remaining = priced.filter((item) => !item.staple);
  const want = Math.min(SIZE_STOCK_LINES[size], remaining.length);
  while (picked.length < want && remaining.length) {
    const [item] = remaining.splice(pickIndex(remaining, random), 1);
    picked.push(line(item));
  }
  // Staples lead, so the twelve lines the prompt and the tool's reply show
  // always hold them.
  return [...staples, ...picked.sort(byName)];
}

// A restock of a prepared shelf: every prepared line back up to its
// prepared count at its prepared price, in the author's order, and anything
// the keeper bought from the party since still on the shelf after them.
export function refillStock(stock: StockLine[], prepared: StockLine[]): StockLine[] {
  const now = new Map(stock.map((line) => [textKey(line.itemName), line]));
  const refilled = prepared.map((line) => {
    const current = now.get(textKey(line.itemName));
    return { ...line, qty: Math.max(line.qty, current?.qty ?? 0) };
  });
  const authored = new Set(prepared.map((line) => textKey(line.itemName)));
  return [...refilled, ...stock.filter((line) => !authored.has(textKey(line.itemName)))];
}

// The item kinds each shop kind stocks, for the pool the tool draws from.
// staples are what the kind always carries, one line each (the pool marks the
// first name each one matches: the pack's two editions write "Rations" and
// "Rations (1 day)"), beside the lines the dice pick. A general store drew
// ten lines from some 300 pieces of gear, so a torch was on a village shelf
// about one visit in thirty and "I buy a torch" was refused (2026-10-20).
// skip names the pack's categories the kind never sells: a general store
// offered camels, galleys, a cow and Assassin's Blood. Magic items are priced
// by rarity (src/lib/srd/magic-item-value.ts); an apothecary's are its
// potions and oils, not a Periapt of Proof against Poison.
export const KIND_POOL: Record<ShopKind, { kinds: Array<"weapon" | "armor" | "gear" | "magic_item">; match?: RegExp; staples?: RegExp; skip?: readonly string[] }> = {
  general: {
    kinds: ["gear"],
    staples: /^(torch|rations|rope|waterskin|tinderbox|bedroll|backpack|oil(?! of)|candle|blanket)\b/i,
    skip: ["trade good", "poison", "waterborne vehicle", "land vehicle", "mount", "wondrous item"],
  },
  smith: { kinds: ["weapon", "armor"] },
  apothecary: { kinds: ["gear", "magic_item"], match: /potion|antitoxin|healer|herb|oil|vial|acid|poison/i, skip: ["wondrous item", "ammunition"] },
  outfitter: { kinds: ["gear", "armor"], match: /pack|rope|tent|bedroll|rations|torch|lantern|cloak|boots|leather|climber|waterskin|backpack|tinder/i },
  curiosities: { kinds: ["magic_item"] },
};

// Restock is due once restockDays of clock time have passed.
export function restockDue(shop: Pick<Shop, "restockDays" | "restockedAt">, instant: number, minutesPerDay: number): boolean {
  return shop.restockDays > 0 && instant - shop.restockedAt >= shop.restockDays * minutesPerDay;
}

// The prompt's line per shop at the party's place: name, keeper, and what
// is on the shelves with the asking price in coin.
export function renderShopsForPrompt(shops: Array<Shop & { keeperName: string }>): string {
  if (!shops.length) {
    return "";
  }
  const lines = shops.slice(0, 4).map((shop) => {
    const shelf = shop.stock
      .slice(0, 12)
      .map((line) => `${line.itemName} x${line.qty} at ${formatPrice(askingPriceCp(line.priceCp, shop.markup))}`)
      .join("; ");
    return `- ${shop.name}${shop.keeperName ? ` (kept by ${shop.keeperName})` : ""}, ${shop.kind}${shop.buys ? ", buys at half" : ", does not buy"}: ${shelf || "bare shelves"}`;
  });
  return `SHOPS HERE (prices are the server's; purchase moves the coin and the goods at this shelf's prices, haggle moves the price one step):\n${lines.join("\n")}`;
}
