// What things fetch when they change hands, priced by the table.
//
// SRD 5.1, Selling Treasure: "undamaged weapons, armor, and other equipment
// fetch half their cost when sold in a market", while "gems, jewelry, and
// art objects retain their full value in the marketplace". A buyer pays the
// list price. ODM reads the list price from the content pack, or from the
// worth a thing was given (grant_item's worth, in gold pieces), never from
// its name; the model's price is used only for a thing the table has no
// price for, and becomes the worth of what is bought.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-economy");
const world = await openWorld();
const tv = await import("../src/lib/dm/trade-value.ts");

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

// The same ruby at five tables: what it is and what it is worth are fields,
// the same in every language.
for (const name of ["Ruby", "Rubino", "Rubis", "Rubí", "Rubin"]) {
  await test(`A gem granted with its worth sells at its full value: a ${name} worth 1000 gp fetches 1000 gp.`, async () => {
    carry([]);
    const granted = await world.invoke("grant_item", { characterId: trader.id, name, tags: ["gem"], worth: 1000, reason: "a dragon's hoard" });
    assert.equal(granted.ok, true, granted.error);
    assert.deepEqual(world.sheet(trader.id).equipment, [{ name, qty: 1, tags: ["gem"], worth: 1000 }]);
    const sold = await world.invoke("purchase", { characterId: trader.id, item: name, price: 5, qty: 1, action: "sell" });
    assert.equal(sold.ok, true, sold.error);
    assert.equal(purse(), 100000);
  });
}

await test("A worth written into a name is no price: a Ruby (1000 gp) with no worth given sells at the price named.", async () => {
  carry([{ name: "Ruby (1000 gp)", qty: 1, tags: ["gem"] }]);
  const sold = await world.invoke("purchase", { characterId: trader.id, item: "Ruby (1000 gp)", price: 5, qty: 1, action: "sell" });
  assert.equal(sold.ok, true, sold.error);
  assert.equal(purse(), 500);
});

await test("Anything else given a worth sells for half of it, and an unidentified thing keeps its worth off the sheet.", async () => {
  carry([{ name: "Carved Whistle", qty: 1, worth: 4 }]);
  const sold = await world.invoke("purchase", { characterId: trader.id, item: "Carved Whistle", price: 99, qty: 1, action: "sell" });
  assert.equal(sold.ok, true, sold.error);
  assert.equal(purse(), 200);
  carry([]);
  const hidden = await world.invoke("grant_item", { characterId: trader.id, name: "a red stone", unidentified: true, tags: ["gem"], worth: 1000, reason: "found" });
  assert.equal(hidden.ok, true, hidden.error);
  assert.deepEqual(world.sheet(trader.id).equipment, [{ name: "a red stone", qty: 1, identified: false }]);
  const revealed = await world.invoke("reveal_item", { characterId: trader.id, name: "a red stone", revealedName: "Ruby", tags: ["gem"], worth: 1000, reason: "appraised" });
  assert.equal(revealed.ok, true, revealed.error);
  assert.deepEqual(world.sheet(trader.id).equipment, [{ name: "Ruby", qty: 1, tags: ["gem"], worth: 1000 }]);
});

await test("A thing bought at the price named, with no price of its own, keeps that price as its worth.", async () => {
  carry([], 10);
  const bought = await world.invoke("purchase", { characterId: trader.id, item: "Carved Whistle", price: 3, qty: 1, action: "buy" });
  assert.equal(bought.ok, true, bought.error);
  assert.deepEqual(world.sheet(trader.id).equipment, [{ name: "Carved Whistle", qty: 1, worth: 3 }]);
});

