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
// Pure by design: no imports at all, so scripts/test-currency.mjs can load it
// and the client can format a purse without a request.

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

export const DENOMINATION_NAMES: Record<Denomination, string> = {
  cp: "copper",
  sp: "silver",
  ep: "electrum",
  gp: "gold",
  pp: "platinum",
};

// The words a person types, mapped to the code. Longest first is not needed
// here because lookup is exact after normalizing.
const WORD_TO_DENOMINATION: Record<string, Denomination> = {
  cp: "cp", copper: "cp", coppers: "cp", "copper piece": "cp", "copper pieces": "cp",
  sp: "sp", silver: "sp", silvers: "sp", "silver piece": "sp", "silver pieces": "sp",
  ep: "ep", electrum: "ep", "electrum piece": "ep", "electrum pieces": "ep",
  gp: "gp", gold: "gp", golds: "gp", "gold piece": "gp", "gold pieces": "gp", coin: "gp", coins: "gp",
  pp: "pp", platinum: "pp", "platinum piece": "pp", "platinum pieces": "pp",
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

export function formatPurse(purse: Purse): string {
  return formatCopper(purseCopper(purse));
}

// "340 silver", "12gp", "2 pp 5 sp", "17" (bare numbers are gold, which is
// what every existing price in the content pack means). Returns null when
// there is no number in it at all, so a caller can tell "nothing was said"
// from "nothing was worth anything".
export function parseCoins(text: string): number | null {
  const normalized = String(text ?? "")
    .toLowerCase()
    .replace(/,/g, "")
    .trim();
  if (!normalized) {
    return null;
  }
  const pattern = /(\d+(?:\.\d+)?)\s*([a-z]+(?:\s+pieces?)?)?/g;
  let total = 0;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) !== null) {
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) {
      continue;
    }
    const word = (match[2] ?? "").trim();
    const denomination = word ? WORD_TO_DENOMINATION[word] : "gp";
    if (word && !denomination) {
      // A number followed by a word that is not a coin ("5 arrows") is not a
      // price, and guessing gold would silently charge for it.
      continue;
    }
    matched = true;
    total += amount * DENOMINATION_COPPER[denomination ?? "gp"];
  }
  return matched ? Math.round(total) : null;
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
