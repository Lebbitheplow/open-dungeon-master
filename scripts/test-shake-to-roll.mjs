// The shake detector: a burst of hard direction changes fires once, then
// rests; a single knock, a gentle wave, or a shake spread too thin does not.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { createShakeDetector } = await import("../src/lib/dice/shake-to-roll.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// Alternating hard swings along x every `stepMs`, gravity on z.
function swings(feed, count, stepMs, startAt = 0, magnitude = 25) {
  const fired = [];
  for (let i = 0; i < count; i++) {
    const at = startAt + i * stepMs;
    const x = i % 2 === 0 ? magnitude : -magnitude;
    if (feed({ x, y: 0, z: 9.8, at })) fired.push(at);
  }
  return fired;
}

test("resting still never fires", () => {
  const feed = createShakeDetector();
  for (let at = 0; at < 5_000; at += 50) {
    assert.equal(feed({ x: 0.1, y: -0.1, z: 9.8, at }), false);
  }
});

test("one hard knock is not a shake", () => {
  const feed = createShakeDetector();
  assert.equal(feed({ x: 0, y: 0, z: 9.8, at: 0 }), false);
  assert.equal(feed({ x: 30, y: 0, z: 9.8, at: 50 }), false);
  assert.equal(feed({ x: 0, y: 0, z: 9.8, at: 100 }), false);
});

test("a burst of swings fires exactly once", () => {
  const feed = createShakeDetector();
  const fired = swings(feed, 8, 60);
  assert.equal(fired.length, 1, `fired at ${fired.join(",")}`);
});

test("the detector rests after firing, then fires again", () => {
  const feed = createShakeDetector({ cooldownMs: 1_000 });
  const first = swings(feed, 6, 60, 0);
  assert.equal(first.length, 1);
  // Still inside the rest: nothing.
  assert.equal(swings(feed, 6, 60, first[0] + 200).length, 0);
  // After the rest: a second shake counts.
  assert.equal(swings(feed, 6, 60, first[0] + 1_500).length, 1);
});

test("hard moves spread wider than the window do not add up", () => {
  const feed = createShakeDetector({ windowMs: 500, moves: 3 });
  assert.equal(swings(feed, 6, 400).length, 0);
});

test("gentle waving stays under the threshold", () => {
  const feed = createShakeDetector({ threshold: 18 });
  assert.equal(swings(feed, 10, 60, 0, 6).length, 0);
});

console.log(`test-shake-to-roll: ${passed} checks passed`);
