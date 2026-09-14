import { COPPER_PER_GOLD, formatCopper, parseCoins } from "@/lib/srd/currency";

// Shops (docs/vtt-parity-implementation-plan.md 11.1): pure pricing and
// stocking. Prices come from the content pack's cost strings, marked up by
// the settlement's size; a haggle moves the markup one step; the keeper
// buys at half. Stock is a list of lines the DM or a preset writes.

export const SHOP_SIZES = ["hamlet", "village", "town", "city"] as const;
export type ShopSize = (typeof SHOP_SIZES)[number];

export const SHOP_KINDS = ["general", "smith", "apothecary", "outfitter", "curiosities"] as const;
export type ShopKind = (typeof SHOP_KINDS)[number];

export type StockLine = { itemName: string; qty: number; priceCp: number; note: string };

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
  const parsed = parseCoins(cost);
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

export function formatPriceCp(cp: number): string {
  return formatCopper(cp);
}

export function goldFromCopper(cp: number): number {
  return Math.round((cp / COPPER_PER_GOLD) * 100) / 100;
}

// Find a stock line by name, loosely: exact first, then a line that
// contains the words asked for.
export function findStockLine(stock: StockLine[], name: string): StockLine | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) {
    return null;
  }
  const exact = stock.find((line) => line.itemName.toLowerCase() === wanted);
  if (exact) {
    return exact;
  }
  const loose = stock.filter((line) => line.itemName.toLowerCase().includes(wanted) || wanted.includes(line.itemName.toLowerCase()));
  return loose.length === 1 ? loose[0] : null;
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

// Put qty of an item into stock at the keeper's list price, merging by name.
export function addStock(stock: StockLine[], itemName: string, qty: number, priceCp: number, note = ""): StockLine[] {
  const existing = stock.find((line) => line.itemName.toLowerCase() === itemName.toLowerCase());
  if (existing) {
    return stock.map((line) => (line === existing ? { ...line, qty: line.qty + qty } : line));
  }
  return [...stock, { itemName: itemName.slice(0, 80), qty, priceCp: Math.max(1, Math.round(priceCp)), note: note.slice(0, 120) }];
}

// Stock from a pool of priced items: a fixed count of lines for the size,
// chosen by the dice handed in, a few of each of the cheap things and one
// of anything dear.
export function stockFromPool(
  pool: Array<{ name: string; cost: string; category?: string }>,
  size: ShopSize,
  random: () => number = Math.random,
): StockLine[] {
  const priced = pool
    .map((item) => ({ name: item.name, cp: costToCopper(item.cost) }))
    .filter((item): item is { name: string; cp: number } => item.cp !== null);
  const picked: StockLine[] = [];
  const remaining = [...priced];
  const want = Math.min(SIZE_STOCK_LINES[size], remaining.length);
  while (picked.length < want && remaining.length) {
    const index = Math.floor(random() * remaining.length);
    const [item] = remaining.splice(index, 1);
    const qty = item.cp >= 50 * COPPER_PER_GOLD ? 1 : item.cp >= 5 * COPPER_PER_GOLD ? 1 + Math.floor(random() * 3) : 2 + Math.floor(random() * 6);
    picked.push({ itemName: item.name, qty, priceCp: item.cp, note: "" });
  }
  return picked.sort((a, b) => a.itemName.localeCompare(b.itemName));
}

// The item kinds each shop kind stocks, for the pool the tool draws from.
export const KIND_POOL: Record<ShopKind, { kinds: Array<"weapon" | "armor" | "gear" | "magic_item">; match?: RegExp }> = {
  general: { kinds: ["gear"] },
  smith: { kinds: ["weapon", "armor"] },
  apothecary: { kinds: ["gear", "magic_item"], match: /potion|antitoxin|healer|herb|oil|vial|acid|poison/i },
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
      .map((line) => `${line.itemName} x${line.qty} at ${formatCopper(askingPriceCp(line.priceCp, shop.markup))}`)
      .join("; ");
    return `- ${shop.name}${shop.keeperName ? ` (kept by ${shop.keeperName})` : ""}, ${shop.kind}${shop.buys ? ", buys at half" : ", does not buy"}: ${shelf || "bare shelves"}`;
  });
  return `SHOPS HERE (prices are the server's; buy_item and sell_item move the coin and the goods, haggle moves the price one step):\n${lines.join("\n")}`;
}
