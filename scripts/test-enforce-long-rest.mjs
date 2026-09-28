// The long rest, through take_rest (src/lib/dm/rest-tools.ts handleTakeRest,
// src/lib/dm/rest-logic.ts longRestPatch), read back from the database.
//
// SRD 5.1: a long rest is at least 8 hours. At its end a character regains
// all lost hit points and spent Hit Dice up to half their total number
// (minimum of one). Every expended spell slot and every limited feature comes
// back, temporary hit points are gone, and one level of exhaustion is
// removed. A character cannot benefit from more than one long rest in 24
// hours, and must have at least 1 hit point at the start of the rest to gain
// its benefits.
//
// The slot half of this (every slot back, slots made by Font of Magic taken
// away) is held by test-enforce-spell-slots.mjs and
// test-enforce-font-of-magic.mjs, and the rest lengths by
// test-enforce-short-rest.mjs.
//
// ODM's rules, pinned as such: a night's rest restores a bound creature to
// full, a downed one included (src/lib/dm/rest-logic.ts); returning hit dice
// go to the biggest die first on a multiclass sheet; every sheet at the table
// rests, companions included.
import assert from "node:assert/strict";
import {
  aDayLater,
  assertInBounds,
  casting,
  clockOf,
  openTable,
  setUsed,
  stored,
} from "./lib/enforce-resources.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-long-rest");
const home = await openTable();
const { markSheetAsCompanion } = await import("../src/lib/db/sheets.ts");

const longRest = (table) => table.invoke("take_rest", { kind: "long" });
const DYING = { successes: 1, failures: 2, stable: false, dead: false };
const STABLE = { successes: 0, failures: 0, stable: true, dead: false };
const DEAD = { successes: 0, failures: 3, stable: false, dead: true };

await test("hit points return in full, temporary hit points go, and the dice come back by halves", async () => {
  // [level, spent before, spent after]: half the TOTAL rounded down, at
  // least one, and never below zero spent.
  const CASES = [
    [1, 1, 0], [2, 2, 1], [3, 3, 2], [5, 5, 3], [5, 1, 0], [5, 0, 0],
    [9, 9, 5], [20, 20, 10], [20, 3, 0],
  ];
  const table = await openTable();
  const seated = CASES.map(([level, spent]) => {
    const sheet = table.addHero({
      class: "fighter",
      level,
      maxHp: 10 * level,
      hitDice: { die: "d10", total: level, spent: 0 },
    });
    table.patch(sheet.id, { currentHp: 1, tempHp: 9, hitDice: { die: "d10", total: level, spent } });
    return sheet.id;
  });
  const rest = await longRest(table);
  assert.equal(rest.ok, true, rest.error);
  CASES.forEach(([level, spent, after], index) => {
    const sheet = assertInBounds(table, seated[index]);
    assert.equal(sheet.currentHp, 10 * level, `level ${level}`);
    assert.equal(sheet.tempHp, 0, `level ${level}`);
    assert.deepEqual(sheet.hitDice, { die: "d10", total: level, spent: after }, `level ${level}, ${spent} spent`);
  });
});

await test("every limited feature comes back, the long ones and the short ones", async () => {
  const table = await openTable();
  const ROSTER = [
    ["barbarian", 5, { rage: 3 }],
    ["bard", 5, { bardic_inspiration: 1 }],
    ["cleric", 6, { channel_divinity: 2 }],
    ["druid", 4, { wild_shape: 2 }],
    ["fighter", 17, { second_wind: 1, action_surge: 2 }],
    ["monk", 5, { ki: 5 }],
    ["paladin", 5, { lay_on_hands: 25, divine_sense: 1, channel_divinity: 1 }],
    ["sorcerer", 5, { sorcery_points: 5 }],
    ["wizard", 5, { arcane_recovery: 1 }],
  ];
  const seated = ROSTER.map(([classId, level, spent]) => {
    const sheet = table.addHero({ class: classId, level });
    setUsed(table, sheet.id, spent);
    return [sheet.id, sheet.resources];
  });
  const dragonborn = table.addHero({ class: "rogue", race: "dragonborn", level: 3 });
  const orc = table.addHero({ class: "rogue", race: "half-orc", level: 3 });
  setUsed(table, dragonborn.id, { breath_weapon: 1 });
  setUsed(table, orc.id, { relentless_endurance: 1 });
  seated.push([dragonborn.id, dragonborn.resources], [orc.id, orc.resources]);
  await longRest(table);
  for (const [id, fresh] of seated) {
    // The counters as the sheet was made: same maxima, nothing used.
    assert.deepEqual(table.sheet(id).resources, fresh);
  }
});

