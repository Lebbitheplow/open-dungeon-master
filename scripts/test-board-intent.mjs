// Enemy intent on the board (docs/visual-overhaul-plan.md 5.6): the client's
// half. The server owns the secret; this checks the board's last line of
// defence, that it never draws an intent pointing at a token the viewer's
// own projection does not contain, and the geometry of the arc.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { ARC_STAGGER_MS, ARC_STEPS, intentArc, intentSentence, visibleIntents } = await import(
  "../src/lib/battlemap/intent.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const warlord = { actorTokenId: "t-warlord", verb: "Longsword", targetTokenId: "t-ysolde", expected: 9, source: "declared", round: 3 };
const wolf = { actorTokenId: "t-wolf", verb: "Pounce", targetTokenId: "t-kael", source: "likely", round: 3 };

test("no projection, no intents", () => {
  assert.deepEqual(visibleIntents(undefined, ["t-kael"]), []);
  assert.deepEqual(visibleIntents(null, ["t-kael"]), []);
  assert.deepEqual(visibleIntents([], ["t-kael"]), []);
});

test("an intent whose actor is not on the viewer's board is dropped", () => {
  assert.deepEqual(visibleIntents([warlord], ["t-ysolde", "t-kael"]), []);
});

test("an intent whose target is not on the viewer's board is dropped", () => {
  assert.deepEqual(visibleIntents([warlord], ["t-warlord", "t-kael"]), []);
});

test("an intent with both ends in view is kept, one per actor", () => {
  const ids = ["t-warlord", "t-ysolde", "t-wolf", "t-kael"];
  assert.deepEqual(visibleIntents([warlord, wolf, { ...warlord, verb: "Shove" }], ids), [warlord, wolf]);
});

test("an intent from an earlier round is stale", () => {
  const ids = ["t-warlord", "t-ysolde"];
  assert.deepEqual(visibleIntents([warlord], ids, 4), []);
  assert.deepEqual(visibleIntents([warlord], ids, 3), [warlord]);
});

test("an intent with no single mark is kept", () => {
  const breath = { actorTokenId: "t-wolf", verb: "Howl", source: "declared" };
  assert.deepEqual(visibleIntents([breath], ["t-wolf"]), [breath]);
});

test("a guess is worded as a guess", () => {
  assert.equal(intentSentence(warlord, "Hobgoblin Warlord", "Ysolde"), "Hobgoblin Warlord plans to Longsword Ysolde");
  assert.equal(intentSentence(wolf, "Dire Wolf", "Kael"), "Dire Wolf will likely Pounce Kael");
  assert.equal(intentSentence({ ...wolf, targetTokenId: null }, "Dire Wolf"), "Dire Wolf will likely Pounce");
});

test("the arc is thirty scales, 12 ms apart, from the actor to the mark", () => {
  const arc = intentArc({ x: 10, y: 100 }, { x: 210, y: 100 });
  assert.equal(ARC_STEPS, 30);
  assert.equal(ARC_STAGGER_MS, 12);
  assert.equal(arc.scales.length, 30);
  assert.deepEqual([arc.scales[0].x, arc.scales[0].y], [10, 100]);
  assert.deepEqual([Math.round(arc.scales[29].x), Math.round(arc.scales[29].y)], [210, 100]);
  assert.equal(arc.scales[5].delay, 60);
  assert.equal(arc.headDelay, 360);
  // Raised in the middle, fattest there, tapered at both ends.
  assert.ok(arc.scales[15].y < 100);
  assert.ok(arc.scales[15].size > arc.scales[0].size);
  assert.ok(arc.scales[15].size > arc.scales[29].size);
});

console.log(`test-board-intent: ${passed} passed`);
