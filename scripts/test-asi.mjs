// Ability Score Improvement math: thresholds, the 20 cap, crossed levels,
// and reverse-application for down-scaled instantiation.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { ASI_LEVELS, earnedAsiCount, crossedAsiLevels, applyAsiChoices, removeAsiChoices } =
  await import("../src/lib/srd/asi.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const base = { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };

test("thresholds are the 5e ASI levels", () => {
  assert.deepEqual([...ASI_LEVELS], [4, 8, 12, 16, 19]);
});

test("earned count by level", () => {
  assert.equal(earnedAsiCount(1), 0);
  assert.equal(earnedAsiCount(3), 0);
  assert.equal(earnedAsiCount(4), 1);
  assert.equal(earnedAsiCount(8), 2);
  assert.equal(earnedAsiCount(12), 3);
  assert.equal(earnedAsiCount(18), 4);
  assert.equal(earnedAsiCount(19), 5);
  assert.equal(earnedAsiCount(20), 5);
});

test("crossed levels between two levels", () => {
  assert.deepEqual(crossedAsiLevels(3, 4), [4]);
  assert.deepEqual(crossedAsiLevels(4, 5), []);
  assert.deepEqual(crossedAsiLevels(3, 8), [4, 8]);
  assert.deepEqual(crossedAsiLevels(1, 20), [4, 8, 12, 16, 19]);
  assert.deepEqual(crossedAsiLevels(8, 8), []);
});

test("plus2 and plus1x2 apply additively", () => {
  const next = applyAsiChoices(base, [
    { mode: "plus2", ability: "str" },
    { mode: "plus1x2", abilities: ["dex", "con"] },
  ]);
  assert.equal(next.str, 18);
  assert.equal(next.dex, 13);
  assert.equal(next.con, 15);
  assert.equal(base.str, 16);
});

test("feat choices leave scores alone", () => {
  assert.deepEqual(applyAsiChoices(base, [{ mode: "feat", feat: "Alert" }]), base);
});

test("null slots are skipped", () => {
  const next = applyAsiChoices(base, [null, { mode: "plus2", ability: "wis" }, undefined]);
  assert.equal(next.wis, 12);
});

test("scores cap at 20", () => {
  const next = applyAsiChoices(
    { ...base, str: 19 },
    [
      { mode: "plus2", ability: "str" },
      { mode: "plus2", ability: "str" },
    ],
  );
  assert.equal(next.str, 20);
});

test("removal reverses application away from the cap", () => {
  const choices = [
    { mode: "plus2", ability: "str" },
    { mode: "plus1x2", abilities: ["dex", "con"] },
  ];
  assert.deepEqual(removeAsiChoices(applyAsiChoices(base, choices), choices), base);
});

test("removal floors at 1 and is lossy at the cap", () => {
  const capped = applyAsiChoices({ ...base, str: 19 }, [{ mode: "plus2", ability: "str" }]);
  assert.equal(capped.str, 20);
  assert.equal(removeAsiChoices(capped, [{ mode: "plus2", ability: "str" }]).str, 18);
  assert.equal(removeAsiChoices({ ...base, str: 2 }, [{ mode: "plus2", ability: "str" }]).str, 1);
});

console.log(`test-asi: ${passed} tests passed.`);
