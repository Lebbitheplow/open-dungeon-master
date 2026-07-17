// Assert-based tests for the dice engine. Run with: npm run test:dice
import assert from "node:assert/strict";
import { rollExpression, rollD20, d20Expression, isValidExpression } from "../src/lib/dice.ts";

// Deterministic RNG: returns values from a fixed queue.
function queueRng(values) {
  const queue = [...values];
  return () => {
    if (!queue.length) {
      throw new Error("queueRng exhausted");
    }
    return queue.shift();
  };
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("1d20+5 sums die and modifier", () => {
  const result = rollExpression("1d20+5", queueRng([13]));
  assert.equal(result.total, 18);
  assert.equal(result.natural, 13);
  assert.equal(result.crit, undefined);
});

test("4d6kh3+2 keeps the three highest", () => {
  const result = rollExpression("4d6kh3+2", queueRng([4, 1, 6, 3]));
  assert.equal(result.total, 4 + 6 + 3 + 2);
  const dice = result.terms[0].dice;
  assert.deepEqual(dice.map((d) => d.kept), [true, false, true, true]);
  assert.equal(result.natural, undefined);
});

test("2d20kl1 disadvantage keeps the lowest", () => {
  const result = rollExpression("2d20kl1", queueRng([17, 4]));
  assert.equal(result.total, 4);
  assert.equal(result.natural, 4);
});

test("nat20 flagged through advantage", () => {
  const result = rollExpression("2d20kh1+3", queueRng([20, 11]));
  assert.equal(result.total, 23);
  assert.equal(result.crit, "nat20");
});

test("nat1 flagged on plain d20", () => {
  const result = rollExpression("1d20-1", queueRng([1]));
  assert.equal(result.total, 0);
  assert.equal(result.crit, "nat1");
});

test("no crit metadata on damage rolls", () => {
  const result = rollExpression("8d6", queueRng([1, 2, 3, 4, 5, 6, 1, 2]));
  assert.equal(result.total, 24);
  assert.equal(result.natural, undefined);
});

test("negative modifiers and multiple terms", () => {
  const result = rollExpression("1d8+2d4-3", queueRng([5, 2, 4]));
  assert.equal(result.total, 5 + 2 + 4 - 3);
});

test("d20Expression canonical forms", () => {
  assert.equal(d20Expression(5), "1d20+5");
  assert.equal(d20Expression(-2, "advantage"), "2d20kh1-2");
  assert.equal(d20Expression(0, "disadvantage"), "2d20kl1");
});

test("rollD20 applies advantage", () => {
  const result = rollD20(4, "advantage", queueRng([9, 15]));
  assert.equal(result.total, 19);
  assert.equal(result.natural, 15);
});

test("invalid expressions rejected", () => {
  for (const bad of ["", "d20", "1d1", "1d101", "101d6", "4d6kh5", "1d20++3", "banana", "1d20+", "-"]) {
    assert.equal(isValidExpression(bad), false, `expected invalid: ${bad}`);
  }
});

test("valid expressions accepted", () => {
  for (const good of ["1d20", "1D20 + 5", "2d20kh1", "4d6kh3+2", "1d100-10", "3+1d4"]) {
    assert.equal(isValidExpression(good), true, `expected valid: ${good}`);
  }
});

test("crypto RNG stays in bounds over 10k rolls", () => {
  for (let i = 0; i < 10000; i += 1) {
    const { total, natural } = rollExpression("1d20");
    assert.ok(total >= 1 && total <= 20, `out of bounds: ${total}`);
    assert.equal(natural, total);
  }
  const counts = new Set();
  for (let i = 0; i < 2000; i += 1) {
    counts.add(rollExpression("1d6").total);
  }
  assert.equal(counts.size, 6, "all six faces should appear in 2000 rolls");
});

console.log(`\n${passed} dice tests passed`);
