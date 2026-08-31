// The optional Variant: Encumbrance rule: what a pack weighs, which items
// nothing can weigh, and where the two thresholds bite.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  carriedWeight,
  carryMultiplier,
  COINS_PER_POUND,
  encumbranceCovers,
  encumbranceFor,
  lineWeightLb,
} = await import("../src/lib/srd/encumbrance.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("a stamped weight is multiplied by the count", () => {
  assert.equal(lineWeightLb({ name: "Torch", qty: 5, weight: 1 }), 5);
  assert.equal(lineWeightLb({ name: "Greatsword", qty: 1, weight: 6 }), 6);
});

test("armor falls back to the SRD table the content pack lacks", () => {
  // Open5e ships every armor row blank, so nothing stamps these.
  assert.equal(lineWeightLb({ name: "Plate", qty: 1 }), 65);
  assert.equal(lineWeightLb({ name: "+1 Chain Mail", qty: 1 }), 55);
  assert.equal(lineWeightLb({ name: "Shield", qty: 1 }), 6);
});

test("an unweighable item reads as unknown, never as zero", () => {
  assert.equal(lineWeightLb({ name: "A Strange Idol", qty: 1 }), null);
  assert.equal(lineWeightLb({ name: "Torch", qty: 1, weight: 0 }), null);
});

test("ammunition is weighed per round however the line is written", () => {
  // 20 arrows weigh a pound whether the count is in the name or the qty.
  assert.equal(lineWeightLb({ name: "Arrows (20)", qty: 1 }), 1);
  assert.equal(lineWeightLb({ name: "Arrows", qty: 20 }), 1);
  // And it tracks the count down as the quiver empties, rather than
  // multiplying a bundle weight by the rounds left.
  assert.equal(lineWeightLb({ name: "Arrows (7)", qty: 1 }), 0.35);
});

test("unweighed items are counted, not guessed at", () => {
  const pack = [
    { name: "Torch", qty: 2, weight: 1 },
    { name: "A Strange Idol", qty: 1 },
    { name: "An Older Idol", qty: 1 },
  ];
  assert.deepEqual(carriedWeight(pack), { pounds: 2, unweighed: 2 });
});

test("coins weigh 50 to the pound", () => {
  assert.equal(COINS_PER_POUND, 50);
  assert.equal(carriedWeight([], 500).pounds, 10);
});

test("an ordinary pack encumbers nobody", () => {
  const load = encumbranceFor({
    strength: 14,
    equipment: [
      { name: "Longsword", qty: 1, weight: 3 },
      { name: "Leather", qty: 1 },
      { name: "Arrows (20)", qty: 1 },
    ],
  });
  assert.equal(load.tier, "unencumbered");
  assert.equal(load.speedPenalty, 0);
  assert.equal(load.disadvantage, false);
  assert.equal(load.note, null);
  assert.equal(load.encumberedAtLb, 70);
  assert.equal(load.capacityLb, 210);
});

test("past 5x Strength costs 10 feet and nothing else", () => {
  const load = encumbranceFor({
    strength: 10,
    equipment: [{ name: "Loot", qty: 1, weight: 60 }],
  });
  assert.equal(load.tier, "encumbered");
  assert.equal(load.speedPenalty, 10);
  assert.equal(load.disadvantage, false);
  assert.match(load.note, /encumbered/);
});

test("past 10x Strength costs 20 feet and every physical roll", () => {
  const load = encumbranceFor({
    strength: 10,
    equipment: [{ name: "Loot", qty: 1, weight: 120 }],
  });
  assert.equal(load.tier, "heavily_encumbered");
  assert.equal(load.speedPenalty, 20);
  assert.equal(load.disadvantage, true);
  assert.equal(load.overCapacity, false);
  assert.match(load.note, /heavily encumbered/);
});

test("the exact threshold is not over it", () => {
  // "More than 5 times your Strength score" - 50 lb on a 10 STR is fine.
  const load = encumbranceFor({
    strength: 10,
    equipment: [{ name: "Loot", qty: 1, weight: 50 }],
  });
  assert.equal(load.tier, "unencumbered");
});

test("past the hard ceiling is flagged as well as penalized", () => {
  const load = encumbranceFor({
    strength: 10,
    equipment: [{ name: "An Anvil", qty: 1, weight: 200 }],
  });
  assert.equal(load.overCapacity, true);
  assert.equal(load.tier, "heavily_encumbered");
});

test("only the tiny and the large carry differently", () => {
  assert.equal(carryMultiplier("medium"), 1);
  // Small creatures carry as much as Medium ones; only Tiny halves.
  assert.equal(carryMultiplier("Small"), 1);
  assert.equal(carryMultiplier("Tiny"), 0.5);
  assert.equal(carryMultiplier("Large"), 2);
  assert.equal(carryMultiplier(undefined), 1);
});

test("the load weighs on the body, not the mind", () => {
  assert.equal(encumbranceCovers("str"), true);
  assert.equal(encumbranceCovers("dex"), true);
  assert.equal(encumbranceCovers("con"), true);
  assert.equal(encumbranceCovers("int"), false);
  assert.equal(encumbranceCovers("cha"), false);
  assert.equal(encumbranceCovers(null), false);
});

console.log(`encumbrance: ${passed} tests passed`);