await test("one level of exhaustion goes, and only one", async () => {
  const table = await openTable();
  const levels = [0, 1, 2, 3, 5];
  const seated = levels.map((exhaustion) => {
    const sheet = table.addHero({ class: "fighter", level: 3 });
    table.patch(sheet.id, { exhaustion });
    return sheet.id;
  });
  await longRest(table);
  levels.forEach((before, index) => {
    assert.equal(table.sheet(seated[index]).exhaustion, Math.max(0, before - 1), `from ${before}`);
  });
  await aDayLater(table);
  await longRest(table);
  levels.forEach((before, index) => {
    assert.equal(table.sheet(seated[index]).exhaustion, Math.max(0, before - 2), `from ${before}, twice`);
  });
});

await test("spells chosen for preparation become prepared, and concentration ends", async () => {
  const table = await openTable();
  const wizard = table.addHero({
    class: "wizard",
    level: 5,
    abilities: { int: 16 },
    spellcasting: casting("int", { 1: [4, 2], 2: [3, 3], 3: [2, 1] }, {
      prepared: ["Shield"],
      pending: ["Fireball", "Misty Step"],
      spellbook: ["Shield", "Fireball", "Misty Step"],
    }),
  });
  table.patch(wizard.id, { concentratingOn: "Fly" });
  await longRest(table);
  const sheet = assertInBounds(table, wizard.id);
  assert.deepEqual([...sheet.spellcasting.prepared].sort(), ["Fireball", "Misty Step", "Shield"]);
  assert.ok(!sheet.spellcasting.pending?.length);
  assert.equal(sheet.concentratingOn, null);
  assert.deepEqual(sheet.spellcasting.slots, {
    1: { max: 4, used: 0 },
    2: { max: 3, used: 0 },
    3: { max: 2, used: 0 },
  });
});

await test("nobody sleeps through the night still raging or still shaped", async () => {
  const table = await openTable();
  const barbarian = table.addHero({ class: "barbarian", level: 3 });
  const druid = table.addHero({ class: "druid", level: 4, maxHp: 30 });
  await table.invoke("use_resource", { characterId: barbarian.id, resource: "Rage" });
  await table.invoke("use_resource", { characterId: druid.id, resource: "Wild Shape", form: "wolf" });
  assert.deepEqual(table.sheet(barbarian.id).conditions, ["raging"]);
  assert.equal(table.sheet(druid.id).wildShape.form, "Wolf");
  await longRest(table);
  assert.deepEqual(table.sheet(barbarian.id).conditions, []);
  assert.deepEqual(table.sheet(barbarian.id).conditionMeta, {});
  assert.equal(table.sheet(druid.id).wildShape, null);
  assert.deepEqual(table.sheet(druid.id).resources.wild_shape, { max: 2, used: 0 });
});

await test("timed conditions run down by the eight hours", async () => {
  const table = await openTable();
  const fighter = table.addHero({ class: "fighter", level: 3 });
  await table.invoke("set_condition", { characterId: fighter.id, condition: "poisoned", hours: 1 });
  await table.invoke("set_condition", { characterId: fighter.id, condition: "frightened", hours: 12 });
  await longRest(table);
  const sheet = table.sheet(fighter.id);
  assert.deepEqual(sheet.conditions, ["frightened"]);
  assert.deepEqual(sheet.conditionMeta, { frightened: { rounds: 4 * 60 * 10 } });
});

