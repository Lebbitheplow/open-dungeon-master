import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import { insertCampaignMessage, listRecentMessages } from "@/lib/db/messages";
import { insertCharacterEvent } from "@/lib/db/character-events";
import { getClock } from "@/lib/db/clock";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getCurrentLocation } from "@/lib/db/locations";
import { getNpcById, getNpcByName } from "@/lib/db/npcs";
import { insertRoll } from "@/lib/db/rolls";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { findShopNear, getShop, insertShop, listShops, listShopsAt, updateShop } from "@/lib/db/shops";
import { searchItems } from "@/lib/content";
import { SRD_GEAR, SRD_GOODS } from "@/lib/srd/adventuring-gear";
import { SRD_ARMOR } from "@/lib/srd/armor";
import { bundledPriceCopper } from "@/lib/srd/starting-wealth";
import { SRD_WEAPONS } from "@/lib/srd/weapons";
import { rollExpression } from "@/lib/dice";
import { grantItemMath, removeItemMath } from "@/lib/dm/mutation-math";
import { resolveRollExpression, resolveSheetRef, type RollArgs, unknownSheetRef } from "@/lib/dm/rolls";
import { rollExtrasFor, spendRollCarriers } from "@/lib/dm/forced-save";
import { sheetsAgainstParty } from "@/lib/dm/combat-sides";
import { turncoatsAtTable } from "@/lib/dm/turncoat";
import { keepsFullValue, listPriceCp, magicValueOf, soldToShops } from "@/lib/dm/trade-value";
import { capacityProblem } from "@/lib/dm/load-rules";
import {
  addStock,
  askingPriceCp,
  findStockLine,
  BAD_FAILURE_MARGIN,
  dealFor,
  dealInWords,
  haggleDc,
  haggleSteps,
  KIND_POOL,
  markupFor,
  normalizeHaggleSkill,
  normalizeShopKind,
  normalizeShopSize,
  offerPriceCp,
  refillStock,
  renderShopsForPrompt,
  restockDue,
  shiftMarkup,
  SIZE_MARKUP,
  stepMoves,
  stockFromPool,
  takeStock,
  type Shop,
} from "@/lib/dm/shop-logic";
import { magicItemValue } from "@/lib/srd/magic-item-value";
import { MINUTES_PER_DAY } from "@/lib/dm/calendar";
import { publishEphemeral, publishPersisted, publishWithSeq } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { addCopper, formatCopper, formatPrice } from "@/lib/srd/currency";
import { noneNamed, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { alreadyInPack, notCarried } from "@/lib/dm/item-logic";
import { isTableGearName } from "@/lib/db/homebrew";
import { containsPhrase, textKey } from "@/lib/language/text-logic";
import { lineNamed } from "@/lib/srd/item-row";
import type { EngineCall, ToolArgs } from "@/lib/dm/tool-merge-logic";

// The shop tools (docs/vtt-parity-implementation-plan.md 11.1). The server
// prices everything: the model names the item, the shelf says what it
// costs, the purse says whether it can be had. Every purchase and sale
// writes the same audit row purchase does, so the ledger reads as one.
//
// The model buys and sells through purchase alone (issue #471): a purchase
// where a shop stands that trades the item reaches buy_item or sell_item
// below (tradeCall), so a trade at a shop never skips its shelf. Both stay
// engine actions under their own names, for the Market and for callers that
// still send them.

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const SHOP_TOOL_NAMES = ["open_shop", "buy_item", "sell_item", "haggle"] as const;

export const shopTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "open_shop",
      description:
        "Open the shop where the party stands. Its keeper, when named, is an NPC from GAME STATE. The server stocks its shelves from the content pack at the settlement size's markup. Call it once when the party first walks in; the shop and its prices then appear in GAME STATE. A shop already standing here (one in SHOPS HERE) is reopened as it is: its shelf, prices and haggles stay, and it restocks only when its restock day has come.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          kind: { type: "string", enum: ["general", "smith", "apothecary", "outfitter", "curiosities"] },
          size: { type: "string", enum: ["hamlet", "village", "town", "city"] },
          keeper: { type: "string" },
        },
        required: ["name", "kind"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "haggle",
      description:
        "A haggling check at a shop: success lowers prices a step, failure leaves them where they were, and failing the DC by 5 or more raises them a step. The server rolls it against the settlement's DC (city 12, town 13, village 15, hamlet 17) with Persuasion, or with skill intimidation (a bad failure raises prices two steps) or deception (a keeper falls for it once: one Deception try per shop). The result and the used try belong to the haggler and the characters in present, the others at the counter now; anyone else pays the shop's normal price and keeps their own try. One try per character per shop until it restocks. Narrate the outcome the reply gives.",
      parameters: {
        type: "object",
        properties: {
          characterId: { type: "string" },
          shop: { type: "string" },
          skill: { type: "string", enum: ["persuasion", "intimidation", "deception"] },
          present: { type: "array", items: { type: "string" }, description: "Others at the counter now, who share the result." },
        },
        required: ["characterId", "shop"],
      },
    },
  },
];

