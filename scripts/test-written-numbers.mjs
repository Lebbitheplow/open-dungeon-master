// A number is read one way wherever a person or the model writes it: whole,
// with ".", "," or a space only between groups of three digits ("1.000",
// "1,000", "1 000" are a thousand at every table). A part of a whole is
// never guessed at: "1,5" is one and a half at one table and fifteen at
// another, so it is refused, naming the mark, and the coins are asked for in
// smaller coins ("1 gp 5 sp"). The content pack's own costs are English and
// fixed ("0.05 gp", "2,000 gp") and keep their own reader.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-written-numbers");
const world = await openWorld({ campaign: { maxPlayers: 10 } });
const { writtenWholeNumber } = await import("../src/lib/language/text-logic.ts");
const { parseCoins, packCostCopper, unreadCoins } = await import("../src/lib/srd/currency.ts");
const { foldFieldValue } = await import("../src/lib/dm/update-sheet-args.ts");
const { getContentDb } = await import("../src/lib/content/db.ts");
const { getSheetById } = await import("../src/lib/db/sheets.ts");

const ABILITIES = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
const hero = world.addHero({ name: "Ada", class: "fighter", level: 3, gold: 20 });

await test("a whole number reads the same at every table: digits, or groups of three after one mark.", () => {
  for (const [text, number] of [
    ["1000", 1000], ["1.000", 1000], ["1,000", 1000], ["1 000", 1000], ["1 000", 1000], ["1 000", 1000],
    ["12.345.678", 12345678], ["-1.000", -1000], ["+5", 5], [" 42 ", 42], ["1'000", 1000], ["1’000", 1000], ["12'345'678", 12345678],
  ]) {
    assert.equal(writtenWholeNumber(text), number, JSON.stringify(text));
  }
  for (const [text, mark] of [["1,5", '","'], ["1.5", '"."'], ["0,5", '","'], ["12.34", '"."'], ["1,0000", '","'], ["1'5", `"'"`], ["1 50", "a space"]]) {
    const out = writtenWholeNumber(text);
    assert.equal(typeof out, "object", `${text} was read as ${out}`);
    assert.ok(out.unread.includes(mark), `${text}: ${out.unread}`);
  }
  assert.match(writtenWholeNumber("1.234,56").unread, /mixes "\." and ","/);
  // A mark no table groups digits with is named as none, never offered as
  // the way to write it.
  assert.match(writtenWholeNumber("1/000").unread, /"\/" is no mark between digits/);
});

await test("coins: whole coins of each kind; a decimal is refused, saying to write it in smaller coins.", () => {
  for (const [text, copper] of [["1.000 gp", 100000], ["1,000 gp", 100000], ["1 000 gp", 100000], ["2.500 sp", 25000], ["12 gp 30 sp", 1500], ["5 cp", 5], ["3", 300], ["1'000 gp", 100000]]) {
    assert.equal(parseCoins(text), copper, text);
  }
  for (const text of ["1,5 gp", "1.5 gp", "0,5 gp", "1.234,56 gp", "1'5 gp"]) {
    assert.equal(parseCoins(text), null, text);
    assert.match(unreadCoins(text), /whole numbers[^]*1 gp 5 sp/, text);
  }
});

await test("modify_gold and the party purse refuse coins they cannot read, and nothing changes.", async () => {
  for (const coins of ["1,5 gp", "0.5 gp", "2,50 gp"]) {
    const out = await world.invoke("modify_gold", { characterId: hero.id, delta: 1, coins, reason: "the reward" });
    assert.equal(out.ok, false, `${coins} was read`);
    assert.match(out.error, /whole numbers/);
    assert.equal(getSheetById(hero.id).gold, 20);
  }
  const paid = await world.invoke("modify_gold", { characterId: hero.id, delta: 1, coins: "1.000 cp", reason: "the reward" });
  assert.equal(paid.ok, true, paid.error);
  assert.equal(getSheetById(hero.id).gold, 30);
});

await test("update_sheet's number fields read the same whole numbers, and refuse a part of one, never fifteen for 1,5.", () => {
  for (const [value, number] of [["1.000", 1000], ["1,000", 1000], ["1 000", 1000], [2500, 2500]]) {
    assert.deepEqual(foldFieldValue({ field: "xp", value }, ABILITIES), { args: { xp: number } }, String(value));
  }
  for (const value of ["1,5", "1.5", "0,5", "dieci"]) {
    const out = foldFieldValue({ field: "xp", value }, ABILITIES);
    assert.equal(out.retry, true, `${value}: ${JSON.stringify(out)}`);
    assert.match(out.error, /whole number/);
  }
});

await test("the pack's own costs keep their English notation: a decimal point and a thousands comma.", () => {
  for (const [cost, copper] of [["0.05 gp", 5], ["0.5 gp", 50], ["0.01 gp", 1], ["2,000 gp", 200000], ["1 sp", 10], ["15 gp", 1500]]) {
    assert.equal(packCostCopper(cost), copper, cost);
  }
  if (!world.hasPack) {
    return;
  }
  const costs = getContentDb().prepare("SELECT cost FROM items WHERE cost IS NOT NULL AND cost != ''").all().map((row) => row.cost);
  assert.ok(costs.length > 400, `${costs.length} pack costs`);
  for (const cost of costs) {
    const copper = packCostCopper(cost);
    assert.ok(Number.isInteger(copper) && copper >= 0, `${cost}: ${copper}`);
    // A cost written with no mark reads the same by either reader.
    if (!/\d[.,]\d/.test(cost)) {
      assert.equal(parseCoins(cost), copper, cost);
    }
  }
});

finish();
