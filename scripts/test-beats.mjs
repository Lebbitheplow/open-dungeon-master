// The beat sheet (docs/visual-overhaul-plan.md sections 5.1, 5.5 and 5.8).
// Every piece of the board's presentation reads its length from one table,
// so a number drifting here is every hit on the board drifting with it.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  BEATS,
  BEAT_ORDER,
  QUICK_BEATS,
  REDUCED_BEATS,
  REDUCED_HOLD,
  beatOffsets,
  beatSheet,
  beatTotal,
  checkBeat,
  effectHold,
  numberRise,
} = await import("../src/lib/battlemap/beats.ts");
const { DELIVERY } = await import("../src/lib/battlemap/delivery.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("the full set is the plan's", () => {
  assert.deepEqual(BEATS, { announce: 420, roll: 820, impact: 420, status: 1500, clear: 260 });
  assert.equal(beatTotal(BEATS), 3420);
});

test("the quick set is the plan's", () => {
  assert.deepEqual(QUICK_BEATS, { announce: 180, roll: 350, impact: 260, status: 900, clear: 90 });
  assert.equal(beatTotal(QUICK_BEATS), 1780);
});

test("every quick beat is shorter than its full beat", () => {
  for (const name of BEAT_ORDER) {
    assert.ok(QUICK_BEATS[name] < BEATS[name], name);
  }
});

test("the offsets run in order and end at the total", () => {
  const offsets = beatOffsets(BEATS);
  assert.deepEqual(offsets, { announce: 0, roll: 420, impact: 1240, status: 1660, clear: 3160 });
  assert.equal(offsets.clear + BEATS.clear, beatTotal(BEATS));
});

test("the sheet is chosen by the table's settings, reduced motion first", () => {
  assert.equal(beatSheet(), BEATS);
  assert.equal(beatSheet({ quick: true }), QUICK_BEATS);
  assert.equal(beatSheet({ reduced: true }), REDUCED_BEATS);
  assert.equal(beatSheet({ reduced: true, quick: true }), REDUCED_BEATS);
});

test("reduced motion clamps every travel beat to nothing and holds 320 ms", () => {
  assert.equal(REDUCED_HOLD, 320);
  assert.equal(beatTotal(REDUCED_BEATS), 320);
  for (const name of ["announce", "roll", "impact", "clear"]) {
    assert.equal(REDUCED_BEATS[name], 0);
  }
  for (const kind of ["attack", "spell", "heal", "condition", "death", "door", "teleport", "ping", "template"]) {
    assert.equal(effectHold(kind, REDUCED_BEATS, 420), 320);
  }
});

test("a number rises for 1100 ms on the full set", () => {
  assert.equal(numberRise(BEATS), 1100);
  assert.equal(numberRise(QUICK_BEATS), 610);
});

test("a hit holds the stage for its delivery and its number", () => {
  assert.equal(effectHold("attack", BEATS, DELIVERY.slashing.delay), 1250);
  assert.equal(effectHold("spell", BEATS, DELIVERY.fire.delay), 1520);
  assert.ok(effectHold("spell", QUICK_BEATS, DELIVERY.fire.delay) < effectHold("spell", BEATS, DELIVERY.fire.delay));
});

test("a status word holds for the status beat", () => {
  assert.equal(effectHold("condition", BEATS), 1500);
  assert.equal(effectHold("death", BEATS), 1500);
  assert.equal(effectHold("condition", QUICK_BEATS), 900);
});

test("no effect holds longer than the whole sheet", () => {
  for (const kind of ["attack", "spell", "hazard", "heal", "template", "condition", "death", "teleport", "door", "gutter", "ping", "unknown"]) {
    for (const row of Object.values(DELIVERY)) {
      assert.ok(effectHold(kind, BEATS, row.delay) <= beatTotal(BEATS), kind);
      assert.ok(effectHold(kind, BEATS, row.delay) > 0, kind);
    }
  }
});

test("the skill check lands its total at 1080 and its verdict at 1180 of 1500", () => {
  assert.deepEqual(checkBeat(), { run: 1500, total: 1080, verdict: 1180 });
  const quick = checkBeat({ quick: true });
  assert.equal(quick.run, 900);
  assert.ok(quick.total < quick.verdict && quick.verdict < quick.run);
  assert.deepEqual(checkBeat({ reduced: true }), { run: 0, total: 0, verdict: 0 });
});

console.log(`test-beats: ${passed} passed`);