function parse<T extends z.ZodTypeAny>(schema: T, raw: string): z.infer<T> | null {
  try {
    return schema.parse(JSON.parse(raw || "{}"));
  } catch {
    return null;
  }
}

function resolveSheet(campaign: Campaign, ref: string): CharacterSheet | null {
  const sheets = listSheets(campaign.id);
  const stale = resolveSheetRef(ref, sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])));
  return stale ? getSheetById(stale.id) ?? stale : null;
}

// A shop no name found, refused with the shops the campaign has.
function noShop(campaign: Campaign, ref: string): ToolError {
  const refusal = noneNamed("There is no shop called", ref, listShops(campaign.id).map((shop) => shop.name));
  return { ...refusal, error: `${refusal.error} A new one opens with open_shop.` };
}

// By id, or by name at the party's place before anywhere else.
function resolveShop(campaign: Campaign, ref: string): Shop | null {
  const byId = getShop(ref);
  return byId && byId.campaignId === campaign.id ? byId : findShopNear(campaign.id, getCurrentLocation(campaign.id), ref);
}

function publishShops(campaignId: string) {
  publishEphemeral(campaignId, "shops_updated", { at: Date.now() });
}

// One line in the chat when a shop opens or reopens where the party stands:
// "<shop> is open", which the chat draws with a Browse wares button onto
// the Market (MessageItem.tsx). Once per opening: a second open_shop in the
// same breath, with nothing said since, adds no second line.
export function announceShop(campaignId: string, shop: Pick<Shop, "id" | "name">) {
  const [latest] = listRecentMessages(campaignId, 1);
  if (latest?.authorType === "system" && latest.shopId === shop.id) {
    return;
  }
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({ campaignId, seq, authorType: "system", glyph: "cue-coin", shopId: shop.id, content: `${shop.name} is open.` });
  publishWithSeq(campaignId, seq, "message_added", { message });
}

