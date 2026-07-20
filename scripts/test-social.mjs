// 5e social-interaction math: attitude-driven check DCs, one-step attitude
// shifts on a decisive result, and the first-meeting reaction table.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  ATTITUDE_ORDER,
  socialCheckDc,
  shiftAttitude,
  resolveSocialCheck,
  reactionAttitude,
  approachSkill,
} = await import("../src/lib/dm/social.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("check DC falls as attitude warms", () => {
  assert.equal(socialCheckDc("hostile"), 20);
  assert.equal(socialCheckDc("indifferent"), 15);
  assert.equal(socialCheckDc("friendly"), 10);
});

test("attitude shifts one step and clamps at the ends", () => {
  assert.equal(shiftAttitude("hostile", "up"), "indifferent");
  assert.equal(shiftAttitude("indifferent", "up"), "friendly");
  assert.equal(shiftAttitude("friendly", "up"), "friendly"); // clamps
  assert.equal(shiftAttitude("hostile", "down"), "hostile"); // clamps
  assert.deepEqual([...ATTITUDE_ORDER], ["hostile", "indifferent", "friendly"]);
});

test("beating the DC by 5 warms; missing by 5 sours; the middle holds", () => {
  // Indifferent DC 15.
  const strong = resolveSocialCheck(20, "indifferent");
  assert.equal(strong.success, true);
  assert.equal(strong.shifted, true);
  assert.equal(strong.direction, "up");
  assert.equal(strong.attitude, "friendly");

  const weak = resolveSocialCheck(10, "indifferent");
  assert.equal(weak.success, false);
  assert.equal(weak.shifted, true);
  assert.equal(weak.direction, "down");
  assert.equal(weak.attitude, "hostile");

  const middling = resolveSocialCheck(16, "indifferent");
  assert.equal(middling.success, true);
  assert.equal(middling.shifted, false);
  assert.equal(middling.attitude, "indifferent");
});

test("a decisive result at an end does not report a phantom shift", () => {
  const alreadyFriendly = resolveSocialCheck(30, "friendly");
  assert.equal(alreadyFriendly.shifted, false);
  assert.equal(alreadyFriendly.attitude, "friendly");
});

test("reaction roll bands map 2d6 to a starting attitude", () => {
  assert.equal(reactionAttitude(2), "hostile");
  assert.equal(reactionAttitude(5), "hostile");
  assert.equal(reactionAttitude(6), "indifferent");
  assert.equal(reactionAttitude(8), "indifferent");
  assert.equal(reactionAttitude(9), "friendly");
  assert.equal(reactionAttitude(12), "friendly");
});

test("approach maps to the right social skill", () => {
  assert.equal(approachSkill("persuade"), "persuasion");
  assert.equal(approachSkill("deceive"), "deception");
  assert.equal(approachSkill("intimidate"), "intimidation");
  assert.equal(approachSkill("threaten"), "intimidation");
  assert.equal(approachSkill("dance"), null);
});

console.log(`test-social: ${passed} suites passed.`);
