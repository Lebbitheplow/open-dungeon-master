// Consumable knowledge for use_item: potion tiers, item matching.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { consumableEffect, findCarriedItem } = await import(
  "../src/lib/dm/item-logic.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("healing potion tiers", () => {
  assert.deepEqual(consumableEffect({ name: "Potion of Healing" }), { kind: "healing", expression: "2d4+2" });
  assert.deepEqual(consumableEffect({ name: "Potion of Greater Healing" }), { kind: "healing", expression: "4d4+4" });
  assert.deepEqual(consumableEffect({ name: "Potion of Superior Healing" }), { kind: "healing", expression: "8d4+8" });
  assert.deepEqual(consumableEffect({ name: "potion of supreme healing" }), { kind: "healing", expression: "10d4+20" });
  // A healing potion no row names heals as a plain Potion of Healing.
  assert.deepEqual(consumableEffect({ name: "Healing Draught", tags: ["consumable", "potion", "healing_potion"] }), { kind: "healing", expression: "2d4+2" });
});

test("non-healing consumables are generic", () => {
  assert.deepEqual(consumableEffect({ name: "Torch" }), { kind: "generic" });
  assert.deepEqual(consumableEffect({ name: "Potion of Invisibility" }), { kind: "generic" });
  assert.deepEqual(consumableEffect({ name: "Alchemist's Fire" }), { kind: "generic" });
});

const pack = [
  { name: "Potion of Healing", qty: 2 },
  { name: "Quiver of Arrows", qty: 20 },
  { name: "Crossbow bolts", qty: 10 },
  { name: "Rope", qty: 1 },
];

test("findCarriedItem takes the whole name, never words of it", () => {
  assert.equal(findCarriedItem(pack, "potion of healing").name, "Potion of Healing");
  assert.equal(findCarriedItem(pack, "healing potion"), null);
  assert.equal(findCarriedItem(pack, "Potion"), null);
  assert.equal(findCarriedItem(pack, "shield"), null);
});

console.log(`test-item-logic: ${passed} tests passed`);
