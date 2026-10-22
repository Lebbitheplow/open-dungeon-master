// Money, in more than one denomination.
//
// ODM stored a single integer `gold` per sheet, which cannot say "340
// silver": every price, every hoard and every haggle was rounded to whole
// gold pieces, and a table that deals in coppers had nowhere to put them.
//
// The plan offered two shapes and preferred the cheap one: store copper and
// present denominations, rather than a five-field cp/sp/ep/gp/pp record that
// every consumer would have to learn. That is what this is, with one
// concession to the twenty-odd modules that already read `sheet.gold`: the
// stored pair is (gold, copper), where `gold` keeps meaning whole gold pieces
// and `copper` is the 0 to 99 remainder under it. The true purse is
// `gold * 100 + copper`, every existing reader of `gold` keeps working
// unchanged, and nothing a table notices is lost.
//
// Pure by design: it imports only text-logic, so scripts/test-currency.mjs
// can load it and the client can format a purse without a request.

import { writtenWholeNumber } from "../language/text-logic.ts";

export const DENOMINATIONS = ["cp", "sp", "ep", "gp", "pp"] as const;
export type Denomination = (typeof DENOMINATIONS)[number];

// PHB p.143. Electrum is in the table because the SRD prints it and hoards
// roll it; nothing generates it by default.
export const DENOMINATION_COPPER: Record<Denomination, number> = {
  cp: 1,
  sp: 10,
  ep: 50,
  gp: 100,
  pp: 1000,
};

// What a sheet stores. `gold` is the whole gold pieces and stays the field
// every other module already reads; `copper` is the remainder beneath it and
// is always 0 to 99 once normalized.
export type Purse = { gold: number; copper: number };

export const COPPER_PER_GOLD = DENOMINATION_COPPER.gp;

// A purse's true value, which is the number every calculation should use.
export function purseCopper(purse: Purse): number {
  return Math.round(purse.gold) * COPPER_PER_GOLD + Math.round(purse.copper);
}

// The inverse. Negative totals clamp to empty rather than producing a debt:
// nothing in ODM models owing money, and a negative purse would render as
// nonsense in every place a purse is shown.
export function fromCopper(total: number): Purse {
  const value = Math.max(0, Math.round(total));
  return { gold: Math.floor(value / COPPER_PER_GOLD), copper: value % COPPER_PER_GOLD };
}

// Coins as a person would count them out, largest first, skipping empties.
// Deliberately does not produce electrum: nobody says "two electrum and a
// copper" when they mean 41 silver, and the SRD only prints ep as a coin a
// hoard can contain, not as change anyone makes.
export function breakdown(total: number): Array<{ denomination: Denomination; count: number }> {
  let left = Math.max(0, Math.round(total));
  const rows: Array<{ denomination: Denomination; count: number }> = [];
  for (const denomination of ["pp", "gp", "sp", "cp"] as const) {
    const each = DENOMINATION_COPPER[denomination];
    const count = Math.floor(left / each);
    if (count > 0) {
      rows.push({ denomination, count });
      left -= count * each;
    }
  }
  return rows;
}

// "3 gp 4 sp 2 cp". An empty purse reads "0 gp" rather than empty, because a
// blank where a number belongs reads as a bug.
export function formatCopper(total: number): string {
  const rows = breakdown(total);
  if (!rows.length) {
    return "0 gp";
  }
  return rows.map((row) => `${row.count} ${row.denomination}`).join(" ");
}

// A price as a price list writes it, in gold, with silver and copper only
// for what is left under a gold piece: "55 gp", "1 gp 5 sp", "2 sp 2 cp".
// Platinum belongs to the coins in a purse (formatCopper), not to prices:
// "5 pp 5 gp" for a 55 gp item made every Market tile a sum.
export function formatPrice(total: number): string {
  const value = Math.max(0, Math.round(total));
  const parts = [
    [Math.floor(value / COPPER_PER_GOLD), "gp"],
    [Math.floor((value % COPPER_PER_GOLD) / DENOMINATION_COPPER.sp), "sp"],
    [value % DENOMINATION_COPPER.sp, "cp"],
  ] as const;
  const written = parts.filter(([count]) => count > 0).map(([count, code]) => `${count} ${code}`);
  return written.length ? written.join(" ") : "0 gp";
}

