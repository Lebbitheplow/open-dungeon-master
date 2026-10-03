// Physical-dice entry: expressionDice face listing and manual scoring via
// rollExpressionWithDice (keep rules, modifiers, crit detection, bounds).
import assert from "node:assert/strict";
import {
  expressionDice,
  rollExpressionWithDice,
} from "../src/lib/dice.ts";
import { trayExpressionProblem } from "../src/lib/dice/tray-rules.ts";
import { EMPTY_TRAY_POOL, TRAY_DICE_PER_KIND, trayAddDie, trayPoolExpression } from "../src/lib/dice/tray-pool.ts";

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

test("the dice tray rolls dice, with a bonus a sheet could hold", () => {
  assert.equal(trayExpressionProblem("1d20+5"), null);
  assert.equal(trayExpressionProblem("2d20kh1-1"), null);
  assert.equal(trayExpressionProblem("8d6"), null);
  assert.equal(trayExpressionProblem("1d20+30"), null);
  assert.ok(trayExpressionProblem("20"));
  assert.ok(trayExpressionProblem("5+5"));
  assert.ok(trayExpressionProblem("1d20+31"));
  assert.ok(trayExpressionProblem("1d20-31"));
  assert.ok(trayExpressionProblem("1d1+19"));
  assert.ok(trayExpressionProblem("drop table"));
});

test("the tray's tapped dice read as one expression it will roll", () => {
  assert.equal(trayPoolExpression(EMPTY_TRAY_POOL), "");
  assert.equal(trayPoolExpression({ dice: {}, bonus: 4 }), "", "a bonus alone is not a roll");
  let pool = trayAddDie(EMPTY_TRAY_POOL, 6);
  pool = trayAddDie(pool, 20);
  pool = trayAddDie(pool, 6);
  assert.equal(trayPoolExpression(pool), "1d20+2d6");
  assert.equal(trayPoolExpression({ ...pool, bonus: 3 }), "1d20+2d6+3");
  assert.equal(trayPoolExpression({ ...pool, bonus: -2 }), "1d20+2d6-2");
  assert.equal(trayPoolExpression({ dice: { 100: 1 }, bonus: 99 }), "1d100+30", "the bonus stays inside the tray's limit");
  for (let tap = 0; tap < 30; tap += 1) pool = trayAddDie(pool, 4);
  assert.equal(pool.dice[4], TRAY_DICE_PER_KIND);
  for (const bonus of [-30, -1, 0, 7, 30]) {
    assert.equal(trayExpressionProblem(trayPoolExpression({ ...pool, bonus })), null, `bonus ${bonus}`);
  }
});

console.log(`${passed} manual-roll tests passed`);