function publishSheet(campaign: Campaign, sheetId: string) {
  const updated = patchSheet(sheetId, {});
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// The pool a shop of this kind stocks from: the pack's items of the right
// kinds, filtered by the kind's words when it has any. Once per name: the
// pack files some items under two documents, and a shelf with two "Barrel"
// lines sells one of them and strands the other. The first item each of the
// kind's staples names is marked, and always goes on the shelf. The pack
// prices no magic item, so each is priced by its rarity under the 2014 rules
// (src/lib/srd/magic-item-value.ts) and carries that rarity for the shelf to
// choose by: commons only (SHELF_RARITIES).
export function stockPool(kind: string): Array<{ name: string; cost: string; staple?: boolean; rarity?: string }> {
  const spec = KIND_POOL[normalizeShopKind(kind)];
  const pool: Array<{ name: string; cost: string; staple?: boolean; rarity?: string }> = [];
  const seen = new Set<string>();
  const stapled = new Set<string>();
  for (const itemKind of spec.kinds) {
    for (const item of packItemsOfKind(itemKind)) {
      const magic = item.kind === "magic_item" ? magicItemValue(item) : undefined;
      const cost = magic === undefined ? item.cost : magic === null ? "" : `${magic.cp} cp`;
      if (!cost || (spec.match && !spec.match.test(item.name)) || spec.skip?.includes(item.category) || seen.has(textKey(item.name))) {
        continue;
      }
      seen.add(textKey(item.name));
      const staple = spec.staples?.exec(item.name)?.[1];
      const first = staple !== undefined && !stapled.has(textKey(staple));
      if (first) {
        stapled.add(textKey(staple));
      }
      const rarity = magic ? magic.rarity : null;
      pool.push({ name: item.name, cost, ...(first ? { staple: true } : {}), ...(rarity ? { rarity } : {}) });
    }
  }
  return pool.length ? pool : bundledPool(spec);
}

// With no content pack installed (or none with this kind's goods), the
// bundled SRD 5.1 tables the builder prices from: weapons, armor,
// adventuring gear, packs and tack at list price, and mounts where the
// kind's skip list does not leave them out. The setting's firearms and genre armor
// and every magic item stay off the shelf, as they do at creation
// (src/lib/srd/starting-wealth.ts), so a curiosities shop stays bare.
// The weapon table prints the SRD's own rows first; the setting's firearms,
// exotics and simple genre weapons (a machete, a hurled vial) follow from
// the first firearm on, and carry no genre mark of their own.
const SRD_TABLE_WEAPONS = SRD_WEAPONS.slice(0, SRD_WEAPONS.findIndex((weapon) => weapon.category === "firearm"));

function bundledPool(spec: (typeof KIND_POOL)[keyof typeof KIND_POOL]): Array<{ name: string; cost: string }> {
  const rows: Array<{ name: string; cp: number | null }> = [
    ...(spec.kinds.includes("weapon") ? SRD_TABLE_WEAPONS.map((weapon) => ({ name: weapon.name, cp: bundledPriceCopper(weapon.name) })) : []),
    ...(spec.kinds.includes("armor") ? SRD_ARMOR.filter((armor) => !armor.genres).map((armor) => ({ name: armor.name, cp: bundledPriceCopper(armor.name) })) : []),
    ...(spec.kinds.includes("gear") ? SRD_GEAR.map((gear) => ({ name: gear.name, cp: gear.costCp })) : []),
    ...(spec.kinds.includes("gear")
      ? SRD_GOODS.filter((goods) => !spec.skip?.includes(goods.category)).map((goods) => ({ name: goods.name, cp: goods.costCp }))
      : []),
  ];
  return rows
    .filter((row): row is { name: string; cp: number } => row.cp !== null && row.cp > 0 && (!spec.match || spec.match.test(row.name)))
    .map((row) => ({ name: row.name, cost: `${row.cp} cp` }));
}

// Every pack item of one kind. The search hands back at most 200 rows a call,
// sorted by name, so one call stocked a general store from the gear before
// "M" (no torch, rope or rations, ever): every page is read until the rows
// run out.
const PAGE = 200;
function packItemsOfKind(kind: "weapon" | "armor" | "gear" | "magic_item"): ReturnType<typeof searchItems> {
  const found: ReturnType<typeof searchItems> = [];
  for (let offset = 0; offset < PAGE * 20; offset += PAGE) {
    const page = searchItems({ kind, limit: PAGE, offset });
    found.push(...page);
    if (page.length < PAGE) {
      break;
    }
  }
  return found;
}

// A restock: a prepared shelf is refilled to what its author wrote; a shop
// the pack stocks rerolls from the pack, and keeps its shelf when the pack
// has nothing to give (no pack installed, or no item of its kind). Either
// way it is a new visit, so everybody may haggle again.
export function restockShop(shop: Shop, instant: number, random: () => number = Math.random): Shop {
  const pooled = shop.preparedStock ? [] : stockFromPool(stockPool(shop.kind), shop.size, random);
  const stock = shop.preparedStock ? refillStock(shop.stock, shop.preparedStock) : pooled.length ? pooled : shop.stock;
  return updateShop(shop.id, { stock, restockedAt: instant, haggles: [] }) ?? shop;
}

const openSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.string().default("general"),
  size: z.string().default("village"),
  keeper: z.string().trim().max(80).default(""),
});

