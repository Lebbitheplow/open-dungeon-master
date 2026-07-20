// Phase 4 DM-utility math: CR-scaled treasure tiers, object AC/HP by
// material and size, and forced-march travel saves.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { treasureTierForCr, hoardGoldDice, hoardItemCount } = await import(
  "../src/lib/srd/treasure.ts"
);
const { objectAc, objectHp, objectProfile } = await import("../src/lib/srd/objects.ts");
const { forcedMarchHours, forcedMarchSaveDc, paceEffect } = await import("../src/lib/srd/travel.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("CR maps to the four treasure tiers", () => {
  assert.equal(treasureTierForCr(1), 1);
  assert.equal(treasureTierForCr(4), 1);
  assert.equal(treasureTierForCr(5), 2);
  assert.equal(treasureTierForCr(10), 2);
  assert.equal(treasureTierForCr(11), 3);
  assert.equal(treasureTierForCr(17), 4);
  assert.equal(treasureTierForCr(30), 4);
});

test("hoard gold multiplier and item count climb with tier", () => {
  assert.ok(hoardGoldDice(1).mult < hoardGoldDice(4).mult);
  assert.equal(hoardItemCount(1), 0);
  assert.ok(hoardItemCount(4) >= hoardItemCount(2));
});

test("object AC follows material, HP follows size and fragility", () => {
  assert.equal(objectAc("cloth"), 11);
  assert.equal(objectAc("wood"), 15);
  assert.equal(objectAc("adamantine"), 23);
  assert.ok(objectHp("large") > objectHp("tiny"));
  assert.equal(objectHp("medium", true), Math.floor(objectHp("medium") / 2));
  const door = objectProfile("wood", "large");
  assert.equal(door.ac, 15);
  assert.ok(door.hp > 0);
});

test("forced march begins past 8 hours with a rising DC", () => {
  assert.equal(forcedMarchHours(8), 0);
  assert.equal(forcedMarchHours(6), 0);
  assert.equal(forcedMarchHours(11), 3);
  assert.equal(forcedMarchSaveDc(1), 10);
  assert.equal(forcedMarchSaveDc(3), 12);
});

test("pace changes watchfulness and stealth", () => {
  assert.equal(paceEffect("fast").passivePerceptionMod, -5);
  assert.equal(paceEffect("fast").canStealth, false);
  assert.equal(paceEffect("slow").canStealth, true);
  assert.equal(paceEffect("normal").passivePerceptionMod, 0);
});

console.log(`test-world: ${passed} suites passed.`);
