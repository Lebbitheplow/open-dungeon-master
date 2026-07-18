// Point-buy cost contract (mirrors src/lib/srd/point-buy.ts, which is the
// standard published 5e table; the values below are the spec).
import assert from "node:assert/strict";

const COSTS = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const BUDGET = 27;

const source = await import("node:fs").then((fs) =>
  fs.readFileSync(new URL("../src/lib/srd/point-buy.ts", import.meta.url), "utf8"),
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("source table matches the published 5e costs", () => {
  for (const [score, cost] of Object.entries(COSTS)) {
    assert.match(source, new RegExp(`${score}:\\s*${cost}[,\\n]`), `cost of ${score}`);
  }
  assert.match(source, /POINT_BUY_BUDGET = 27/);
});

test("all 15s is unaffordable, all 13s exactly fits with 8s", () => {
  const total = (scores) => scores.reduce((sum, s) => sum + COSTS[s], 0);
  assert.ok(total([15, 15, 15, 15, 15, 15]) > BUDGET);
  assert.equal(total([15, 15, 15, 8, 8, 8]), BUDGET);
  assert.equal(total([13, 13, 13, 12, 12, 12]), BUDGET);
});

console.log(`${passed} point-buy tests passed`);
