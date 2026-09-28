// The thirty-six setting classes (src/lib/classes/*.json), held to the
// structure the SRD's twelve have, through the engine that builds a sheet.
//
// scripts/test-class-catalog.mjs already checks the definition files as
// data (hit die, two saves, a caster's ability). This suite asks what a
// SHEET of each class holds at every level from 1 to 20, because that is
// where the definitions meet createSheet, the resource engine, the slot
// tables and the multiclass rules.
//
// The rules held, each one the SRD's rule for its own classes:
//   a class feature is held from its level on and never before, and the list
//   never shrinks as the level rises;
//   subclass features need the subclass to be chosen and its level reached;
//   a full caster, a half caster and a pact caster have the slots of the SRD
//   wizard, paladin and warlock tables (written out below);
//   a limited-use counter belongs to a feature the character has, once, and
//   0 <= used <= max; it is spent by use_resource and comes back at the rest
//   its feature names;
//   multiclassing into or out of a class needs 13 in its ability.
//
// ODM's own rule: a setting class has one prerequisite ability (the SRD's
// classes have one or two), chosen by the catalog.
import assert from "node:assert/strict";
import { heroInput, openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-genre-classes");
const { CUSTOM_CLASSES, CUSTOM_CLASS_FEATURES } = await import("../src/lib/classes/index.ts");
const { resourceDef } = await import("../src/lib/srd/class-resources.ts");
const { canMulticlassInto, slotTableFor, pactSlotsFor } = await import("../src/lib/srd/multiclass.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");

const world = await openWorld();

// A stored sheet of any class and level. It belongs to a user of its own and
// holds no seat: the table has eight, and this suite makes hundreds.
function sheetOf(classId, level, extra = {}) {
  const table = CUSTOM_CLASS_FEATURES[classId];
  return createSheet(
    world.campaignId,
    world.addUser("genre").id,
    level,
    heroInput({
      class: classId,
      level,
      subclass: level >= table.subclassLevel ? table.subclasses[0].name : "",
      abilities: { str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14 },
      ...extra,
    }),
  );
}

// SRD 5.1 slot tables, by class level: slots of 1st, 2nd, ... level.
const FULL = {
  1: [2], 2: [3], 3: [4, 2], 4: [4, 3], 5: [4, 3, 2], 6: [4, 3, 3], 7: [4, 3, 3, 1], 8: [4, 3, 3, 2],
  9: [4, 3, 3, 3, 1], 10: [4, 3, 3, 3, 2], 11: [4, 3, 3, 3, 2, 1], 12: [4, 3, 3, 3, 2, 1],
  13: [4, 3, 3, 3, 2, 1, 1], 14: [4, 3, 3, 3, 2, 1, 1], 15: [4, 3, 3, 3, 2, 1, 1, 1],
  16: [4, 3, 3, 3, 2, 1, 1, 1], 17: [4, 3, 3, 3, 2, 1, 1, 1, 1], 18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
  19: [4, 3, 3, 3, 3, 2, 1, 1, 1], 20: [4, 3, 3, 3, 3, 2, 2, 1, 1],
};
const HALF = {
  1: [], 2: [2], 3: [3], 4: [3], 5: [4, 2], 6: [4, 2], 7: [4, 3], 8: [4, 3], 9: [4, 3, 2], 10: [4, 3, 2],
  11: [4, 3, 3], 12: [4, 3, 3], 13: [4, 3, 3, 1], 14: [4, 3, 3, 1], 15: [4, 3, 3, 2], 16: [4, 3, 3, 2],
  17: [4, 3, 3, 3, 1], 18: [4, 3, 3, 3, 1], 19: [4, 3, 3, 3, 2], 20: [4, 3, 3, 3, 2],
};
// Pact Magic: [slots, slot level].
const PACT = {
  1: [1, 1], 2: [2, 1], 3: [2, 2], 4: [2, 2], 5: [2, 3], 6: [2, 3], 7: [2, 4], 8: [2, 4], 9: [2, 5],
  10: [2, 5], 11: [3, 5], 12: [3, 5], 13: [3, 5], 14: [3, 5], 15: [3, 5], 16: [3, 5], 17: [4, 5],
  18: [4, 5], 19: [4, 5], 20: [4, 5],
};
const asTable = (row) => Object.fromEntries(row.map((count, index) => [String(index + 1), count]));

await test("there are thirty-six setting classes, six to a genre file", () => {
  assert.equal(CUSTOM_CLASSES.length, 36);
  assert.equal(new Set(CUSTOM_CLASSES.map((klass) => klass.id)).size, 36);
  for (const klass of CUSTOM_CLASSES) {
    assert.ok(CUSTOM_CLASS_FEATURES[klass.id], `${klass.id} has no feature table`);
  }
});

await test("a feature is held from its level on, never before, at every level of every class", () => {
  for (const klass of CUSTOM_CLASSES) {
    const table = CUSTOM_CLASS_FEATURES[klass.id];
    const subclass = table.subclasses[0];
    const subclassNames = new Set(Object.values(subclass.levels).flat());
    let held = 0;
    for (let level = 1; level <= 20; level += 1) {
      const sheet = sheetOf(klass.id, level);
      const tag = `${klass.id} ${level}`;
      const granted = sheet.features.filter((feature) => feature.source === "class");
      const names = new Set(granted.map((feature) => feature.name));
      assert.ok(granted.every((feature) => (feature.level ?? 1) <= level), `${tag} holds a later feature`);
      assert.ok(granted.length >= held, `${tag} lost a feature`);
      held = granted.length;
      for (const [at, features] of Object.entries(table.levels)) {
        for (const name of features) {
          assert.equal(names.has(name), Number(at) <= level, `${tag}: ${name} (level ${at})`);
        }
      }
      for (const [at, features] of Object.entries(subclass.levels)) {
        for (const name of features) {
          const due = Number(at) <= level && level >= table.subclassLevel;
          assert.equal(names.has(name), due, `${tag}: ${subclass.name}'s ${name} (level ${at})`);
        }
      }
      // No subclass chosen, no subclass features, whatever the level.
      const plain = sheetOf(klass.id, level, { subclass: "" });
      assert.ok(!plain.features.some((feature) => subclassNames.has(feature.name)), `${tag} without a subclass`);
    }
  }
});

await test("a subclass is chosen at 1st, 2nd or 3rd level and its first feature arrives with it", () => {
  for (const klass of CUSTOM_CLASSES) {
    const table = CUSTOM_CLASS_FEATURES[klass.id];
    assert.ok([1, 2, 3].includes(table.subclassLevel), klass.id);
    assert.equal(table.subclasses.length, 1, klass.id);
    const first = Math.min(...Object.keys(table.subclasses[0].levels).map(Number));
    assert.equal(first, table.subclassLevel, klass.id);
  }
});

await test("casters have the slots of the SRD table for their kind, at every level", () => {
  const kinds = { full: 0, half: 0, pact: 0, none: 0 };
  for (const klass of CUSTOM_CLASSES) {
    kinds[klass.casterType] += 1;
    for (let level = 1; level <= 20; level += 1) {
      const slots = slotTableFor({ class: klass.id, classes: [], level });
      const pact = pactSlotsFor(klass.casterType === "pact" ? level : 0);
      const tag = `${klass.id} ${level}`;
      if (klass.casterType === "full") {
        assert.deepEqual(slots, asTable(FULL[level]), tag);
      } else if (klass.casterType === "half") {
        assert.deepEqual(slots, asTable(HALF[level]), tag);
      } else {
        assert.deepEqual(slots, {}, tag);
      }
      if (klass.casterType === "pact") {
        assert.deepEqual([pact.max, pact.level], PACT[level], tag);
      } else {
        assert.equal(pact, null, tag);
      }
    }
  }
  assert.ok(kinds.full && kinds.half && kinds.pact && kinds.none, JSON.stringify(kinds));
});

await test("multiclassing into or out of a setting class needs 13 in its ability", () => {
  const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
  const scores = (...high) =>
    Object.fromEntries(ABILITIES.map((ability) => [ability, high.includes(ability) ? 13 : 12]));
  const member = (classId, abilities) => ({ class: classId, subclass: "", level: 1, classes: [], abilities });
  for (const klass of CUSTOM_CLASSES) {
    assert.equal(canMulticlassInto(member("fighter", scores(...ABILITIES)), klass.id).ok, true, klass.id);
    // A fighter with Strength 13 may leave; which one more 13 opens this door?
    const opens = canMulticlassInto(member("fighter", scores("str")), klass.id).ok
      ? ["str"]
      : ABILITIES.filter((ability) => canMulticlassInto(member("fighter", scores("str", ability)), klass.id).ok);
    assert.equal(opens.length, 1, `${klass.id} opens on ${opens.join(", ") || "nothing"}`);
    // Leaving it needs the same 13, whatever the new class asks.
    const [needed] = opens;
    const target = needed === "int" ? "cleric" : "wizard";
    const others = ABILITIES.filter((ability) => ability !== needed);
    assert.equal(canMulticlassInto(member(klass.id, scores(...others)), target).ok, false, `leaving ${klass.id}`);
    assert.equal(canMulticlassInto(member(klass.id, scores(...ABILITIES)), target).ok, true, `leaving ${klass.id}`);
  }
});

await test("every counter is within its bounds, and is sized by a feature the sheet has", () => {
  for (const klass of CUSTOM_CLASSES) {
    for (const level of [1, 3, 5, 10, 15, 20]) {
      const sheet = sheetOf(klass.id, level);
      for (const [id, counter] of Object.entries(sheet.resources)) {
        const tag = `${klass.id} ${level} ${id}`;
        assert.ok(resourceDef(id), `${tag} has no definition`);
        assert.ok(Number.isInteger(counter.max) && counter.max >= 1, `${tag} max ${counter.max}`);
        assert.equal(counter.used, 0, tag);
      }
    }
  }
});

await test("a setting class's counter is spent by use_resource and returns at its own rest", async () => {
  const table = await openWorld();
  const hero = table.addHero({ class: "street_samurai", level: 20, subclass: "Chrome Dervish", maxHp: 120 });
  const held = () => table.sheet(hero.id).resources;
  assert.deepEqual(held().cyberpunk_adrenal_override, { max: 2, used: 0 });
  assert.deepEqual(held().cyberpunk_bullet_time, { max: 3, used: 0 });
  const spend = (resource) => table.invoke("use_resource", { characterId: hero.id, resource, reason: "a fight" });

  for (let use = 1; use <= 2; use += 1) {
    assert.equal((await spend("Adrenal Override")).ok, true);
    assert.equal(held().cyberpunk_adrenal_override.used, use);
  }
  const empty = await spend("Adrenal Override");
  assert.equal(empty.ok, false, "a third use of two");
  assert.deepEqual(held().cyberpunk_adrenal_override, { max: 2, used: 2 });
  assert.equal((await spend("Bullet Time")).ok, true);

  // Adrenal Override is "1/short rest"; Bullet Time is "3/long rest".
  assert.equal((await table.invoke("take_rest", { kind: "short" })).ok, true);
  assert.equal(held().cyberpunk_adrenal_override.used, 0);
  assert.equal(held().cyberpunk_bullet_time.used, 1);
  assert.equal((await table.invoke("take_rest", { kind: "long" })).ok, true);
  assert.equal(held().cyberpunk_bullet_time.used, 0);
});

await test("A limited-use counter belongs to a feature the character has, and one feature has one counter.", () => {
  const wrong = [];
  for (const klass of CUSTOM_CLASSES) {
    const sheet = sheetOf(klass.id, 20);
    const features = sheet.features.map((feature) => feature.name.toLowerCase().replace(/ \(\d+ uses?\)$/, ""));
    const seen = new Set();
    for (const id of Object.keys(sheet.resources)) {
      const name = resourceDef(id).displayName.toLowerCase();
      if (!features.includes(name)) {
        wrong.push(`${klass.id} holds ${id}, and has no feature called ${name}`);
      }
      if (seen.has(name)) {
        wrong.push(`${klass.id} holds two counters for ${name}`);
      }
      seen.add(name);
    }
  }
  assert.deepEqual(wrong, [], wrong.join("; "));
});

await test("A feature that says it has two uses has two: a road warrior's Hardened (2 uses) at 10th level, a ratcatcher's Rat Tide (2 uses).", () => {
  const wrong = [];
  for (const klass of CUSTOM_CLASSES) {
    const sheet = sheetOf(klass.id, 20);
    for (const feature of sheet.features) {
      const upgrade = /^(.*) \((\d+) uses\)$/.exec(feature.name);
      if (!upgrade) {
        continue;
      }
      const counter = Object.entries(sheet.resources).find(
        ([id]) => resourceDef(id).displayName.toLowerCase() === upgrade[1].toLowerCase(),
      );
      if (!counter || counter[1].max !== Number(upgrade[2])) {
        wrong.push(`${klass.id}: ${feature.name} leaves ${counter ? counter[1].max : "no counter"}`);
      }
    }
  }
  assert.deepEqual(wrong, [], wrong.join("; "));
});

world.close();
finish();
