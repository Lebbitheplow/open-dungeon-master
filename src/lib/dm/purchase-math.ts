// purchase: a trade outside a shop, priced by the table and settled in one
// patch of coin and pack. Split from resource-tools.ts, which re-exports it
// for the mutation that applies it.

import { grantItemMath, removeItemMath } from "@/lib/dm/mutation-math";
import type { Outcome } from "@/lib/dm/resource-tools";
import { keepsFullValue, listPriceCp, saleValueCp } from "@/lib/dm/trade-value";
import { addCopper, formatCopper, purseCopper } from "@/lib/srd/currency";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A purchase or a sale outside a shop. The table prices it, not the model:
// the content pack's list price (or the value a treasure's name carries) is
// what a buyer pays, and a seller gets half of it, full for gems, art and
// trade goods (SRD 5.1, Selling Treasure; src/lib/dm/trade-value.ts). The
// model's `price` stands only for a thing the table has no price for.
export function computePurchase(
  sheet: CharacterSheet,
  args: { item: string; price: number; qty: number; action: "buy" | "sell" },
): Outcome | { error: string } {
  const listCp = listPriceCp(args.item);
  const eachCp =
    listCp === null
      ? Math.round(args.price * 100)
      : args.action === "buy"
        ? listCp
        : saleValueCp(args.item, listCp);
  const priced = listCp === null ? "the price given" : args.action === "buy" ? "list price" : keepsFullValue(args.item) ? "full value" : "half the list price";
  const purse = { gold: sheet.gold, copper: sheet.copper ?? 0 };
  if (args.action === "buy") {
    const totalCp = eachCp * args.qty;
    if (purseCopper(purse) < totalCp) {
      return {
        error: `${sheet.name} has ${formatCopper(purseCopper(purse))}; ${args.qty > 1 ? `${args.qty}x ` : ""}${args.item} costs ${formatCopper(totalCp)}. They cannot afford it.`,
      };
    }
    const paid = addCopper(purse, -totalCp).purse;
    const items = grantItemMath(sheet.equipment, args.item.slice(0, 80), args.qty);
    return {
      patch: { gold: paid.gold, copper: paid.copper, equipment: items.equipment },
      result: {
        ok: true,
        bought: args.item,
        qty: args.qty,
        paid: formatCopper(totalCp),
        priced,
        gold: paid.gold,
      },
      event: `Bought ${args.item}${args.qty > 1 ? ` x${args.qty}` : ""} for ${formatCopper(totalCp)}.`,
    };
  }
  const removal = removeItemMath(sheet.equipment, args.item, args.qty);
  if (!removal) {
    return { error: `${sheet.name} does not carry "${args.item}" to sell.` };
  }
  // A sale pays for what changes hands, so more than is held is no sale.
  if (removal.removed < args.qty) {
    return {
      error: `${sheet.name} carries ${removal.removed} of ${args.item} and cannot sell ${args.qty}; sell ${removal.removed} or fewer.`,
    };
  }
  const totalCp = eachCp * removal.removed;
  const received = addCopper(purse, totalCp).purse;
  return {
    patch: { gold: received.gold, copper: received.copper, equipment: removal.equipment },
    result: {
      ok: true,
      sold: args.item,
      qty: removal.removed,
      received: formatCopper(totalCp),
      priced,
      gold: received.gold,
    },
  };
}
