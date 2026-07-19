// SRD class-resource tables: per-level maxima, feature matching, spend
// preservation, and rest refills.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { RESOURCE_DEFS, matchResource, populateResources, refillResources, resourceDef } =
  await import("../src/lib/srd/class-resources.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const mods = { str: 1, dex: 2, con: 2, int: 0, wis: 1, cha: 3 };

test("rage uses scale with level", () => {
  const def = resourceDef("rage");
  assert.equal(def.maxFor(1, mods), 2);
  assert.equal(def.maxFor(3, mods), 3);
  assert.equal(def.maxFor(6, mods), 4);
  assert.equal(def.maxFor(12, mods), 5);
  assert.equal(def.maxFor(17, mods), 6);
});

test("ki equals level; action surge doubles at 17; channel divinity steps", () => {
  assert.equal(resourceDef("ki").maxFor(7, mods), 7);
  assert.equal(resourceDef("action_surge").maxFor(16, mods), 1);
  assert.equal(resourceDef("action_surge").maxFor(17, mods), 2);
  assert.equal(resourceDef("channel_divinity").maxFor(2, mods), 1);
  assert.equal(resourceDef("channel_divinity").maxFor(6, mods), 2);
  assert.equal(resourceDef("channel_divinity").maxFor(18, mods), 3);
});

test("bardic inspiration = CHA mod (min 1); lay on hands = 5x level", () => {
  assert.equal(resourceDef("bardic_inspiration").maxFor(4, mods), 3);
  assert.equal(resourceDef("bardic_inspiration").maxFor(4, { cha: -1 }), 1);
  assert.equal(resourceDef("lay_on_hands").maxFor(6, mods), 30);
});

test("populateResources grants only matching features", () => {
  const out = populateResources(
    [{ name: "Rage" }, { name: "Unarmored Defense" }, { name: "Reckless Attack" }],
    3,
    mods,
    undefined,
  );
  assert.deepEqual(Object.keys(out), ["rage"]);
  assert.deepEqual(out.rage, { max: 3, used: 0 });
});

test("populateResources preserves spent uses across level-ups, clamped", () => {
  const existing = { rage: { max: 3, used: 3 } };
  const up = populateResources([{ name: "Rage" }], 6, mods, existing);
  assert.deepEqual(up.rage, { max: 4, used: 3 });
  const down = populateResources([{ name: "Rage" }], 1, mods, existing);
  assert.deepEqual(down.rage, { max: 2, used: 2 });
});

test("populateResources drops resources whose feature is gone", () => {
  const out = populateResources([{ name: "Second Wind" }], 5, mods, {
    rage: { max: 3, used: 1 },
  });
  assert.deepEqual(Object.keys(out), ["second_wind"]);
});

test("matchResource is fuzzy", () => {
  assert.equal(matchResource("Rage").id, "rage");
  assert.equal(matchResource("ki points").id, "ki");
  assert.equal(matchResource("Ki").id, "ki");
  assert.equal(matchResource("sorcery_points").id, "sorcery_points");
  assert.equal(matchResource("Channel Divinity").id, "channel_divinity");
  assert.equal(matchResource("nonsense"), null);
});

test("refillResources: long refills all, short only short-recharge", () => {
  const spent = {
    rage: { max: 3, used: 2 },
    second_wind: { max: 1, used: 1 },
  };
  const short = refillResources(spent, "short");
  assert.equal(short.rage.used, 2);
  assert.equal(short.second_wind.used, 0);
  const long = refillResources(spent, "long");
  assert.equal(long.rage.used, 0);
  assert.equal(long.second_wind.used, 0);
});

test("every def has match terms and positive max at level 5", () => {
  for (const def of RESOURCE_DEFS) {
    assert.ok(def.match.length > 0, def.id);
    assert.ok(def.maxFor(5, mods) >= 1, def.id);
  }
});

console.log(`test-class-resources: ${passed} tests passed`);
