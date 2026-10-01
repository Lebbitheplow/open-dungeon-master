// What things fetch when they change hands, priced by the table.
//
// SRD 5.1, Selling Treasure: "undamaged weapons, armor, and other equipment
// fetch half their cost when sold in a market", while "gems, jewelry, and
// art objects retain their full value in the marketplace". A buyer pays the
// list price. ODM reads the list price from the content pack, or from the
// value a treasure's name carries ("Ruby (1000 gp)"); the model's price is
// used only for a thing the table has no price for.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-economy");
const world = await openWorld();

const trader = world.addHero({ class: "fighter", level: 1 });
const purse = () => {
  const sheet = world.sheet(trader.id);
  return sheet.gold * 100 + (sheet.copper ?? 0);
};
const carry = (equipment, gold = 0) => world.patch(trader.id, { equipment, gold, copper: 0 });

if (world.hasPack) {
  await test("Equipment sold outside a shop fetches half its list price, whatever price the model names: a Longsword (15 gp) sells for 7 gp 5 sp.", async () => {
    for (const price of [15, 999]) {
      carry([{ name: "Longsword", qty: 1 }]);
      const sold = await world.invoke("purchase", { characterId: trader.id, item: "Longsword", price, qty: 1, action: "sell" });
      assert.equal(sold.ok, true, sold.error);
      assert.equal(purse(), 750, `sold at a named ${price} gp`);
    }
  });

  await test("A buyer outside a shop pays the list price, not the price the model names: a Longsword costs 15 gp.", async () => {
    carry([], 20);
    const bought = await world.invoke("purchase", { characterId: trader.id, item: "Longsword", price: 1, qty: 1, action: "buy" });
    assert.equal(bought.ok, true, bought.error);
    assert.equal(purse(), 500);
  });
}

await test("A gem sells at its full value: a Ruby (1000 gp) fetches 1000 gp.", async () => {
  carry([{ name: "Ruby (1000 gp)", qty: 1 }]);
  const sold = await world.invoke("purchase", { characterId: trader.id, item: "Ruby (1000 gp)", price: 5, qty: 1, action: "sell" });
  assert.equal(sold.ok, true, sold.error);
  assert.equal(purse(), 100000);
});

await test("A shop that buys pays full value for a gem or an art object, and half for anything else.", async () => {
  const opened = await world.invoke("open_shop", { name: "The Gilded Scale", kind: "curiosities", size: "city" });
  assert.equal(opened.ok, true, opened.error);
  carry([{ name: "Silver Chalice (25 gp)", qty: 1 }]);
  const sold = await world.invoke("sell_item", { characterId: trader.id, shop: "The Gilded Scale", item: "Silver Chalice (25 gp)" });
  assert.equal(sold.ok, true, sold.error);
  assert.equal(purse(), 2500);
});

await test("a thing the table has no price for is traded at the price named", async () => {
  carry([{ name: "Carved Whistle", qty: 1 }]);
  const sold = await world.invoke("purchase", { characterId: trader.id, item: "Carved Whistle", price: 3, qty: 1, action: "sell" });
  assert.equal(sold.ok, true, sold.error);
  assert.equal(purse(), 300);
});

world.close();
finish();