export function handleOpenShop(campaign: Campaign, rawArguments: string, random: () => number = Math.random): ToolResult {
  const args = parse(openSchema, rawArguments);
  if (!args) {
    return { error: "Invalid arguments: open_shop needs a name and a kind.", retry: true };
  }
  const location = getCurrentLocation(campaign.id);
  const size = normalizeShopSize(args.size);
  const kind = normalizeShopKind(args.kind);
  const instant = getClock(campaign.id).instant;
  const keeper = args.keeper ? getNpcByName(campaign.id, args.keeper) : null;
  const found = findShopNear(campaign.id, location, args.name);
  // A shop already standing here, or one with no place yet that is not
  // remembered as standing somewhere else.
  const existing =
    found &&
    (!location ||
      found.locationId === location.id ||
      (!found.locationId && (!found.locationName || textKey(found.locationName) === textKey(location.name))))
      ? found
      : null;
  if (existing) {
    // Reopened as it stands (#171): a prepared or played shelf, its prices
    // and who already haggled all stay, and its keeper is only filled in
    // when it had none. It restocks only when its restock day has come.
    const due = restockDue(existing, instant, MINUTES_PER_DAY);
    const placed = updateShop(existing.id, {
      keeperNpcId: existing.keeperNpcId || keeper?.id || "",
      ...(location && !existing.locationId ? { locationId: location.id, locationName: location.name } : {}),
    })!;
    const shop = due ? restockShop(placed, instant, random) : placed;
    publishShops(campaign.id);
    announceShop(campaign.id, shop);
    return { ok: true, shop: shop.name, reopened: true, restocked: due, lines: shop.stock.length, shelf: shelfLines(shop) };
  }
  // A name that holds a shop standing here, or that one's name holds
  // ("Marla" for "Bottega di Marla"), is asked again rather than opened as a
  // second shop beside it, whose shelf and haggling would start over: a shop
  // is reopened by its whole name.
  const here = location ? listShopsAt(campaign.id, location.id, location.name) : listShops(campaign.id).filter((shop) => !shop.locationId && !shop.locationName);
  const overlapping = here.filter((shop) => containsPhrase(shop.name, args.name) || containsPhrase(args.name, shop.name));
  if (overlapping.length) {
    return {
      error: `open_shop: ${overlapping.map((shop) => `"${shop.name}"`).join(", ")} ${overlapping.length > 1 ? "stand" : "stands"} here. Send its name as it is to reopen it, or give a new shop a name of its own. Nothing was opened.`,
      retry: true,
    };
  }
  const shop = insertShop(campaign.id, {
    name: args.name,
    kind,
    size,
    locationId: location?.id ?? "",
    locationName: location?.name ?? "",
    keeperNpcId: keeper?.id ?? "",
    stock: stockFromPool(stockPool(kind), size, random),
    markup: SIZE_MARKUP[size],
    restockedAt: instant,
  });
  publishShops(campaign.id);
  announceShop(campaign.id, shop);
  return { ok: true, shop: shop.name, reopened: false, restocked: false, lines: shop.stock.length, shelf: shelfLines(shop) };
}

function shelfLines(shop: Shop): string[] {
  return shop.stock.slice(0, 12).map((line) => `${line.itemName} x${line.qty} at ${formatPrice(askingPriceCp(line.priceCp, shop.markup))}`);
}

const buySchema = z.object({
  characterId: z.string().trim().min(1),
  shop: z.string().trim().min(1),
  item: z.string().trim().min(1).max(80),
  qty: z.coerce.number().int().min(1).max(99).default(1),
});

function ledger(campaign: Campaign, sheet: CharacterSheet, kind: string, delta: Record<string, unknown>, reason: string, patch: Record<string, unknown>, summary: string) {
  insertSheetAudit({ campaignId: campaign.id, characterId: sheet.id, turnId: null, kind, delta, reason, seq: allocateSeq(campaign.id), before: sheet, patch });
  insertCharacterEvent({
    libraryCharacterId: sheet.libraryCharacterId,
    campaignCharacterId: sheet.id,
    campaignId: campaign.id,
    seq: allocateSeq(campaign.id),
    kind: "item",
    summary,
  });
}

