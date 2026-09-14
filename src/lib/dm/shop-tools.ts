import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import { insertCharacterEvent } from "@/lib/db/character-events";
import { getClock } from "@/lib/db/clock";
import { getCurrentLocation } from "@/lib/db/locations";
import { getNpcById, getNpcByName } from "@/lib/db/npcs";
import { insertRoll } from "@/lib/db/rolls";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { findShopByName, getShop, insertShop, listShopsAt, updateShop } from "@/lib/db/shops";
import { searchItems } from "@/lib/content";
import { rollExpression } from "@/lib/dice";
import { grantItemMath, removeItemMath } from "@/lib/dm/mutation-math";
import { resolveRollExpression, resolveSheetRef, type RollArgs } from "@/lib/dm/rolls";
import {
  addStock,
  askingPriceCp,
  costToCopper,
  findStockLine,
  haggleDc,
  haggleStep,
  KIND_POOL,
  normalizeShopKind,
  normalizeShopSize,
  offerPriceCp,
  renderShopsForPrompt,
  restockDue,
  SIZE_MARKUP,
  stockFromPool,
  takeStock,
  type Shop,
} from "@/lib/dm/shop-logic";
import { MINUTES_PER_DAY } from "@/lib/dm/calendar";
import { publishEphemeral, publishPersisted, publishWithSeq } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { addCopper, formatCopper } from "@/lib/srd/currency";