if (world.hasPack) {
  await test("A worth given to a thing the pack prices is refused: the pack's price is its worth.", async () => {
    carry([]);
    const granted = await world.invoke("grant_item", { characterId: trader.id, name: "Longsword", worth: 500, reason: "loot" });
    assert.equal(granted.retry, true, "a longsword was given a worth of 500 gp");
    assert.deepEqual(world.sheet(trader.id).equipment, []);
  });

  // SRD 5.2, Magic Item Rarity: common 100 gp, uncommon 400 gp, rare 4,000 gp,
  // very rare 40,000 gp, legendary 200,000 gp; a consumable is half.
  await test("A magic item outside a shop is worth its rarity's value, whatever price the model names: a Cloak of Protection (uncommon) costs 400 gp and sells for 200 gp.", async () => {
    carry([], 500);
    const bought = await world.invoke("purchase", { characterId: trader.id, item: "Cloak of Protection", price: 5, qty: 1, action: "buy" });
    assert.equal(bought.ok, true, bought.error);
    assert.equal(purse(), 10000);
    assert.equal(world.sheet(trader.id).equipment[0]?.worth, undefined, "the model's price was kept as a worth");
    carry([{ name: "Cloak of Protection", qty: 1 }]);
    const sold = await world.invoke("purchase", { characterId: trader.id, item: "Cloak of Protection", price: 5000, qty: 1, action: "sell" });
    assert.equal(sold.ok, true, sold.error);
    assert.equal(purse(), 20000);
  });

  await test("A magic item given or revealed takes its rarity's value, not a worth the model names: a gifted Potion of Climbing sells for half its 50 gp.", async () => {
    carry([]);
    const priced = await world.invoke("grant_item", { characterId: trader.id, name: "Potion of Climbing", worth: 900, reason: "a grateful witch" });
    assert.equal(priced.retry, true, "a potion of climbing was given a worth of 900 gp");
    assert.deepEqual(world.sheet(trader.id).equipment, []);
    const granted = await world.invoke("grant_item", { characterId: trader.id, name: "Potion of Climbing", reason: "a grateful witch" });
    assert.equal(granted.ok, true, granted.error);
    const sold = await world.invoke("purchase", { characterId: trader.id, item: "Potion of Climbing", price: 900, qty: 1, action: "sell" });
    assert.equal(sold.ok, true, sold.error);
    assert.equal(purse(), 2500);
    const hidden = await world.invoke("grant_item", { characterId: trader.id, name: "a grey cloak", unidentified: true, reason: "found" });
    assert.equal(hidden.ok, true, hidden.error);
    const revealed = await world.invoke("reveal_item", { characterId: trader.id, name: "a grey cloak", revealedName: "Cloak of Protection", worth: 9000, reason: "identify" });
    assert.equal(revealed.retry, true, "a cloak of protection was revealed with a worth of 9,000 gp");
  });

  await test("An artifact has no price the rules set, so the worth given is its worth.", async () => {
    assert.equal(tv.listPriceCp({ name: "Orb of Dragonkind" }), null);
    assert.equal(tv.listPriceCp({ name: "Orb of Dragonkind", worth: 50000 }), 5000000);
    assert.equal(tv.listPriceCp({ name: "Ring of Regeneration" }), 4000000);
  });

  await test("A +1, +2 or +3 weapon, armor or shield is worth its bonus's rarity and the item it is: a Longsword +1 is 415 gp, +1 plate 5,500 gp.", async () => {
    assert.equal(tv.listPriceCp({ name: "Longsword +1" }), 41500, "uncommon 400 gp and the longsword's 15 gp");
    assert.equal(tv.listPriceCp({ name: "Spada lunga +1", srdName: "Longsword" }), 41500, "the same sword named in the table's language");
    assert.equal(tv.listPriceCp({ name: "+1 Plate" }), 550000, "SRD 5.2's own example: rare 4,000 gp and plate's 1,500 gp");
    assert.equal(tv.listPriceCp({ name: "Shield +2" }), 401000, "a +2 shield is rare");
    assert.equal(tv.listPriceCp({ name: "Longsword" }), 1500, "a plain longsword keeps its list price");
    carry([]);
    const granted = await world.invoke("grant_item", { characterId: trader.id, name: "Longsword +1", worth: 2000, reason: "a knight's bequest" });
    assert.equal(granted.retry, true, "a +1 longsword was given a worth of 2,000 gp");
  });
}

await test("A shop that buys pays full value for a gem or an art object, and half for anything else.", async () => {
  const opened = await world.invoke("open_shop", { name: "The Gilded Scale", kind: "curiosities", size: "city" });
  assert.equal(opened.ok, true, opened.error);
  carry([{ name: "Silver Chalice", qty: 1, tags: ["art_object"], worth: 25 }]);
  const sold = await world.invoke("sell_item", { characterId: trader.id, shop: "The Gilded Scale", item: "Silver Chalice" });
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