await test("the dead gain nothing from a night's rest", async () => {
  const table = await openTable();
  // Somebody living, so there is a rest to take.
  table.addHero({ class: "fighter", level: 3 });
  const dead = table.addHero({
    class: "wizard",
    level: 3,
    hitDice: { die: "d6", total: 3, spent: 0 },
    spellcasting: casting("int", { 1: [4, 4], 2: [2, 2] }),
  });
  table.patch(dead.id, {
    currentHp: 0,
    deathSaves: DEAD,
    exhaustion: 2,
    hitDice: { die: "d6", total: 3, spent: 3 },
  });
  setUsed(table, dead.id, { arcane_recovery: 1 });
  const before = stored(table, dead.id);
  const rest = await longRest(table);
  assert.equal(rest.ok, true, rest.error);
  assert.deepEqual(stored(table, dead.id), before);
});

await test("ODM's rule: every sheet rests, and a bound creature is restored with its owner", async () => {
  const table = await openTable();
  const ranger = table.addHero({ class: "ranger", level: 5, maxHp: 40 });
  const companion = table.addHero({ class: "monk", level: 4, maxHp: 30 });
  markSheetAsCompanion(companion.id, "party", "steady");
  const pet = (name, hp) => ({
    name, kind: "other", form: "Wolf", hp, maxHp: 11, ac: 13, speed: 40, attacks: [], notes: "",
  });
  table.patch(ranger.id, { currentHp: 4, pets: [pet("Ash", 3), pet("Cinder", 0)] });
  table.patch(companion.id, { currentHp: 2 });
  setUsed(table, companion.id, { ki: 4 });
  await longRest(table);
  assert.equal(table.sheet(ranger.id).currentHp, 40);
  assert.deepEqual(table.sheet(ranger.id).pets.map((entry) => [entry.name, entry.hp]), [["Ash", 11], ["Cinder", 11]]);
  assert.equal(table.sheet(companion.id).currentHp, 30);
  assert.equal(table.sheet(companion.id).resources.ki.used, 0);
});

await test("a multiclass sheet gets its dice back biggest first, and the summed counter agrees", async () => {
  const table = await openTable();
  const mixed = table.addHero({
    class: "barbarian",
    level: 5,
    classes: [
      { id: "barbarian", subclass: "", level: 3 },
      { id: "rogue", subclass: "", level: 2 },
    ],
    hitDice: { die: "d12", total: 5, spent: 5 },
    hitDicePools: [
      { classId: "barbarian", die: "d12", total: 3, spent: 3 },
      { classId: "rogue", die: "d8", total: 2, spent: 2 },
    ],
  });
  await longRest(table);
  const sheet = assertInBounds(table, mixed.id);
  // Half of five rounded down is two, both d12s.
  assert.deepEqual(sheet.hitDicePools.map((pool) => [pool.die, pool.spent]), [["d12", 1], ["d8", 2]]);
  assert.deepEqual(sheet.hitDice, { die: "d12", total: 5, spent: 3 });
});

// ---- findings ----

await test("A character must have at least 1 hit point at the start of a long rest to gain its benefits.", async () => {
  const table = await openTable();
  const dying = table.addHero({ class: "fighter", level: 3, maxHp: 30 });
  const stable = table.addHero({ class: "fighter", level: 3, maxHp: 30 });
  table.patch(dying.id, { currentHp: 0, deathSaves: DYING });
  table.patch(stable.id, { currentHp: 0, deathSaves: STABLE });
  setUsed(table, dying.id, { second_wind: 1 });
  setUsed(table, stable.id, { second_wind: 1 });
  await longRest(table);
  for (const id of [dying.id, stable.id]) {
    assert.ok(table.sheet(id).currentHp < 30, "full hit points from 0");
    assert.equal(table.sheet(id).resources.second_wind.used, 1);
  }
});