// The shop tools (docs/vtt-parity-implementation-plan.md 11.1). The server
// prices everything: the model names the item, the shelf says what it
// costs, the purse says whether it can be had. Every purchase and sale
// writes the same audit row purchase does, so the ledger reads as one.

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
        "Open (or restock) a shop at the party's current place. Give it a name, a kind (general, smith, apothecary, outfitter, curiosities) and the settlement size; the server stocks its shelves from the content pack at the size's markup. Call once when the party first walks in; the shop and its prices then appear in GAME STATE.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The shop's name, e.g. 'Marla's Sundries'." },
          kind: { type: "string", enum: ["general", "smith", "apothecary", "outfitter", "curiosities"] },
          size: { type: "string", enum: ["hamlet", "village", "town", "city"] },
          keeper: { type: "string", description: "The keeper's name, an NPC from GAME STATE when one fits." },
        },
        required: ["name", "kind"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buy_item",
      description: "A character buys from a shop in GAME STATE. The server takes the asking price from the shelf and refuses what the purse cannot cover or the shelf does not hold. Do not quote a price yourself.",
      parameters: {
        type: "object",
        properties: {
          characterId: { type: "string" },
          shop: { type: "string", description: "The shop's name." },
          item: { type: "string" },
          qty: { type: "integer", minimum: 1, maximum: 99 },
        },
        required: ["characterId", "shop", "item"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "sell_item",
      description: "A character sells something they carry to a shop that buys. The keeper pays half list price, from the content pack when the item is known there; name a price in copper only for something the pack does not know.",
      parameters: {
        type: "object",
        properties: {
          characterId: { type: "string" },
          shop: { type: "string" },
          item: { type: "string" },
          qty: { type: "integer", minimum: 1, maximum: 99 },
          priceCp: { type: "integer", minimum: 1, description: "Only for an item the content pack has no price for: what the keeper pays each, in copper." },
        },
        required: ["characterId", "shop", "item"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "haggle",
      description: "A character haggles with a shop's keeper: a Persuasion check against the settlement's DC. Success drops every price in that shop one step, failure raises them one step. One try per character per shop.",
      parameters: {
        type: "object",
        properties: { characterId: { type: "string" }, shop: { type: "string" } },
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

function resolveShop(campaign: Campaign, ref: string): Shop | null {
  const byId = getShop(ref);
  return byId && byId.campaignId === campaign.id ? byId : findShopByName(campaign.id, ref);
}

function publishShops(campaignId: string) {
  publishEphemeral(campaignId, "shops_updated", { at: Date.now() });
}

function publishSheet(campaign: Campaign, sheetId: string) {
  const updated = patchSheet(sheetId, {});
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// The pool a shop of this kind stocks from: the pack's items of the right
// kinds, filtered by the kind's words when it has any.
export function stockPool(kind: string): Array<{ name: string; cost: string }> {
  const spec = KIND_POOL[normalizeShopKind(kind)];
  const pool: Array<{ name: string; cost: string }> = [];
  for (const itemKind of spec.kinds) {
    for (const item of searchItems({ kind: itemKind, limit: 400 })) {
      if (!item.cost || (spec.match && !spec.match.test(item.name))) {
        continue;
      }
      pool.push({ name: item.name, cost: item.cost });
    }
  }
  return pool;
}

const openSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.string().default("general"),
  size: z.string().default("village"),
  keeper: z.string().trim().max(80).default(""),
});

export function handleOpenShop(campaign: Campaign, rawArguments: string, random: () => number = Math.random): Record<string, unknown> {
  const args = parse(openSchema, rawArguments);
  if (!args) {
    return { error: "Invalid arguments: open_shop needs a name and a kind." };
  }
  const location = getCurrentLocation(campaign.id);
  const size = normalizeShopSize(args.size);
  const kind = normalizeShopKind(args.kind);
  const instant = getClock(campaign.id).instant;
  const keeper = args.keeper ? getNpcByName(campaign.id, args.keeper) : null;
  const existing = findShopByName(campaign.id, args.name);
  const stock = stockFromPool(stockPool(kind), size, random);
  const shop =
    existing && (!location || !existing.locationId || existing.locationId === location.id)
      ? updateShop(existing.id, { stock: stock.length ? stock : existing.stock, restockedAt: instant, haggledBy: [], keeperNpcId: keeper?.id ?? existing.keeperNpcId })!
      : insertShop(campaign.id, {
          name: args.name,
          kind,
          size,
          locationId: location?.id ?? "",
          locationName: location?.name ?? "",
          keeperNpcId: keeper?.id ?? "",
          stock,
          markup: SIZE_MARKUP[size],
          restockedAt: instant,
        });
  publishShops(campaign.id);
  return {
    ok: true,
    shop: shop.name,
    restocked: Boolean(existing),
    lines: shop.stock.length,
    shelf: shop.stock.slice(0, 12).map((line) => `${line.itemName} x${line.qty} at ${formatCopper(askingPriceCp(line.priceCp, shop.markup))}`),
  };
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

export function handleBuyItem(campaign: Campaign, rawArguments: string): Record<string, unknown> {
  const args = parse(buySchema, rawArguments);
  if (!args) {
    return { error: "Invalid arguments: buy_item needs characterId, shop and item." };
  }
  const sheet = resolveSheet(campaign, args.characterId);
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  const shop = resolveShop(campaign, args.shop);
  if (!shop) {
    return { error: `No shop called "${args.shop}" here. Open one with open_shop first.` };
  }
  const line = findStockLine(shop.stock, args.item);
  if (!line) {
    return { error: `${shop.name} does not stock "${args.item}". On the shelf: ${shop.stock.map((entry) => entry.itemName).join(", ") || "nothing"}.` };
  }
  if (line.qty < args.qty) {
    return { error: `${shop.name} has only ${line.qty} of ${line.itemName}.` };
  }
  const each = askingPriceCp(line.priceCp, shop.markup);
  const total = each * args.qty;
  const purse = { gold: sheet.gold, copper: sheet.copper };
  if (purse.gold * 100 + purse.copper < total) {
    return { error: `${line.itemName} x${args.qty} costs ${formatCopper(total)}; ${sheet.name} carries ${formatCopper(purse.gold * 100 + purse.copper)}. They cannot afford it.` };
  }
  const paid = addCopper(purse, -total);
  const items = grantItemMath(sheet.equipment, line.itemName, args.qty);
  const patch = { gold: paid.purse.gold, copper: paid.purse.copper, equipment: items.equipment };
  patchSheet(sheet.id, patch);
  updateShop(shop.id, { stock: takeStock(shop.stock, line.itemName, args.qty) ?? shop.stock });
  ledger(campaign, sheet, "purchase", { item: line.itemName, qty: args.qty, action: "buy", priceCp: each, shop: shop.name }, `Bought at ${shop.name}`, patch, `Bought ${line.itemName}${args.qty > 1 ? ` x${args.qty}` : ""} for ${formatCopper(total)} at ${shop.name}.`);
  publishSheet(campaign, sheet.id);
  publishShops(campaign.id);
  publishEphemeral(campaign.id, "coins", { characterId: sheet.id, direction: "out", amountCp: total, at: Date.now() });
  return { ok: true, bought: line.itemName, qty: args.qty, paid: formatCopper(total), purse: formatCopper(paid.purse.gold * 100 + paid.purse.copper) };
}

const sellSchema = buySchema.extend({ priceCp: z.coerce.number().int().min(1).optional() });

export function handleSellItem(campaign: Campaign, rawArguments: string): Record<string, unknown> {
  const args = parse(sellSchema, rawArguments);
  if (!args) {
    return { error: "Invalid arguments: sell_item needs characterId, shop and item." };
  }
  const sheet = resolveSheet(campaign, args.characterId);
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  const shop = resolveShop(campaign, args.shop);
  if (!shop) {
    return { error: `No shop called "${args.shop}" here.` };
  }
  if (!shop.buys) {
    return { error: `${shop.name} does not buy.` };
  }
  const removal = removeItemMath(sheet.equipment, args.item, args.qty);
  if (!removal) {
    return { error: `${sheet.name} does not carry "${args.item}".` };
  }
  const carried = sheet.equipment.find((item) => item.name.toLowerCase() === args.item.toLowerCase())?.name ?? args.item;
  const known = searchItems({ q: carried, limit: 5 }).find((item) => item.name.toLowerCase() === carried.toLowerCase());
  const listCp = known ? costToCopper(known.cost) : null;
  const each = listCp !== null ? offerPriceCp(listCp) : args.priceCp ?? null;
  if (each === null) {
    return { error: `The pack has no price for "${carried}"; pass priceCp for what the keeper pays each.` };
  }
  const total = each * removal.removed;
  const paid = addCopper({ gold: sheet.gold, copper: sheet.copper }, total);
  const patch = { gold: paid.purse.gold, copper: paid.purse.copper, equipment: removal.equipment };
  patchSheet(sheet.id, patch);
  updateShop(shop.id, { stock: addStock(shop.stock, carried, removal.removed, listCp ?? each * 2) });
  ledger(campaign, sheet, "purchase", { item: carried, qty: removal.removed, action: "sell", priceCp: each, shop: shop.name }, `Sold at ${shop.name}`, patch, `Sold ${carried}${removal.removed > 1 ? ` x${removal.removed}` : ""} for ${formatCopper(total)} at ${shop.name}.`);
  publishSheet(campaign, sheet.id);
  publishShops(campaign.id);
  publishEphemeral(campaign.id, "coins", { characterId: sheet.id, direction: "in", amountCp: total, at: Date.now() });
  return { ok: true, sold: carried, qty: removal.removed, received: formatCopper(total), purse: formatCopper(paid.purse.gold * 100 + paid.purse.copper) };
}

const haggleSchema = z.object({ characterId: z.string().trim().min(1), shop: z.string().trim().min(1) });

export function handleHaggle(campaign: Campaign, rawArguments: string): Record<string, unknown> {
  const args = parse(haggleSchema, rawArguments);
  if (!args) {
    return { error: "Invalid arguments: haggle needs characterId and shop." };
  }
  const sheet = resolveSheet(campaign, args.characterId);
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  const shop = resolveShop(campaign, args.shop);
  if (!shop) {
    return { error: `No shop called "${args.shop}" here.` };
  }
  if (shop.haggledBy.includes(sheet.id)) {
    return { error: `${sheet.name} already tried their luck with ${shop.name}'s keeper.` };
  }
  const resolved = resolveRollExpression({ kind: "skill_check", skill: "persuasion" } as unknown as RollArgs, sheet, {
    encumbrance: campaign.gameSettings.variantRules.encumbrance,
  });
  if ("error" in resolved || "autoFail" in resolved) {
    return { error: "error" in resolved ? resolved.error : `${sheet.name} cannot make that check.` };
  }
  const dc = haggleDc(shop.size);
  const rolled = rollExpression(resolved.expression);
  const roll = insertRoll({ campaignId: campaign.id, characterId: sheet.id, requestedBy: "dm", kind: "skill_check", detail: `${sheet.name}: haggling at ${shop.name}`, dc, result: rolled });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
  const success = rolled.total >= dc;
  const markup = haggleStep(shop.markup, success);
  updateShop(shop.id, { markup, haggledBy: [...shop.haggledBy, sheet.id] });
  publishShops(campaign.id);
  return { ok: true, success, rolled: rolled.total, dc, markup, prices: success ? "a step lower" : "a step higher" };
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
    const fresh = restockDue(shop, instant, MINUTES_PER_DAY) ? updateShop(shop.id, { stock: stockFromPool(stockPool(shop.kind), shop.size), restockedAt: instant, haggledBy: [] }) ?? shop : shop;
    return { ...fresh, keeperName: fresh.keeperNpcId ? getNpcById(fresh.keeperNpcId)?.name ?? "" : "" };
  });
  return renderShopsForPrompt(shops);
}
