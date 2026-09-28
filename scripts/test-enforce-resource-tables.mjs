// The limited-use counters a sheet carries, against SRD 5.1.
//
// test-enforce-class-tables.mjs walks the numbers a class table prints (rages,
// ki, sorcery points, channel divinity, lay on hands, action surge). This file
// holds what is left of the counters:
//
//   the set    a sheet of each SRD class, made at each level from 1 to 20,
//              carries the counters its class has earned and no counter that
//              belongs to another class or to a genre class
//   recovery   each counter comes back on the rest the SRD names
//   abilities  a pool sized by an ability modifier (Bardic Inspiration, Divine
//              Sense) is sized from the stored score, and resizes when the
//              score changes, without handing spent uses back
//   shrinking  a level or an ability going DOWN never leaves used above max
//   races      Breath Weapon (one use, short or long rest), Relentless
//              Endurance (one use, long rest, burnt by the server and never
//              by choice)
//   structure  every authored subclass counter and every genre class counter
//              has a rest that refills it, a whole maximum of at least one at
//              every level, and never shrinks as the level or the ability rises
//
// ODM's documented rule, pinned as such: Bardic Inspiration refills on a long
// rest at every level (src/lib/srd/class-resources.ts, "modeled as long for
// simplicity"); SRD 5.1 adds the short rest from bard 5.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openTable, setUsed } from "./lib/enforce-resources.mjs";
import { abilityMod, suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-resource-tables");
const world = await openTable();
const { RESOURCE_DEFS, resourceDef } = await import("../src/lib/srd/class-resources.ts");

const LEVELS = Array.from({ length: 20 }, (_, index) => index + 1);
const SCORES = { str: 10, dex: 10, con: 12, int: 10, wis: 14, cha: 16 };
const CHA = abilityMod(SCORES.cha);

const stepped = (steps, level) =>
  steps.reduce((value, [from, uses]) => (level >= from ? uses : value), null);

// SRD 5.1, class by class: the counter, and its maximum at a level (null
// before the feature is gained).
const SRD_COUNTERS = {
  barbarian: { rage: (level) => stepped([[1, 2], [3, 3], [6, 4], [12, 5], [17, 6]], level) },
  bard: { bardic_inspiration: () => Math.max(1, CHA) },
  cleric: { channel_divinity: (level) => stepped([[2, 1], [6, 2], [18, 3]], level) },
  druid: { wild_shape: (level) => (level >= 2 ? 2 : null) },
  fighter: {
    second_wind: () => 1,
    action_surge: (level) => stepped([[2, 1], [17, 2]], level),
  },
  monk: { ki: (level) => (level >= 2 ? level : null) },
  paladin: {
    lay_on_hands: (level) => level * 5,
    divine_sense: () => 1 + CHA,
    channel_divinity: (level) => (level >= 3 ? 1 : null),
  },
  ranger: {},
  rogue: {},
  sorcerer: { sorcery_points: (level) => (level >= 2 ? level : null) },
  warlock: {},
  wizard: { arcane_recovery: () => 1 },
};

// Cells another finding already owns, left out of the walk so it stays green:
// the level 20 capstones and the paladin's Channel Divinity are gaps in
// test-enforce-class-tables.mjs, the ranger's stray counter is a gap below.
const KNOWN = new Set(["barbarian:20:rage", "druid:20:wild_shape", "ranger:stray"]);
for (const level of LEVELS.filter((value) => value >= 6)) {
  KNOWN.add(`paladin:${level}:channel_divinity`);
}
// SRD features with a daily limit that ODM does not count yet. A counter for
// one of them appearing is a fix, not a stray.
const UNCOUNTED = /indomitable|stroke_of_luck|cleansing_touch|mystic_arcanum/;

const made = new Map();
function heroAt(classId, level, extra = {}) {
  const key = `${classId}:${level}:${JSON.stringify(extra)}`;
  if (!made.has(key)) {
    made.set(key, world.addHero({ class: classId, level, abilities: SCORES, ...extra }).id);
  }
  return world.sheet(made.get(key));
}

await test("every SRD class sheet carries its SRD counters at every level, and no stray one", () => {
  const problems = [];
  for (const [classId, counters] of Object.entries(SRD_COUNTERS)) {
    for (const level of LEVELS) {
      const sheet = heroAt(classId, level);
      for (const [id, maxAt] of Object.entries(counters)) {
        if (KNOWN.has(`${classId}:${level}:${id}`)) {
          continue;
        }
        const expected = maxAt(level);
        const held = sheet.resources[id];
        if (expected === null ? held !== undefined : held?.max !== expected || held?.used !== 0) {
          problems.push(`${classId} ${level} ${id}: expected ${expected}, holds ${JSON.stringify(held)}`);
        }
      }
      for (const id of Object.keys(sheet.resources)) {
        if (!(id in counters) && !UNCOUNTED.test(id) && !KNOWN.has(`${classId}:stray`)) {
          problems.push(`${classId} ${level} carries a stray counter ${id}`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

await test("each counter comes back on the rest the SRD names", () => {
  const SRD_RECOVERY = {
    rage: "long",
    channel_divinity: "short",
    wild_shape: "short",
    second_wind: "short",
    action_surge: "short",
    ki: "short",
    lay_on_hands: "long",
    divine_sense: "long",
    sorcery_points: "long",
    arcane_recovery: "long",
    natural_recovery: "long",
    // A dragonborn's breath returns on a short or a long rest.
    breath_weapon: "short",
    relentless_endurance: "long",
    // ODM's rule, declared in class-resources.ts: long at every level. The
    // SRD gives the short rest too from bard 5 (Font of Inspiration).
    bardic_inspiration: "long",
  };
  for (const [id, rest] of Object.entries(SRD_RECOVERY)) {
    assert.equal(resourceDef(id)?.recharge, rest, id);
  }
});

await test("a pool sized by an ability modifier is sized from the stored score", () => {
  for (const cha of [8, 10, 11, 12, 14, 17, 20]) {
    const bard = world.addHero({ class: "bard", level: 3, abilities: { cha } });
    // Charisma modifier, minimum 1.
    assert.equal(bard.resources.bardic_inspiration.max, Math.max(1, abilityMod(cha)), `CHA ${cha}`);
  }
  for (const cha of [10, 12, 15, 18, 20]) {
    const paladin = world.addHero({ class: "paladin", level: 3, abilities: { cha } });
    assert.equal(paladin.resources.divine_sense.max, 1 + abilityMod(cha), `CHA ${cha}`);
  }
});

await test("an ability going up widens the pool and hands no spent use back", () => {
  const bard = world.addHero({ class: "bard", level: 6, abilities: { cha: 16 } });
  setUsed(world, bard.id, { bardic_inspiration: 2 });
  world.patch(bard.id, { abilities: { ...bard.abilities, cha: 18 } });
  assert.deepEqual(world.sheet(bard.id).resources.bardic_inspiration, { max: 4, used: 2 });
});

await test("an ability going down shrinks the pool and used never sits above max", () => {
  const bard = world.addHero({ class: "bard", level: 6, abilities: { cha: 18 } });
  setUsed(world, bard.id, { bardic_inspiration: 4 });
  world.patch(bard.id, { abilities: { ...bard.abilities, cha: 12 } });
  assert.deepEqual(world.sheet(bard.id).resources.bardic_inspiration, { max: 1, used: 1 });
  const paladin = world.addHero({ class: "paladin", level: 4, abilities: { cha: 18 } });
  setUsed(world, paladin.id, { divine_sense: 5 });
  world.patch(paladin.id, { abilities: { ...paladin.abilities, cha: 10 } });
  assert.deepEqual(world.sheet(paladin.id).resources.divine_sense, { max: 1, used: 1 });
});

await test("a level going down shrinks every level-sized pool and used never sits above max", () => {
  const monk = world.addHero({ class: "monk", level: 8 });
  setUsed(world, monk.id, { ki: 7 });
  world.patch(monk.id, { level: 3 });
  assert.deepEqual(world.sheet(monk.id).resources.ki, { max: 3, used: 3 });
  const paladin = world.addHero({ class: "paladin", level: 10, abilities: { cha: 12 } });
  setUsed(world, paladin.id, { lay_on_hands: 50 });
  world.patch(paladin.id, { level: 2 });
  assert.deepEqual(world.sheet(paladin.id).resources.lay_on_hands, { max: 10, used: 10 });
  const barbarian = world.addHero({ class: "barbarian", level: 17 });
  setUsed(world, barbarian.id, { rage: 6 });
  world.patch(barbarian.id, { level: 1 });
  assert.deepEqual(world.sheet(barbarian.id).resources.rage, { max: 2, used: 2 });
});

await test("Natural Recovery belongs to the Circle of the Land and to no other druid", () => {
  const land = world.addHero({ class: "druid", subclass: "Circle of the Land", level: 2 });
  assert.deepEqual(land.resources.natural_recovery, { max: 1, used: 0 });
  const moon = world.addHero({ class: "druid", subclass: "Circle of the Moon", level: 2 });
  assert.equal(moon.resources.natural_recovery, undefined);
  assert.equal(heroAt("druid", 2).resources.natural_recovery, undefined);
});

// ---- racial counters ----

await test("a dragonborn has one Breath Weapon, whatever their class or level", () => {
  for (const level of [1, 5, 11, 20]) {
    const dragonborn = world.addHero({ class: "rogue", race: "dragonborn", level });
    assert.deepEqual(dragonborn.resources.breath_weapon, { max: 1, used: 0 }, `level ${level}`);
  }
  assert.equal(heroAt("rogue", 5).resources.breath_weapon, undefined);
});

await test("the breath is spent once, says its SRD dice and DC, and is refused until a rest", async () => {
  // 2d6 to 5th level, 3d6 at 6th, 4d6 at 11th, 5d6 at 16th; the save DC is
  // 8 + proficiency bonus + Constitution modifier.
  for (const [level, dice, proficiency] of [[5, "2d6", 3], [6, "3d6", 3], [11, "4d6", 4], [16, "5d6", 5]]) {
    const dragonborn = world.addHero({
      class: "fighter",
      race: "dragonborn",
      level,
      abilities: { con: 14 },
    });
    const breath = await world.invoke("use_resource", {
      characterId: dragonborn.id,
      resource: "Breath Weapon",
    });
    assert.equal(breath.ok, true, breath.error);
    assert.equal(breath.result.dice, dice, `level ${level}`);
    assert.equal(breath.result.dc, 8 + proficiency + 2, `level ${level}`);
    assert.deepEqual(world.sheet(dragonborn.id).resources.breath_weapon, { max: 1, used: 1 });
    const again = await world.invoke("use_resource", {
      characterId: dragonborn.id,
      resource: "Breath Weapon",
    });
    assert.equal(again.ok, false);
    assert.deepEqual(world.sheet(dragonborn.id).resources.breath_weapon, { max: 1, used: 1 });
  }
});

await test("Relentless Endurance holds a half-orc at 1 hit point once, and is never spent by choice", async () => {
  const orc = world.addHero({ class: "fighter", race: "half-orc", level: 3, maxHp: 30 });
  assert.deepEqual(orc.resources.relentless_endurance, { max: 1, used: 0 });
  const chosen = await world.invoke("use_resource", {
    characterId: orc.id,
    resource: "Relentless Endurance",
  });
  assert.equal(chosen.ok, false);
  assert.deepEqual(world.sheet(orc.id).resources.relentless_endurance, { max: 1, used: 0 });

  const felled = await world.invoke("apply_damage", { characterId: orc.id, amount: 40, reason: "test" });
  assert.equal(felled.ok, true, felled.error);
  assert.equal(world.sheet(orc.id).currentHp, 1);
  assert.equal(world.sheet(orc.id).deathSaves, null);
  assert.deepEqual(world.sheet(orc.id).resources.relentless_endurance, { max: 1, used: 1 });

  await world.invoke("apply_damage", { characterId: orc.id, amount: 5, reason: "test" });
  assert.equal(world.sheet(orc.id).currentHp, 0);
  assert.deepEqual(world.sheet(orc.id).resources.relentless_endurance, { max: 1, used: 1 });
});

// ---- the authored subclass layer and the genre classes ----

const readJson = (file) =>
  JSON.parse(fs.readFileSync(new URL(`../src/lib/${file}`, import.meta.url), "utf8")).resources;
const AUTHORED = readJson("srd/authored-resources.json");
const GENRE = readJson("classes/resources.json");
const flat = (score) => ({ str: score, dex: score, con: score, int: score, wis: score, cha: score });

await test("every counter id is unique, so no definition hides another", () => {
  const seen = new Set();
  for (const def of RESOURCE_DEFS) {
    assert.ok(!seen.has(def.id), `${def.id} is defined twice`);
    seen.add(def.id);
  }
  // 21 SRD counters: the fourteen the class tables always had, and
  // Indomitable, Cleansing Touch, Stroke of Luck and the four Mystic Arcana.
  // Then one per spell a race casts once a day (hellish rebuke, faerie fire,
  // darkness; the tiefling's and the drow's darkness are one counter).
  assert.equal(RESOURCE_DEFS.length, 21 + AUTHORED.length + GENRE.length + 3);
});

await test("every authored and genre row is structurally legal", () => {
  const problems = [];
  for (const row of [...AUTHORED, ...GENRE]) {
    if (row.recharge !== "short" && row.recharge !== "long") {
      problems.push(`${row.id}: no rest refills it (${row.recharge})`);
    }
    if (!Number.isInteger(row.uses) || row.uses < 0) {
      problems.push(`${row.id}: uses ${row.uses}`);
    }
    if (!Array.isArray(row.match) || !row.match.length || row.match.some((term) => term !== term.toLowerCase())) {
      problems.push(`${row.id}: match terms must be lowercase and present`);
    }
    // The first step whose level is reached wins, so the steps must run from
    // the highest level down and the uses must fall with them.
    for (let index = 1; index < (row.scale ?? []).length; index += 1) {
      const [level, uses] = row.scale[index];
      const [levelBefore, usesBefore] = row.scale[index - 1];
      if (level >= levelBefore || uses > usesBefore) {
        problems.push(`${row.id}: scale is not descending at ${JSON.stringify(row.scale[index])}`);
      }
    }
    for (const upgrade of row.upgrades ?? []) {
      if (!Number.isInteger(upgrade.uses) || upgrade.uses <= row.uses) {
        problems.push(`${row.id}: upgrade "${upgrade.match}" does not raise the uses`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

await test("every counter has a whole maximum of at least one and never shrinks as level or ability rises", () => {
  const problems = [];
  for (const def of RESOURCE_DEFS) {
    for (const modifier of [-5, -1, 0, 1, 3, 5]) {
      let before = 0;
      for (const level of LEVELS) {
        const max = def.maxFor(level, flat(modifier));
        if (!Number.isInteger(max) || max < 1) {
          problems.push(`${def.id}: max ${max} at level ${level}, modifier ${modifier}`);
        }
        if (max < before) {
          problems.push(`${def.id}: falls from ${before} to ${max} at level ${level}`);
        }
        before = max;
      }
    }
    for (const level of [1, 5, 11, 20]) {
      let before = 0;
      for (const modifier of [-5, -1, 0, 1, 3, 5]) {
        const max = def.maxFor(level, flat(modifier));
        if (max < before) {
          problems.push(`${def.id}: falls as the modifier rises to ${modifier} at level ${level}`);
        }
        before = max;
      }
    }
  }
  assert.deepEqual(problems, []);
});

await test("a sampled authored counter reaches a real sheet with its stated size", () => {
  // Superiority Dice: four at fighter 3 (Battle Master), five at 7, six at 15.
  for (const [level, dice] of [[3, 4], [7, 5], [15, 6]]) {
    const fighter = world.addHero({ class: "fighter", subclass: "Battle Master", level });
    const counter = Object.entries(fighter.resources).find(([id]) => /superiority/.test(id));
    assert.equal(counter?.[1].max, dice, `fighter ${level}`);
    assert.equal(counter?.[1].used, 0);
  }
});

// ---- findings ----

await test("A ranger's Vanish (14th level) is not a limited feature: Hide as a bonus action, as often as they like.", () => {
  for (const level of [14, 17, 20]) {
    assert.deepEqual(Object.keys(heroAt("ranger", level).resources), [], `ranger ${level}`);
  }
});

await test("Cleansing Touch has Charisma modifier uses per long rest, Stroke of Luck one use per short or long rest, and each Mystic Arcanum is cast once per long rest.", () => {
  const find = (sheet, pattern) =>
    Object.entries(sheet.resources).filter(([id]) => pattern.test(id)).map(([, state]) => state.max);
  assert.deepEqual(find(heroAt("paladin", 14), /cleansing/), [CHA]);
  assert.deepEqual(find(heroAt("rogue", 20), /stroke/), [1]);
  assert.deepEqual(find(heroAt("warlock", 17), /arcanum/), [1, 1, 1, 1]);
});

world.close();
finish();
