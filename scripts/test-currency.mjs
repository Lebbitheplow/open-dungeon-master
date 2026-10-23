// Money in more than one denomination: what a purse is worth, how it reads,
// and what a person typing "340 sp" gets.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  addCopper,
  breakdown,
  COPPER_PER_GOLD,
  DENOMINATION_COPPER,
  formatCopper,
  formatPrice,
  formatPurse,
  fromCopper,
  packCostCopper,
  parseCoins,
  purseCopper,
  splitCopper,
  unreadCoins,
} = await import("../src/lib/srd/currency.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("a price reads in gold, with silver and copper only for the remainder", () => {
  assert.equal(formatPrice(5500), "55 gp");
  assert.equal(formatPrice(150), "1 gp 5 sp");
  assert.equal(formatPrice(105), "1 gp 5 cp");
  assert.equal(formatPrice(22), "2 sp 2 cp");
  assert.equal(formatPrice(150000), "1500 gp");
  assert.equal(formatPrice(1234), "12 gp 3 sp 4 cp");
  assert.equal(formatPrice(7), "7 cp");
  assert.equal(formatPrice(0), "0 gp");
  // Coins in a purse still count out in platinum.
  assert.equal(formatCopper(5500), "5 pp 5 gp");
  // And a price written out reads back as the same price.
  for (const copper of [5500, 150, 105, 22, 1234, 7]) assert.equal(parseCoins(formatPrice(copper)), copper);
});

test("the Market shows prices in gold and the purse in its coins", () => {
  // Windows CI checks the files out with CRLF line endings.
  const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const panel = read("src/app/campaigns/[campaignId]/MarketPanel.tsx");
  assert.match(panel, /label: `Buy for \$\{formatPrice\(line\.askingCp\)\}`/);
  assert.match(panel, /\{formatPrice\(line\.askingCp\)\}/);
  assert.match(panel, /coin-purse" \}\} size="size-5" \/> \{formatCopper\(purse\)\}/);
  assert.doesNotMatch(panel, /formatCopper\(line\./, "a price still counts out in platinum");
  assert.match(read("src/app/campaigns/[campaignId]/MarketShopEditor.tsx"), /value=\{draft \?\? formatPrice\(value\)\}/);
});

test("the denominations are the PHB's", () => {
  assert.equal(DENOMINATION_COPPER.cp, 1);
  assert.equal(DENOMINATION_COPPER.sp, 10);
  assert.equal(DENOMINATION_COPPER.ep, 50);
  assert.equal(DENOMINATION_COPPER.gp, 100);
  assert.equal(DENOMINATION_COPPER.pp, 1000);
});

test("a purse is gold times a hundred plus the remainder", () => {
  assert.equal(purseCopper({ gold: 3, copper: 42 }), 342);
  assert.equal(purseCopper({ gold: 0, copper: 0 }), 0);
  assert.equal(COPPER_PER_GOLD, 100);
});

test("copper splits back into gold and change", () => {
  assert.deepEqual(fromCopper(342), { gold: 3, copper: 42 });
  assert.deepEqual(fromCopper(100), { gold: 1, copper: 0 });
  // Nothing in ODM models owing money, so a negative purse clamps to empty
  // rather than rendering as nonsense wherever it is shown.
  assert.deepEqual(fromCopper(-50), { gold: 0, copper: 0 });
});

test("coins are counted out largest first", () => {
  assert.deepEqual(breakdown(1342), [
    { denomination: "pp", count: 1 },
    { denomination: "gp", count: 3 },
    { denomination: "sp", count: 4 },
    { denomination: "cp", count: 2 },
  ]);
  // Electrum is never produced as change; nobody says "two electrum" when
  // they mean 41 silver.
  assert.ok(!breakdown(50).some((row) => row.denomination === "ep"));
});

test("an empty purse reads as a number, not a blank", () => {
  assert.equal(formatCopper(0), "0 gp");
  assert.equal(formatPurse({ gold: 0, copper: 0 }), "0 gp");
  assert.equal(formatCopper(342), "3 gp 4 sp 2 cp");
});

test("a bare number is gold, because every price in the pack is", () => {
  assert.equal(parseCoins("17"), 1700);
  assert.equal(parseCoins("12gp"), 1200);
});

test("denominations parse by their codes", () => {
  assert.equal(parseCoins("340 sp"), 3400);
  assert.equal(parseCoins("2 pp 5 sp"), 2050);
  assert.equal(parseCoins("6 cp"), 6);
  assert.equal(parseCoins("1,200 gp"), 120000);
  assert.equal(parseCoins("1.200 gp"), 120000);
});

test("a part of a coin is refused, naming the mark, never read as one table's decimal", () => {
  for (const text of ["1.5 gp", "1,5 gp", "2,50 sp"]) {
    assert.equal(parseCoins(text), null, text);
    assert.match(unreadCoins(text), /whole numbers.*"1 gp 5 sp"/, text);
  }
});

test("the pack's own costs keep their English notation", () => {
  assert.equal(packCostCopper("0.05 gp"), 5);
  assert.equal(packCostCopper("5,000 gp"), 500000);
});

test("a coin's name in any language is no code, never a guessed amount", () => {
  for (const text of ["340 silver", "12 gold pieces", "50 mo", "5 monete d'argento", "50 pièces d'or", "50 monedas de oro", "50 Goldmünzen", "3 gp 5 mo"]) {
    assert.equal(parseCoins(text), null, text);
  }
});

test("nothing said parses to null, so a caller can tell it apart from free", () => {
  assert.equal(parseCoins(""), null);
  assert.equal(parseCoins("   "), null);
  assert.equal(parseCoins("expensive"), null);
});

test("a number with a non-coin word is not a price", () => {
  // "5 arrows" must not silently become five gold.
  assert.equal(parseCoins("5 arrows"), null);
});

test("spending floors at empty and reports the shortfall", () => {
  const change = addCopper({ gold: 1, copper: 0 }, -150);
  assert.deepEqual(change.purse, { gold: 0, copper: 0 });
  assert.equal(change.applied, -100);
  assert.equal(change.short, 50);
});

test("earning just adds, with no shortfall", () => {
  const change = addCopper({ gold: 0, copper: 60 }, 60);
  assert.deepEqual(change.purse, { gold: 1, copper: 20 });
  assert.equal(change.applied, 60);
  assert.equal(change.short, 0);
});

test("a hoard splits with the remainder to the first share", () => {
  assert.deepEqual(splitCopper(100, 3), [34, 33, 33]);
  assert.deepEqual(splitCopper(100, 4), [25, 25, 25, 25]);
  // Never divides by zero, and never loses a coin.
  const shares = splitCopper(7, 0);
  assert.equal(shares.reduce((a, b) => a + b, 0), 7);
});

console.log(`currency: ${passed} tests passed`);
