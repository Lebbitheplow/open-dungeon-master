// Physical-dice entry: expressionDice face listing and manual scoring via
// rollExpressionWithDice (keep rules, modifiers, crit detection, bounds).
import assert from "node:assert/strict";
import {
  expressionDice,
  rollExpressionWithDice,
} from "../src/lib/dice.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("expressionDice lists faces in roll order", () => {
  assert.deepEqual(expressionDice("1d20+5"), [20]);
  assert.deepEqual(expressionDice("2d20kh1+3"), [20, 20]);
  assert.deepEqual(expressionDice("2d6+1d4+2"), [6, 6, 4]);
});

test("manual scoring applies modifiers", () => {
  const result = rollExpressionWithDice("1d20+5", [13]);
  assert.equal(result.total, 18);
  assert.equal(result.natural, 13);
});

test("advantage keeps the highest entered die", () => {
  const result = rollExpressionWithDice("2d20kh1+2", [8, 17]);
  assert.equal(result.total, 19);
  assert.equal(result.natural, 17);
});

test("disadvantage keeps the lowest entered die", () => {
  const result = rollExpressionWithDice("2d20kl1", [8, 17]);
  assert.equal(result.total, 8);
});

test("crit detection works on entered dice", () => {
  assert.equal(rollExpressionWithDice("1d20+4", [20]).crit, "nat20");
  assert.equal(rollExpressionWithDice("2d20kl1+4", [1, 15]).crit, "nat1");
});

test("damage expressions sum all dice", () => {
  assert.equal(rollExpressionWithDice("2d6+3", [4, 5]).total, 12);
});

test("out-of-range and miscounted values are rejected", () => {
  assert.throws(() => rollExpressionWithDice("1d20", [21]));
  assert.throws(() => rollExpressionWithDice("1d20", [0]));
  assert.throws(() => rollExpressionWithDice("1d20", [10, 4]));
  assert.throws(() => rollExpressionWithDice("2d6", [3]));
  assert.throws(() => rollExpressionWithDice("1d6", [2.5]));
});

console.log(`${passed} manual-roll tests passed`);
