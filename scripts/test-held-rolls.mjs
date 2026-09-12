// Who gets a parked roll instead of an immediate one: real-dice players
// only where the campaign allows real dice, and hold-my-rolls players
// everywhere, since the server still draws their numbers.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { heldRollUserIds } = await import("../src/lib/dice/held-rolls.ts");

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

console.log(`test-held-rolls: ${passed} checks passed`);