export function handleBuyItem(campaign: Campaign, rawArguments: string): ToolResult {
  const args = parse(buySchema, rawArguments);
  if (!args) {
    return { error: "Invalid arguments: a purchase at a shop needs characterId, shop and item.", retry: true };
  }
  const sheet = resolveSheet(campaign, args.characterId);
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, listSheets(campaign.id));
  }
  const shop = resolveShop(campaign, args.shop);
  if (!shop) {
    return noShop(campaign, args.shop);
  }
  const line = findStockLine(shop.stock, args.item);
  if (!line) {
    return { error: `${shop.name} does not stock "${args.item}". On the shelf: ${shop.stock.map((entry) => entry.itemName).join(", ") || "nothing"}.`, refused: "rules" };
  }
  if (line.qty < args.qty) {
    return { error: `${shop.name} has only ${line.qty} of ${line.itemName}.`, retry: true };
  }
  // The buyer's own price: the shop's, moved by a haggle they were at the
  // counter for.
  const each = askingPriceCp(line.priceCp, markupFor(shop, sheet.id));
  const total = each * args.qty;
  const purse = { gold: sheet.gold, copper: sheet.copper };
  if (purse.gold * 100 + purse.copper < total) {
    return { error: `${line.itemName} x${args.qty} costs ${formatPrice(total)}; ${sheet.name} carries ${formatCopper(purse.gold * 100 + purse.copper)}. They cannot afford it.`, refused: "rules" };
  }
  const paid = addCopper(purse, -total);
  const items = grantItemMath(sheet.equipment, line.itemName, args.qty, line.srdName ? { srdName: line.srdName } : {});
  // Strength x 15 pounds is all a character can carry (src/lib/dm/load-rules.ts).
  const tooHeavy = capacityProblem(sheet, items.equipment, line.itemName, paid.purse.gold);
  if (tooHeavy) {
    return { ...tooHeavy, error: `${tooHeavy.error} Nothing was bought.` };
  }
  const patch = { gold: paid.purse.gold, copper: paid.purse.copper, equipment: items.equipment };
  patchSheet(sheet.id, patch);
  updateShop(shop.id, { stock: takeStock(shop.stock, line.itemName, args.qty) ?? shop.stock });
  ledger(campaign, sheet, "purchase", { item: line.itemName, qty: args.qty, action: "buy", priceCp: each, shop: shop.name }, `Bought at ${shop.name}`, patch, `Bought ${line.itemName}${args.qty > 1 ? ` x${args.qty}` : ""} for ${formatPrice(total)} at ${shop.name}.`);
  publishSheet(campaign, sheet.id);
  publishShops(campaign.id);
  publishEphemeral(campaign.id, "coins", { characterId: sheet.id, direction: "out", amountCp: total, at: Date.now() });
  return { ok: true, bought: line.itemName, qty: args.qty, paid: formatPrice(total), purse: formatCopper(paid.purse.gold * 100 + paid.purse.copper), note: alreadyInPack(sheet.name, true) };
}

// A price the table cannot check is still held to the ceiling purchase keeps
// (100,000 gp a unit), so a model's number cannot mint a fortune.
const MAX_UNPRICED_CP = 10_000_000;
const sellSchema = buySchema.extend({ priceCp: z.coerce.number().int().min(1).max(MAX_UNPRICED_CP).optional() });

