// The 4d6 pool the server throws and keeps for a player (issue #128): a six
// handed back from record is marked kept, with when it was thrown; the
// reroll threshold is the admin's setting, 0 allowing no second throw; a
// spent pool is gone.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";

const world = await openWorld();
const rolls = await import("../src/lib/db/creation-rolls.ts");
const { getGlobalConfig, saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const player = world.addUser("roller");
const faces = (pool) => pool.throws.map((entry) => entry.dice.join("")).join("|");

test("the default rule is 70, and the first throw is never kept", () => {
  assert.equal(getGlobalConfig().abilityRerollBelow, 70);
  assert.equal(rolls.abilityRerollBelow(), 70);
  assert.equal(rolls.openAbilityPool(player.id), null);
  const first = rolls.rollAbilityPool(player.id);
  assert.equal(first.kept, false);
  assert.equal(first.rerollBelow, 70);
  assert.ok(first.createdAt, "a fresh throw says when");
  assert.equal(first.throws.length, 6);
});

test("a six on record comes back marked kept, with when it was thrown", () => {
  const open = rolls.openAbilityPool(player.id);
  assert.ok(open);
  assert.equal(open.kept, true);
  assert.ok(open.createdAt);
  assert.equal(open.rerollBelow, 70);
});

test("under a rule of 0 no second throw is allowed: asking again hands back the same six, kept", () => {
  saveGlobalConfig({ abilityRerollBelow: 0 });
  const before = rolls.openAbilityPool(player.id);
  assert.equal(before.canReroll, false);
  const again = rolls.rollAbilityPool(player.id);
  assert.equal(again.kept, true);
  assert.equal(again.rerollBelow, 0);
  assert.equal(faces(again), faces(before), "a different six under a no-reroll rule");
});

test("under a rule of 108 anything may be thrown back: asking again throws fresh dice", () => {
  saveGlobalConfig({ abilityRerollBelow: 108 });
  const before = rolls.openAbilityPool(player.id);
  assert.equal(before.canReroll, true);
  const again = rolls.rollAbilityPool(player.id);
  assert.equal(again.kept, false);
  assert.equal(again.rerollBelow, 108);
  assert.notEqual(faces(again), faces(before), "the same twenty-four dice twice");
});

test("the setting is bounded and the default returns", () => {
  assert.equal(saveGlobalConfig({ abilityRerollBelow: 70 }).abilityRerollBelow, 70);
  assert.equal(rolls.abilityRerollBelow(), 70);
});

test("a spent pool is gone, and the next throw is fresh", () => {
  rolls.spendAbilityPool(player.id);
  assert.equal(rolls.openAbilityPool(player.id), null);
  assert.equal(rolls.rollAbilityPool(player.id).kept, false);
});

world.close();
console.log(`\ntest-creation-rolls: ${passed} tests passed.`);
