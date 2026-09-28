// Who gets a parked roll instead of an immediate one: real-dice players
// only where the campaign allows real dice, and hold-my-rolls players
// everywhere, since the server still draws their numbers.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { heldRollUserIds, parkReasonFor, mayTypeFaces } = await import(
  "../src/lib/dice/held-rolls.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const members = [
  { userId: "real", useRealDice: true, holdRolls: false },
  { userId: "hold", useRealDice: false, holdRolls: true },
  { userId: "both", useRealDice: true, holdRolls: true },
  { userId: "neither", useRealDice: false, holdRolls: false },
];

test("with real dice allowed, both opt-ins park", () => {
  const ids = heldRollUserIds("real_allowed", members);
  assert.deepEqual([...ids].sort(), ["both", "hold", "real"]);
});

test("with real dice off, only hold-my-rolls parks", () => {
  const ids = heldRollUserIds("digital_only", members);
  assert.deepEqual([...ids].sort(), ["both", "hold"]);
});

test("no members, no one", () => {
  assert.equal(heldRollUserIds("real_allowed", []).size, 0);
});

test("the reason a roll is parked: real dice where allowed, else held", () => {
  const [real, hold, both, neither] = members;
  assert.equal(parkReasonFor("real_allowed", real), "real_dice");
  assert.equal(parkReasonFor("real_allowed", both), "real_dice");
  assert.equal(parkReasonFor("real_allowed", hold), "held");
  assert.equal(parkReasonFor("digital_only", real), null);
  assert.equal(parkReasonFor("digital_only", both), "held");
  assert.equal(parkReasonFor("real_allowed", neither), null);
  assert.equal(parkReasonFor("real_allowed", null), null);
});

test("typed faces count only for a real-dice park the policy still covers", () => {
  const [real, hold, both] = members;
  assert.equal(mayTypeFaces("real_dice", "real_allowed", real), true);
  assert.equal(mayTypeFaces("real_dice", "digital_only", real), false);
  assert.equal(mayTypeFaces("held", "real_allowed", both), false);
  assert.equal(mayTypeFaces("held", "real_allowed", hold), false);
  // A roll parked before the reason was recorded reads the table as it stands.
  assert.equal(mayTypeFaces(null, "real_allowed", real), true);
  assert.equal(mayTypeFaces(null, "real_allowed", hold), false);
  assert.equal(mayTypeFaces(null, "digital_only", both), false);
  assert.equal(mayTypeFaces("real_dice", "real_allowed", undefined), false);
});

console.log(`test-held-rolls: ${passed} checks passed`);
