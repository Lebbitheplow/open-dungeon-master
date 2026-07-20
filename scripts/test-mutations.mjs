// Clamp math for DM sheet mutations.
import assert from "node:assert/strict";
import {
  applyDamageMath,
  goldMath,
  grantItemMath,
  healMath,
  removeItemMath,
  sheetBuffViolation,
  spendSlotMath,
  wildShapeDamageMath,
} from "../src/lib/dm/mutation-math.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("damage soaks temp HP first", () => {
  const result = applyDamageMath(20, 5, 8);
  assert.equal(result.tempHp, 0);
  assert.equal(result.currentHp, 17);
  assert.equal(result.absorbed, 5);
  assert.equal(result.dropped, false);
});

test("damage floors at 0 and reports dropped", () => {
  const result = applyDamageMath(6, 0, 50);
  assert.equal(result.currentHp, 0);
  assert.equal(result.dropped, true);
});

test("damage on a downed character does not re-report dropped", () => {
  assert.equal(applyDamageMath(0, 0, 10).dropped, false);
});

test("overkill measures damage past 0 HP, after temp HP", () => {
  assert.equal(applyDamageMath(6, 0, 50).overkill, 44);
  assert.equal(applyDamageMath(20, 5, 8).overkill, 0);
  // Temp HP soaks first: 30 damage - 5 temp = 25 vs 6 HP -> 19 overkill.
  assert.equal(applyDamageMath(6, 5, 30).overkill, 19);
  assert.equal(applyDamageMath(0, 0, 10).overkill, 10);
});

test("heal caps at max", () => {
  assert.equal(healMath(20, 24, 10).currentHp, 24);
  assert.equal(healMath(0, 24, 5).currentHp, 5);
});

test("gold floors at 0 with applied delta", () => {
  const result = goldMath(10, -25);
  assert.equal(result.gold, 0);
  assert.equal(result.applied, -10);
  assert.equal(goldMath(10, 15).gold, 25);
});

test("spell slot spending", () => {
  assert.deepEqual(spendSlotMath({ max: 3, used: 1 }), { max: 3, used: 2 });
  assert.equal(spendSlotMath({ max: 2, used: 2 }), null);
  assert.equal(spendSlotMath(null), null);
});

test("item removal adjusts qty and removes empty rows", () => {
  const equipment = [{ name: "Torch", qty: 3 }, { name: "Rope", qty: 1 }];
  const partial = removeItemMath(equipment, "torch", 2);
  assert.equal(partial.equipment.find((item) => item.name === "Torch").qty, 1);
  const full = removeItemMath(equipment, "Rope", 1);
  assert.equal(full.equipment.some((item) => item.name === "Rope"), false);
  assert.equal(removeItemMath(equipment, "Lantern", 1), null);
});

test("item granting merges by name", () => {
  const equipment = [{ name: "Torch", qty: 1 }];
  assert.equal(grantItemMath(equipment, "torch", 2).equipment[0].qty, 3);
  assert.equal(grantItemMath(equipment, "Dagger", 1).equipment.length, 2);
});

test("wild shape: the beast pool takes the hit and the druid is untouched", () => {
  const result = wildShapeDamageMath(37, 0, 12);
  assert.equal(result.beastHp, 25);
  assert.equal(result.reverted, false);
  assert.equal(result.carryover, 0);
});

test("wild shape: breaking the form carries only the excess through", () => {
  const result = wildShapeDamageMath(8, 0, 20);
  assert.equal(result.beastHp, 0);
  assert.equal(result.reverted, true);
  assert.equal(result.carryover, 12);
});

test("wild shape: exactly lethal damage reverts with nothing carried", () => {
  const result = wildShapeDamageMath(8, 0, 8);
  assert.equal(result.reverted, true);
  assert.equal(result.carryover, 0);
});

test("wild shape: temp HP soaks before the beast pool", () => {
  const result = wildShapeDamageMath(10, 4, 6);
  assert.equal(result.absorbed, 4);
  assert.equal(result.tempHp, 0);
  assert.equal(result.beastHp, 8);
});

const sheet5 = { name: "Kara", level: 5, maxHp: 40, gold: 50 };

test("buff cap: a single-level bump and a rename pass", () => {
  assert.equal(sheetBuffViolation(sheet5, { level: 6 }), null);
  assert.equal(sheetBuffViolation(sheet5, { name: "Kara the Cursed" }), null);
});

test("buff cap: a multi-level jump is refused", () => {
  assert.match(sheetBuffViolation(sheet5, { level: 10 }), /at most one level/);
});

test("buff cap: an ability score past 20 is refused", () => {
  assert.match(sheetBuffViolation(sheet5, { abilities: { str: 25 } }), /cap at 20/);
  assert.equal(sheetBuffViolation(sheet5, { abilities: { str: 20 } }), null);
});

test("buff cap: a 999 HP jump is refused, a level-sized bump passes", () => {
  assert.match(sheetBuffViolation(sheet5, { maxHp: 999 }), /maximum HP/);
  assert.equal(sheetBuffViolation(sheet5, { maxHp: 48 }), null);
});

test("buff cap: a huge direct gold grant is refused", () => {
  assert.match(sheetBuffViolation(sheet5, { gold: 100000 }), /Coin moves through/);
  assert.equal(sheetBuffViolation(sheet5, { gold: 200 }), null);
});

test("buff cap: hand-set XP that vaults levels is refused", () => {
  assert.match(sheetBuffViolation(sheet5, {}, 20), /Experience is earned/);
  assert.equal(sheetBuffViolation(sheet5, {}, 6), null);
});

console.log(`${passed} mutation tests passed`);