await test("A character cannot benefit from more than one long rest in a 24-hour period.", async () => {
  const table = await openTable();
  const fighter = table.addHero({
    class: "fighter",
    level: 5,
    maxHp: 44,
    hitDice: { die: "d10", total: 5, spent: 0 },
  });
  await longRest(table);
  // Straight into trouble and straight back to bed, eight hours after the
  // last rest ended.
  table.patch(fighter.id, { currentHp: 3, hitDice: { die: "d10", total: 5, spent: 5 } });
  setUsed(table, fighter.id, { second_wind: 1, action_surge: 1 });
  await longRest(table);
  const sheet = table.sheet(fighter.id);
  assert.equal(sheet.currentHp, 3);
  assert.equal(sheet.hitDice.spent, 5);
  assert.equal(sheet.resources.action_surge.used, 1);
});

await test("Concentration lasts no longer than the spell: when a spell's duration ends, the caster is no longer concentrating on it.", async () => {
  const table = await openTable();
  const cleric = table.addHero({
    class: "cleric",
    level: 3,
    abilities: { wis: 16 },
    spellcasting: casting("wis", { 1: [4, 0], 2: [2, 0] }, { prepared: ["Bless"] }),
  });
  const friend = table.addHero({ class: "fighter", level: 3 });
  const bless = await table.invoke("cast_buff", {
    characterId: cleric.id,
    spell: "Bless",
    targetCharacterIds: [friend.id],
  });
  assert.equal(bless.ok, true, bless.error);
  assert.equal(table.sheet(cleric.id).concentratingOn, "Bless");
  await table.invoke("take_rest", { kind: "short" });
  assert.deepEqual(table.sheet(friend.id).conditions, [], "the blessing itself has run out");
  assert.equal(table.sheet(cleric.id).concentratingOn, null);
});

await test("the day is measured from the end of one long rest to the end of the next", async () => {
  const table = await openTable();
  const fighter = table.addHero({ class: "fighter", level: 5, maxHp: 44 });
  assert.equal((await longRest(table)).ok, true);
  const ended = clockOf(table);
  assert.equal(table.campaign().clock.longRests[fighter.id], ended);
  // Sixteen hours awake less a minute: the next rest would end a minute short of the day.
  await table.invoke("pass_time", { amount: 16 * 60 - 1, unit: "minutes" });
  table.patch(fighter.id, { currentHp: 3 });
  // The rest itself happens: its eight hours pass, and it gives nothing.
  const early = await longRest(table);
  assert.equal(early.ok, true, early.error);
  assert.deepEqual(early.result.rested, []);
  assert.match(early.result.unaffected, /less than 24 hours ago/);
  assert.equal(clockOf(table), ended + 16 * 60 - 1 + 8 * 60, "the rest took its hours");
  assert.equal(table.sheet(fighter.id).currentHp, 3);
  assert.equal(table.campaign().clock.longRests[fighter.id], ended, "a rest without benefit starts no new day");

  // The boundary itself: a rest ending exactly a day after the last one
  // benefits.
  const second = await openTable();
  const other = second.addHero({ class: "fighter", level: 5, maxHp: 44 });
  assert.equal((await longRest(second)).ok, true);
  const last = clockOf(second);
  await second.invoke("pass_time", { amount: 16 * 60, unit: "minutes" });
  second.patch(other.id, { currentHp: 3 });
  const night = await longRest(second);
  assert.equal(night.ok, true, night.error);
  assert.equal(second.sheet(other.id).currentHp, 44);
  assert.equal(second.campaign().clock.longRests[other.id], last + 24 * 60);
});