export function formatPurse(purse: Purse): string {
  return formatCopper(purseCopper(purse));
}

// Amounts in the coins' codes, the SRD's notation, which formatCopper
// writes: "12gp", "2 pp 5 sp", "17" (a bare number is gold). The codes are
// the same at every table, so no language's coin words are read: anything
// but numbers and codes ("340 silver", "50 mo", "5 arrows") is null, never a
// guess that would silently charge for it, and so is a text with no number
// at all, so a caller can tell "nothing was said" from "nothing was worth
// anything". `amountOf` reads each number.
function coinsOf(text: string, amountOf: (written: string) => number | null): number | null {
  const parts = String(text ?? "")
    .toLowerCase()
    .match(/\d(?:[\d.,'’\u00a0\u202f ]*\d)?|[^\s\d.,'’-]+/gu) ?? [];
  let total = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const amount = amountOf(parts[index]);
    if (amount === null) {
      return null;
    }
    const denomination = DENOMINATIONS.find((code) => code === parts[index + 1]);
    if (denomination) {
      index += 1;
    }
    total += amount * DENOMINATION_COPPER[denomination ?? "gp"];
  }
  return parts.length ? Math.round(total) : null;
}

// An amount someone wrote (the model's coins, a price typed in the market):
// whole numbers of each coin, a thousands mark read only before a group of
// three digits (src/lib/language/text-logic.ts writtenWholeNumber), so
// "1,5 gp" is refused rather than read as 1.5 or 15 gold.
export function parseCoins(text: string): number | null {
  return coinsOf(text, (written) => {
    const amount = writtenWholeNumber(written);
    return typeof amount === "number" ? amount : null;
  });
}

// The content pack's own cost notation, which is English and fixed: "."
// is a decimal point and "," a thousands mark ("0.05 gp", "2,000 gp").
export function packCostCopper(text: string): number | null {
  return coinsOf(text, (written) => {
    const amount = Number(written.replace(/,/g, ""));
    return Number.isFinite(amount) ? amount : null;
  });
}

// Why a coin amount cannot be read, for the refusal that asks for it again:
// the mark a number was written with, else the codes.
export function unreadCoins(text: string): string {
  const number = (String(text ?? "").match(/\d(?:[\d.,'’\u00a0\u202f ]*\d)?/gu) ?? []).map(writtenWholeNumber).find((amount) => typeof amount !== "number");
  return number
    ? `Coins come in whole numbers: ${number.unread}. Write a part of a coin in smaller coins, like "1 gp 5 sp"`
    : `"${text}" is not an amount in the coins' codes: write it with pp, gp, ep, sp and cp, like "3 gp 4 sp"`;
}

export type PurseChange = {
  purse: Purse;
  // What actually moved, in copper. Smaller than the request when the purse
  // ran out, which is how a caller reports "they could only pay 3 gp of it".
  applied: number;
  short: number;
};

// Spending or earning, in copper. A purse never goes below empty; the caller
// is told how much was short rather than being handed a negative balance to
// discover later.
export function addCopper(purse: Purse, deltaCopper: number): PurseChange {
  const before = purseCopper(purse);
  const delta = Math.round(deltaCopper);
  const after = Math.max(0, before + delta);
  return {
    purse: fromCopper(after),
    applied: after - before,
    short: delta < 0 ? Math.max(0, -(before + delta)) : 0,
  };
}

// Splitting a hoard N ways. The remainder goes to the first share rather than
// being lost, which is the same rule party_award already uses for gold and
// the one a table actually follows when the coins do not divide.
export function splitCopper(total: number, shares: number): number[] {
  const count = Math.max(1, Math.floor(shares));
  const value = Math.max(0, Math.round(total));
  const each = Math.floor(value / count);
  const remainder = value - each * count;
  return Array.from({ length: count }, (_, index) => (index === 0 ? each + remainder : each));
}