export function handleSellItem(campaign: Campaign, rawArguments: string): ToolResult {
  const args = parse(sellSchema, rawArguments);
  if (!args) {
    return { error: "Invalid arguments: a sale at a shop needs characterId, shop and item, and a price of at most 100,000 gp each when one is given.", retry: true };
  }
  const sheet = resolveSheet(campaign, args.characterId);
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, listSheets(campaign.id));
  }
  const shop = resolveShop(campaign, args.shop);
  if (!shop) {
    return noShop(campaign, args.shop);
  }
  if (!shop.buys) {
    return { error: `${shop.name} does not buy.`, refused: "rules" };
  }
  const removal = removeItemMath(sheet.equipment, args.item, args.qty);
  if (!removal) {
    return notCarried(sheet.name, sheet.equipment.map((item) => item.name), args.item, isTableGearName(campaign.id, args.item));
  }
  const line = removal.item;
  const carried = line.name;
  // SRD 5.1, Selling Treasure: "Finding someone to buy a potion or a scroll
  // isn't too hard, but other items are out of the realm of most but the
  // wealthiest nobles." A shop buys potions and scrolls; any other magic item
  // needs a buyer the story provides, settled with purchase and no shop.
  const magic = magicValueOf(line);
  if (magic && !soldToShops(line)) {
    return { error: `${shop.name} does not buy ${carried}: no shop buys a magic item other than a potion or a scroll, only one of the wealthiest nobles. A buyer the story provides is settled with purchase, no shop named. Nothing was sold.`, refused: "rules" };
  }
  // Gems, jewelry, art and trade goods keep their full value (SRD 5.1,
  // Selling Treasure), priced by the worth they were given; a name is never
  // read for a price (src/lib/dm/trade-value.ts).
  const listCp = listPriceCp(line);
  const each = listCp !== null ? (keepsFullValue(line) ? listCp : offerPriceCp(listCp)) : args.priceCp ?? null;
  if (each === null) {
    // `unpriced`: the Market has no price to send, so it hands the sale to
    // whoever runs the story to name one (MarketPanel.tsx).
    return { error: `The pack has no price for "${carried}"; send price, the gold the keeper pays for each.`, retry: true, unpriced: true };
  }
  const total = each * removal.removed;
  const paid = addCopper({ gold: sheet.gold, copper: sheet.copper }, total);
  const patch = { gold: paid.purse.gold, copper: paid.purse.copper, equipment: removal.equipment };
  patchSheet(sheet.id, patch);
  updateShop(shop.id, { stock: addStock(shop.stock, carried, removal.removed, listCp ?? each * 2, line.srdName) });
  ledger(campaign, sheet, "purchase", { item: carried, qty: removal.removed, action: "sell", priceCp: each, shop: shop.name }, `Sold at ${shop.name}`, patch, `Sold ${carried}${removal.removed > 1 ? ` x${removal.removed}` : ""} for ${formatPrice(total)} at ${shop.name}.`);
  publishSheet(campaign, sheet.id);
  publishShops(campaign.id);
  publishEphemeral(campaign.id, "coins", { characterId: sheet.id, direction: "in", amountCp: total, at: Date.now() });
  return { ok: true, sold: carried, qty: removal.removed, received: formatPrice(total), purse: formatCopper(paid.purse.gold * 100 + paid.purse.copper) };
}

const haggleSchema = z.object({
  characterId: z.string().trim().min(1),
  shop: z.string().trim().min(1),
  skill: z.string().trim().max(40).optional(),
  present: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
});

const SKILL_LABEL = { persuasion: "Persuasion", intimidation: "Intimidation", deception: "Deception" } as const;

// Why a character cannot stand at a counter, or null when they can: the
// dead, and a companion set against the party (issue 503: turned where it
// stood, or fielded against it), whose sheet the server keeps while the
// party decides what becomes of them (src/lib/dm/turncoat.ts).
function awayFromCounter(campaign: Campaign, sheet: CharacterSheet): string | null {
  if (sheet.deathSaves?.dead) {
    return `${sheet.name} is dead`;
  }
  const encounter = getActiveEncounter(campaign.id);
  const against = encounter ? sheetsAgainstParty(encounter) : turncoatsAtTable(campaign.id).map((other) => other.id);
  return against.includes(sheet.id) ? `${sheet.name} has turned against the party` : null;
}

