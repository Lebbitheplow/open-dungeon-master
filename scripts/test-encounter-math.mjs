// 5e encounter-budget math: CR/XP table, party thresholds, multi-monster
// multipliers, verdicts, and difficulty ceilings.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  xpForCr,
  thresholdsForParty,
  encounterMultiplier,
  evaluateEncounter,
  encounterCeiling,
} = await import("../src/lib/srd/encounter-math.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("CR to XP spot checks", () => {
  assert.equal(xpForCr(0), 10);
  assert.equal(xpForCr(0.25), 50);
  assert.equal(xpForCr(1), 200);
  assert.equal(xpForCr(3), 700);
  assert.equal(xpForCr(17), 18000);
  assert.equal(xpForCr(30), 155000);
});

test("oddball CRs snap to the nearest table row", () => {
  assert.equal(xpForCr(0.3), 50);
  assert.equal(xpForCr(2.5), 450);
});

test("party thresholds sum per character", () => {
  const four3s = thresholdsForParty([3, 3, 3, 3]);
  assert.equal(four3s.medium, 600);
  assert.equal(four3s.deadly, 1600);
  const mixed = thresholdsForParty([1, 2]);
  assert.equal(mixed.easy, 25 + 50);
});

test("levels clamp to 1..20", () => {
  assert.equal(thresholdsForParty([0]).easy, 25);
  assert.equal(thresholdsForParty([25]).easy, 2800);
});

test("multiplier ladder", () => {
  assert.equal(encounterMultiplier(1, 4), 1);
  assert.equal(encounterMultiplier(2, 4), 1.5);
  assert.equal(encounterMultiplier(4, 4), 2);
  assert.equal(encounterMultiplier(8, 4), 2.5);
  assert.equal(encounterMultiplier(12, 4), 3);
  assert.equal(encounterMultiplier(15, 4), 4);
});

test("party size shifts the band", () => {
  assert.equal(encounterMultiplier(1, 2), 1.5);
  assert.equal(encounterMultiplier(3, 6), 1.5);
  assert.equal(encounterMultiplier(15, 2), 4);
  assert.equal(encounterMultiplier(1, 6), 0.5);
});

test("verdicts scale with adjusted XP", () => {
  // 4x level-3 party: easy 300, medium 600, hard 900, deadly 1600.
  assert.equal(evaluateEncounter([3, 3, 3, 3], [0]).verdict, "trivial");
  assert.equal(evaluateEncounter([3, 3, 3, 3], [1]).verdict, "easy");
  assert.equal(evaluateEncounter([3, 3, 3, 3], [3]).verdict, "medium");
  // Two CR2 (450 each): 900 * 1.5 = 1350 adjusted -> hard.
  assert.equal(evaluateEncounter([3, 3, 3, 3], [2, 2]).verdict, "hard");
  // CR5 solo: 1800 -> deadly (within 1.5x of 1600).
  assert.equal(evaluateEncounter([3, 3, 3, 3], [5]).verdict, "deadly");
  assert.equal(evaluateEncounter([3, 3, 3, 3], [9]).verdict, "beyond_deadly");
});

test("adjusted XP applies the multiplier", () => {
  const evaluation = evaluateEncounter([3, 3, 3, 3], [0.25, 0.25, 0.25, 0.25]);
  assert.equal(evaluation.totalXp, 200);
  assert.equal(evaluation.adjustedXp, 400);
});

test("difficulty ceilings", () => {
  assert.equal(encounterCeiling("easy", 1600), 1600);
  assert.equal(encounterCeiling("normal", 1600), 2000);
  assert.equal(encounterCeiling("hard", 1600), 2400);
  assert.equal(encounterCeiling("deadly", 1600), 3200);
});

console.log(`test-encounter-math: ${passed} passed`);