await test("the rest goes ahead for those who can take it, and the others are named", async () => {
  const table = await openTable();
  const rested = table.addHero({ class: "fighter", level: 3, maxHp: 30 });
  const stable = table.addHero({ class: "fighter", level: 3, maxHp: 30 });
  const dying = table.addHero({ class: "fighter", level: 3, maxHp: 30 });
  table.patch(rested.id, { currentHp: 5 });
  table.patch(stable.id, { currentHp: 0, deathSaves: STABLE, conditions: ["unconscious", "prone"] });
  table.patch(dying.id, { currentHp: 0, deathSaves: DYING, conditions: ["unconscious", "prone"] });
  setUsed(table, stable.id, { second_wind: 1 });
  const out = await longRest(table);
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(out.result.rested, [table.sheet(rested.id).name]);
  assert.equal(table.sheet(rested.id).currentHp, 30);
  // Eight hours are more than the four a stable creature waits at most: it
  // wakes with its 1 hit point and nothing else of the rest.
  const woken = table.sheet(stable.id);
  assert.equal(woken.currentHp, 1);
  assert.equal(woken.deathSaves, null);
  assert.deepEqual(woken.conditions, ["prone"]);
  assert.equal(woken.resources.second_wind.used, 1);
  assert.equal(table.campaign().clock.longRests[stable.id], undefined);
  // The dying are not helped by time.
  assert.equal(table.sheet(dying.id).currentHp, 0);
  assert.deepEqual(table.sheet(dying.id).deathSaves, DYING);
});

await test("a long rest nobody can gain from still happens: the hours pass, a stable creature wakes, and nobody is restored", async () => {
  const table = await openTable();
  const stable = table.addHero({ class: "fighter", level: 3, maxHp: 30 });
  const fallen = table.addHero({ class: "fighter", level: 3, maxHp: 30 });
  table.patch(stable.id, { currentHp: 0, deathSaves: STABLE, conditions: ["unconscious", "prone"] });
  table.patch(fallen.id, { currentHp: 0, deathSaves: DEAD, conditions: [] });
  setUsed(table, stable.id, { second_wind: 1 });
  const before = clockOf(table);
  const out = await longRest(table);
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(out.result.rested, []);
  assert.match(out.result.unaffected, /at 0 hit points/);
  assert.match(out.result.unaffected, /\(dead\)/);
  assert.equal(clockOf(table), before + 8 * 60, "the night passed");
  // The stable creature wakes with 1 hit point within its 1d4 hours, and
  // gains nothing else from a rest it began at 0.
  const woken = table.sheet(stable.id);
  assert.equal(woken.currentHp, 1);
  assert.equal(woken.deathSaves, null);
  assert.equal(woken.resources.second_wind.used, 1);
  assert.equal(table.campaign().clock.longRests?.[stable.id], undefined);
  assert.equal(table.sheet(fallen.id).currentHp, 0);
});

await test("a character who wakes at exhaustion level 4 wakes at the halved maximum", async () => {
  const table = await openTable();
  const worn = table.addHero({ class: "fighter", level: 3, maxHp: 30 });
  const mending = table.addHero({ class: "fighter", level: 3, maxHp: 30 });
  table.patch(worn.id, { exhaustion: 5, currentHp: 2 });
  table.patch(mending.id, { exhaustion: 4, currentHp: 2 });
  await longRest(table);
  assert.equal(table.sheet(worn.id).exhaustion, 4);
  assert.equal(table.sheet(worn.id).currentHp, 15);
  assert.equal(table.sheet(mending.id).exhaustion, 3);
  assert.equal(table.sheet(mending.id).currentHp, 30);
});

await test("under the heroic variant the hour-long rest still comes once a day", async () => {
  const table = await openTable({ gameSettings: { variantRules: { restVariant: "heroic" } } });
  const fighter = table.addHero({ class: "fighter", level: 5, maxHp: 44 });
  assert.equal((await longRest(table)).ok, true);
  table.patch(fighter.id, { currentHp: 3 });
  const again = await longRest(table);
  assert.deepEqual([again.ok, again.result?.rested], [true, []], "a second rest within the day gave its benefits");
  assert.equal(table.sheet(fighter.id).currentHp, 3);
  await table.invoke("pass_time", { amount: 22, unit: "hours" });
  assert.equal((await longRest(table)).ok, true);
  assert.equal(table.sheet(fighter.id).currentHp, 44);
});

home.close();
finish();
