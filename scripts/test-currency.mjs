// Money in more than one denomination: what a purse is worth, how it reads,
// and what a person typing "340 silver" gets.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  addCopper,
  breakdown,
  COPPER_PER_GOLD,
  DENOMINATION_COPPER,
  formatCopper,
  formatPurse,
  fromCopper,
  parseCoins,
  purseCopper,
  splitCopper,
} = await import("../src/lib/srd/currency.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

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

test("denominations parse by name and by code", () => {
  assert.equal(parseCoins("340 silver"), 3400);
  assert.equal(parseCoins("2 pp 5 sp"), 2050);
  assert.equal(parseCoins("6 copper pieces"), 6);
  assert.equal(parseCoins("1,200 gp"), 120000);
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
