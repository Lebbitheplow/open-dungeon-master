// SRD class-resource tables: per-level maxima, feature matching, spend
// preservation, and rest refills.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  RESOURCE_DEFS,
  matchResource,
  populateResources,
  rageDamageBonus,
  refillResources,
  resourceDef,
  spendRelentlessEndurance,
} = await import("../src/lib/srd/class-resources.ts");

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

test("word-boundary matching: racial traits never grant class pools", () => {
  // Half-elf fighter regression: "Skill Versatility" contains "ki" as a
  // substring and once granted monk Ki.
  const halfElfFighter = populateResources(
    [{ name: "Second Wind" }, { name: "Skill Versatility" }, { name: "Darkvision" }],
    5,
    mods,
    undefined,
  );
  assert.equal(halfElfFighter.ki, undefined);
  assert.ok(halfElfFighter.second_wind);
  // Real monk Ki still matches.
  assert.ok(populateResources([{ name: "Ki" }], 5, mods, undefined).ki);
});

test("exact matching: Road Rage is not barbarian Rage", () => {
  const roadWarrior = populateResources([{ name: "Road Rage" }], 14, mods, undefined);
  assert.equal(roadWarrior.rage, undefined);
  assert.ok(populateResources([{ name: "Rage" }], 3, mods, undefined).rage);
});

test("paladin Channel Divinity feature grants the pool", () => {
  const paladin = populateResources([{ name: "Channel Divinity" }], 3, mods, undefined);
  assert.ok(paladin.channel_divinity);
});

test("every def carries an effect and guidance the model can read", () => {
  for (const def of RESOURCE_DEFS) {
    assert.ok(def.effect?.kind, def.id);
    assert.ok(def.guidance && def.guidance.length > 20, def.id);
  }
});

test("Second Wind heals 1d10 + fighter level", () => {
  const effect = resourceDef("second_wind").effect;
  assert.equal(effect.kind, "heal_self");
  assert.equal(effect.dice(1, mods), "1d10+1");
  assert.equal(effect.dice(11, mods), "1d10+11");
});

test("Lay on Hands heals straight from its pool", () => {
  assert.equal(resourceDef("lay_on_hands").effect.kind, "heal_pool");
});

test("Rage applies the raging condition for 10 rounds", () => {
  const effect = resourceDef("rage").effect;
  assert.equal(effect.kind, "condition");
  assert.equal(effect.condition, "raging");
  assert.equal(effect.rounds, 10);
});

test("rage damage bonus steps at 9 and 16", () => {
  assert.equal(rageDamageBonus(1), 2);
  assert.equal(rageDamageBonus(8), 2);
  assert.equal(rageDamageBonus(9), 3);
  assert.equal(rageDamageBonus(15), 3);
  assert.equal(rageDamageBonus(16), 4);
});

test("Bardic Inspiration die grows with bard level", () => {
  const die = resourceDef("bardic_inspiration").effect.die;
  assert.equal(die(1), "d6");
  assert.equal(die(5), "d8");
  assert.equal(die(10), "d10");
  assert.equal(die(15), "d12");
});

test("Breath Weapon routes to the AoE engine with growing dice", () => {
  const effect = resourceDef("breath_weapon").effect;
  assert.equal(effect.kind, "aoe");
  assert.equal(effect.dice(1), "2d6");
  assert.equal(effect.dice(6), "3d6");
  assert.equal(effect.dice(16), "5d6");
});

test("Relentless Endurance is the only passive def", () => {
  const passive = RESOURCE_DEFS.filter((def) => def.passive).map((def) => def.id);
  assert.deepEqual(passive, ["relentless_endurance"]);
});

test("Relentless Endurance spends once, then refuses", () => {
  const first = spendRelentlessEndurance({ relentless_endurance: { max: 1, used: 0 } });
  assert.deepEqual(first.relentless_endurance, { max: 1, used: 1 });
  assert.equal(spendRelentlessEndurance(first), null);
  // Absent feature: nothing to burn.
  assert.equal(spendRelentlessEndurance({ rage: { max: 3, used: 0 } }), null);
  assert.equal(spendRelentlessEndurance(undefined), null);
});

const { parseFontOfMagic } = await import("../src/lib/dm/resource-tools.ts");

test("Font of Magic variants parse direction and slot level", () => {
  assert.deepEqual(parseFontOfMagic("create a 2nd-level slot"), {
    direction: "create_slot",
    level: 2,
  });
  assert.deepEqual(parseFontOfMagic("make a level 3 spell slot"), {
    direction: "create_slot",
    level: 3,
  });
  assert.deepEqual(parseFontOfMagic("convert my 3rd-level slot into points"), {
    direction: "recover_points",
    level: 3,
  });
  assert.deepEqual(parseFontOfMagic("break a 1st level slot into sorcery points"), {
    direction: "recover_points",
    level: 1,
  });
  // A plain Metamagic spend carries no slot talk and is not a conversion.
  assert.equal(parseFontOfMagic("quickened spell"), null);
  assert.equal(parseFontOfMagic(undefined), null);
});

console.log(`test-class-resources: ${passed} tests passed`);
