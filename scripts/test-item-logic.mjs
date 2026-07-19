// Consumable knowledge for use_item: potion tiers, item matching, ammo
// lookup.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { ammoItemFor, consumableEffect, findCarriedItem } = await import(
  "../src/lib/dm/item-logic.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("healing potion tiers", () => {
  assert.deepEqual(consumableEffect("Potion of Healing"), { kind: "healing", expression: "2d4+2" });
  assert.deepEqual(consumableEffect("Potion of Greater Healing"), { kind: "healing", expression: "4d4+4" });
  assert.deepEqual(consumableEffect("Superior Healing Potion"), { kind: "healing", expression: "8d4+8" });
  assert.deepEqual(consumableEffect("potion of supreme healing"), { kind: "healing", expression: "10d4+20" });
  assert.deepEqual(consumableEffect("Healing Draught"), { kind: "healing", expression: "2d4+2" });
});

test("non-healing consumables are generic", () => {
  assert.deepEqual(consumableEffect("Torch"), { kind: "generic" });
  assert.deepEqual(consumableEffect("Potion of Invisibility"), { kind: "generic" });
  assert.deepEqual(consumableEffect("Alchemist's Fire"), { kind: "generic" });
});

const pack = [
  { name: "Potion of Healing", qty: 2 },
  { name: "Quiver of Arrows", qty: 20 },
  { name: "Crossbow bolts", qty: 10 },
  { name: "Rope", qty: 1 },
];

test("findCarriedItem fuzzy matches", () => {
  assert.equal(findCarriedItem(pack, "potion of healing").name, "Potion of Healing");
  assert.equal(findCarriedItem(pack, "healing potion").name, "Potion of Healing");
  assert.equal(findCarriedItem(pack, "Potion").name, "Potion of Healing");
  assert.equal(findCarriedItem(pack, "shield"), null);
});

test("ammoItemFor matches quivers and plurals", () => {
  assert.equal(ammoItemFor(pack, "arrows").name, "Quiver of Arrows");
  assert.equal(ammoItemFor(pack, "bolts").name, "Crossbow bolts");
  assert.equal(ammoItemFor(pack, "rounds"), null);
  assert.equal(ammoItemFor([{ name: "Sling bullets", qty: 5 }], "sling bullets").name, "Sling bullets");
});

console.log(`test-item-logic: ${passed} tests passed`);