// A haggle (Albert's rules, 2026-10-23, after #456): a win lowers the price
// a step, a failure holds it, a failure by BAD_FAILURE_MARGIN or more raises
// it (two steps for Intimidation). The new price and the used try belong to
// the haggler and the characters the call names as present at the counter;
// the party keeps no record of who stands where, so nobody else is assumed
// there. Anyone else pays the shop's own price and keeps their try.
export function handleHaggle(campaign: Campaign, rawArguments: string): ToolResult {
  const args = parse(haggleSchema, rawArguments);
  if (!args) {
    return { error: "Invalid arguments: haggle needs characterId and shop, a skill of persuasion, intimidation or deception, and present as a list of characters.", retry: true };
  }
  const skill = args.skill ? normalizeHaggleSkill(args.skill) : "persuasion";
  if (!skill) {
    return { error: `A haggle is made with persuasion, intimidation or deception, not "${args.skill}".`, retry: true };
  }
  const sheet = resolveSheet(campaign, args.characterId);
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, listSheets(campaign.id));
  }
  const away = awayFromCounter(campaign, sheet);
  if (away) {
    return { error: `${away} and cannot haggle. Nothing was rolled.`, refused: "rules" };
  }
  const company: CharacterSheet[] = [];
  for (const ref of args.present) {
    const other = resolveSheet(campaign, ref);
    if (!other) {
      return unknownSheetRef("present", ref, listSheets(campaign.id));
    }
    if (other.id !== sheet.id && !company.some((known) => known.id === other.id)) {
      company.push(other);
    }
  }
  const shop = resolveShop(campaign, args.shop);
  if (!shop) {
    return noShop(campaign, args.shop);
  }
  if (dealFor(shop, sheet.id)) {
    return { error: `${sheet.name} already tried their luck with ${shop.name}'s keeper.`, refused: "rules" };
  }
  if (skill === "deception" && shop.haggles.some((deal) => deal.skill === "deception")) {
    return { error: `${shop.name}'s keeper has been lied to once already and will not fall for it again. Persuasion or intimidation may still be tried.`, refused: "rules" };
  }
  // Someone named at the counter who cannot be there is the call's to fix:
  // the haggle goes ahead without them once they are left out.
  for (const other of company) {
    const absent = awayFromCounter(campaign, other);
    if (absent) {
      return { error: `${absent}, so not at the counter: send present without them. Nothing was rolled.`, retry: true };
    }
  }
  // Held carriers and lasting effects ride the haggling check, and the
  // carrier is spent by it.
  const resolved = resolveRollExpression(
    { kind: "skill_check", skill } as unknown as RollArgs,
    sheet,
    rollExtrasFor(campaign, sheet, "skill_check"),
  );
  if ("error" in resolved || "autoFail" in resolved) {
    return "error" in resolved ? resolved : { error: `${sheet.name} cannot make that check.`, refused: "rules" };
  }
  spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
  const dc = haggleDc(shop.size);
  const rolled = rollExpression(resolved.expression);
  const roll = insertRoll({ campaignId: campaign.id, characterId: sheet.id, requestedBy: "dm", kind: "skill_check", detail: `${sheet.name}: haggling at ${shop.name} (${SKILL_LABEL[skill]})`, dc, result: rolled });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
  const steps = haggleSteps(skill, rolled.total, dc);
  // A companion who already haggled here keeps the price they got.
  const joining = company.filter((other) => !dealFor(shop, other.id));
  const kept = company.filter((other) => dealFor(shop, other.id));
  updateShop(shop.id, { haggles: [...shop.haggles, { ids: [sheet.id, ...joining.map((other) => other.id)], steps, skill }] });
  publishShops(campaign.id);
  const names = [sheet, ...joining].map((who) => who.name).join(" and ");
  // At an end of the ladder the step has nowhere to go, and the outcome says
  // so rather than claim a step the price never took.
  const prices = dealInWords(shop.markup, steps);
  const moved = stepMoves(shop.markup, steps);
  const outcome =
    steps < 0
      ? moved
        ? `${names} talked the keeper down: their prices here are ${prices}.`
        : `${names} talked the keeper down, but their prices here are already at their lowest: they stay where they were.`
      : steps === 0
        ? `The keeper holds firm: prices stay where they were for ${names}.`
        : moved
          ? `A bad failure (missed the DC by ${BAD_FAILURE_MARGIN} or more): the keeper raises prices for ${names}, ${prices}.`
          : `A bad failure (missed the DC by ${BAD_FAILURE_MARGIN} or more), but prices for ${names} are already at their highest: they stay where they were.`;
  return {
    ok: true,
    success: steps < 0,
    skill,
    rolled: rolled.total,
    dc,
    prices,
    steps,
    markup: shiftMarkup(shop.markup, steps),
    for: [sheet, ...joining].map((who) => who.name),
    outcome: `${outcome} Anyone else pays the shop's normal price and may still haggle once.`,
    ...(kept.length ? { keptTheirOwn: kept.map((who) => `${who.name} already haggled here and keeps that price`) } : {}),
  };
}

