// A rolled damage total split by damage type (src/lib/dm/damage-parts.ts).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { damageParts } = await import("../src/lib/dm/damage-parts.ts");
const { rollExpressionWithDice } = await import("../src/lib/dice.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const RADIANT = { dice: "1d4", type: "radiant" };

test("a blow with no typed rider is one part", () => {
  const roll = rollExpressionWithDice("1d8+3", [6]);
  assert.deepEqual(damageParts(roll, "slashing", []), [{ type: "slashing", amount: 9 }]);
});

test("a typed rider is its own part, and the modifier stays with the weapon", () => {
  const roll = rollExpressionWithDice("1d8+3+1d4", [6, 4]);
  assert.deepEqual(damageParts(roll, "slashing", [RADIANT]), [
    { type: "slashing", amount: 9 },
    { type: "radiant", amount: 4 },
  ]);
});

test("a rider of the weapon's own type, or of none, stays with the weapon", () => {
  const roll = rollExpressionWithDice("1d8+3+1d6", [6, 2]);
  assert.deepEqual(damageParts(roll, "slashing", [{ dice: "1d6", type: "slashing" }]), [
    { type: "slashing", amount: 11 },
  ]);
  assert.deepEqual(damageParts(roll, "slashing", [{ dice: "1d6", type: "" }]), [
    { type: "slashing", amount: 11 },
  ]);
});

test("a smite of the weapon's die size is told from the weapon by its count", () => {
  const roll = rollExpressionWithDice("1d8+3+3d8", [5, 1, 2, 3]);
  assert.deepEqual(damageParts(roll, "slashing", [{ dice: "3d8", type: "radiant" }]), [
    { type: "slashing", amount: 8 },
    { type: "radiant", amount: 6 },
  ]);
});

test("on a critical hit both copies of the rider's dice are the rider's", () => {
  // 1d8+1d8+3 for the sword, 1d4+1d4 for the rider.
  const roll = rollExpressionWithDice("1d8+1d8+3+1d4+1d4", [6, 2, 4, 3]);
  assert.deepEqual(damageParts(roll, "slashing", [RADIANT], { crit: true }), [
    { type: "slashing", amount: 11 },
    { type: "radiant", amount: 7 },
  ]);
});

test("the extra weapon dice of a critical hit are the weapon's, whatever their size", () => {
  // A dagger (1d4) under Divine Favor (1d4) with one Savage Attacks die.
  const roll = rollExpressionWithDice("1d4+1d4+2+1d4+1d4+1d4", [1, 1, 3, 3, 4]);
  assert.deepEqual(damageParts(roll, "piercing", [RADIANT], { crit: true, trailingTerms: 1 }), [
    { type: "piercing", amount: 8 },
    { type: "radiant", amount: 6 },
  ]);
});

test("under Powerful Critical the rider's maximum is the rider's", () => {
  const roll = rollExpressionWithDice("1d8+8+3+1d4+4", [6, 3]);
  assert.deepEqual(damageParts(roll, "slashing", [RADIANT], { crit: true }), [
    { type: "slashing", amount: 17 },
    { type: "radiant", amount: 7 },
  ]);
});

test("two riders of two types, and two of one", () => {
  const roll = rollExpressionWithDice("1d8+1d4+1d6+1d6", [5, 4, 2, 6]);
  const parts = damageParts(roll, "slashing", [
    RADIANT,
    { dice: "1d6", type: "necrotic" },
    { dice: "1d6", type: "necrotic" },
  ]);
  assert.deepEqual(
    parts.sort((a, b) => a.type.localeCompare(b.type)),
    [
      { type: "necrotic", amount: 8 },
      { type: "radiant", amount: 4 },
      { type: "slashing", amount: 5 },
    ],
  );
});

test("a penalty that eats the weapon's part leaves the rider whole", () => {
  const roll = rollExpressionWithDice("1d4-4+1d4", [1, 3]);
  assert.deepEqual(damageParts(roll, "piercing", [RADIANT]), [
    { type: "piercing", amount: 0 },
    { type: "radiant", amount: 3 },
  ]);
});

console.log(`test-damage-parts: ${passed} passed`);
