// purchase: a trade outside a shop, priced by the table and settled in one
// patch of coin and pack. Split from resource-tools.ts, which re-exports it
// for the mutation that applies it.

import { grantItemMath, removeItemMath } from "@/lib/dm/mutation-math";
import type { Outcome } from "@/lib/dm/resource-tools";
import { keepsFullValue, listPriceCp, saleValueCp } from "@/lib/dm/trade-value";
import { addCopper, formatCopper, formatPrice, purseCopper } from "@/lib/srd/currency";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import { alreadyInPack, notCarried } from "@/lib/dm/item-logic";
import { isTableGearName } from "@/lib/db/homebrew";
import { lineNamed } from "@/lib/srd/item-row";

// A purchase or a sale outside a shop. The table prices it, not the model:
// the content pack's list price (or the worth the item was given) is what a
// buyer pays, and a seller gets half of it, full for gems, art and trade
// goods (SRD 5.1, Selling Treasure; src/lib/dm/trade-value.ts). The model's
// `price` stands only for a thing the table has no price for, and is then
// the worth of what was bought; it is asked for only then.
export function computePurchase(
  sheet: CharacterSheet,
  // srdName: the row a bought item is, as grant_item takes it.
  args: { item: string; price?: number; qty: number; action: "buy" | "sell"; srdName?: string },
): Outcome | ToolError {
  // What is sold is the carried line, with what it is (item-tags.ts).
  const item = (args.action === "sell" ? sheet.equipment[lineNamed(sheet.equipment, args.item)] : undefined) ?? { name: args.item, srdName: args.srdName };
  const listCp = listPriceCp(item);
  if (listCp === null && args.price === undefined) {
    return { error: `Nothing prices "${args.item}": send price, the gold one is worth. Nothing changed.`, retry: true };
  }
  const price = args.price ?? 0;
  const eachCp =
    listCp === null
      ? Math.round(price * 100)
      : args.action === "buy"
        ? listCp
        : saleValueCp(item, listCp);
  const priced = listCp === null ? "the price given" : args.action === "buy" ? "list price" : keepsFullValue(item) ? "full value" : "half the list price";
  const purse = { gold: sheet.gold, copper: sheet.copper ?? 0 };
  if (args.action === "buy") {
    const totalCp = eachCp * args.qty;
    if (purseCopper(purse) < totalCp) {
      return {
        error: `${sheet.name} has ${formatCopper(purseCopper(purse))}; ${args.qty > 1 ? `${args.qty}x ` : ""}${args.item} costs ${formatPrice(totalCp)}. They cannot afford it.`,
        refused: "rules",
      };
    }
    const paid = addCopper(purse, -totalCp).purse;
    const items = grantItemMath(sheet.equipment, args.item.slice(0, 80), args.qty, { srdName: args.srdName, ...(listCp === null && price > 0 ? { worth: price } : {}) });
    return {
      patch: { gold: paid.gold, copper: paid.copper, equipment: items.equipment },
      result: {
        ok: true,
        bought: args.item,
        qty: args.qty,
        paid: formatPrice(totalCp),
        priced,
        gold: paid.gold,
        note: alreadyInPack(sheet.name, true),
      },
      event: `Bought ${args.item}${args.qty > 1 ? ` x${args.qty}` : ""} for ${formatPrice(totalCp)}.`,
    };
  }
  const removal = removeItemMath(sheet.equipment, args.item, args.qty);
  if (!removal) {
    return notCarried(sheet.name, sheet.equipment.map((item) => item.name), args.item, isTableGearName(sheet.campaignId, args.item));
  }
  // A sale pays for what changes hands, so more than is held is no sale.
  if (removal.removed < args.qty) {
    return {
      error: `${sheet.name} carries ${removal.removed} of ${removal.item.name} and cannot sell ${args.qty}; sell ${removal.removed} or fewer.`,
      retry: true,
    };
  }
  const totalCp = eachCp * removal.removed;
  const received = addCopper(purse, totalCp).purse;
  return {
    patch: { gold: received.gold, copper: received.copper, equipment: removal.equipment },
    result: {
      ok: true,
      sold: removal.item.name,
      qty: removal.removed,
      received: formatPrice(totalCp),
      priced,
      gold: received.gold,
    },
  };
}