// The prompt's shops block for the party's place, keepers named.
export function shopsBlock(campaign: Campaign): string {
  const location = getCurrentLocation(campaign.id);
  if (!location) {
    return "";
  }
  const instant = getClock(campaign.id).instant;
  const shops = listShopsAt(campaign.id, location.id, location.name).map((shop) => {
    // A shop past its restock day fills its shelves again as the party
    // walks in, at the same prices it opened with.
    const fresh = restockDue(shop, instant, MINUTES_PER_DAY) ? restockShop(shop, instant) : shop;
    return { ...fresh, keeperName: fresh.keeperNpcId ? getNpcById(fresh.keeperNpcId)?.name ?? "" : "" };
  });
  const names = new Map(listSheets(campaign.id).map((sheet) => [sheet.id, sheet.name]));
  return renderShopsForPrompt(shops, (id) => names.get(id) ?? "someone no longer here");
}

// The handler a purchase reaches (src/lib/dm/tool-merge.ts). A shop named in
// the call trades whatever it is asked, and refuses what it does not stock
// or buy as it always has. With none named, a shop standing where the party
// is trades the item when it stocks it (a purchase) or would buy it (a
// sale): one that already shelves it first, then the general store, then
// any other. Anything else changes hands at list price, outside a shop.
export function tradeCall(campaign: Campaign, args: ToolArgs): EngineCall {
  const action = args.action === "buy" || args.action === "sell" ? args.action : null;
  const item = String(args.item ?? args.name ?? "").trim();
  const named = typeof args.shop === "string" ? args.shop.trim() : "";
  const listPrice = { name: "purchase", args: Object.fromEntries(Object.entries(args).filter(([key]) => key !== "shop" && key !== "priceCp")) };
  if (!action || !item) {
    return listPrice;
  }
  const atShop = (shop: string, shelfName: string = item): EngineCall => {
    const common = { characterId: args.characterId, shop, item: shelfName, ...(args.qty !== undefined ? { qty: args.qty } : {}) };
    if (action === "buy") {
      return { name: "buy_item", args: { ...common, ...(args.waypoint !== undefined ? { waypoint: args.waypoint } : {}) } };
    }
    const priceCp = args.priceCp ?? (Number.isFinite(Number(args.price)) && Number(args.price) > 0 ? Math.round(Number(args.price) * 100) : undefined);
    return { name: "sell_item", args: { ...common, ...(priceCp !== undefined ? { priceCp } : {}) } };
  };
  if (named) {
    return atShop(named);
  }
  const location = getCurrentLocation(campaign.id);
  const here = location ? listShopsAt(campaign.id, location.id, location.name) : [];
  if (!here.length) {
    return listPrice;
  }
  const srdName = typeof args.srdName === "string" ? args.srdName.trim() : "";
  const shelved = (shop: Shop) => findStockLine(shop.stock, item) ?? (srdName ? findStockLine(shop.stock, srdName) : null);
  if (action === "buy") {
    for (const shop of here) {
      const line = shelved(shop);
      if (line) {
        return atShop(shop.name, line.itemName);
      }
    }
    return listPrice;
  }
  // A shop buys a potion or a scroll and no other magic item (handleSellItem).
  const sheet = typeof args.characterId === "string" ? resolveSheet(campaign, args.characterId) : null;
  const carried = sheet ? sheet.equipment[lineNamed(sheet.equipment, item)] : undefined;
  const magic = carried ? magicValueOf(carried) : null;
  const buyers = here.filter((shop) => shop.buys && (!magic || (carried !== undefined && soldToShops(carried))));
  const buyer = buyers.find((shop) => shelved(shop)) ?? buyers.find((shop) => shop.kind === "general") ?? buyers[0];
  return buyer ? atShop(buyer.name) : listPrice;
}
