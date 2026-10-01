// The short rest, through take_rest (src/lib/dm/rest-tools.ts handleTakeRest),
// read back from the database and from the in-world clock.
//
// SRD 5.1: a short rest is at least 1 hour. A character can spend Hit Dice at
// its end, up to the number they have; for each die the player rolls it and
// adds the Constitution modifier, and the character regains that many hit
// points (minimum of 0), never past the maximum. Features that say "short or
// long rest" come back; features that say "long rest" do not. Song of Rest
// gives one extra die to each creature that spent a Hit Die. Arcane Recovery
// and Natural Recovery return slots worth half the class level rounded up,
// none of 6th level or higher, once a day. Nobody rests in a fight.
//
// Rest lengths by variant are ODM's own table (src/lib/dm/calendar.ts
// restMinutes) after the DMG: standard 1 hour and 8 hours, heroic ("epic
// heroism") 5 minutes and 1 hour, gritty realism 8 hours and 7 days.
//
// ODM's rules, pinned as such: the server picks which slots a recovery
// returns, lowest level first (the SRD lets the player choose); an explicit
// spend asking for more dice than are left is cut to what is left rather than
// refused; every sheet at the table rests, companions included.
import assert from "node:assert/strict";
import {
  assertInBounds,
  casting,
  clockOf,
  minutesTaken,
  openTable,
  rolled,
  setUsed,
  stored,
} from "./lib/enforce-resources.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-short-rest");
const home = await openTable();
const { markSheetAsCompanion } = await import("../src/lib/db/sheets.ts");

const shortRest = (table, spend) =>
  table.invoke("take_rest", { kind: "short", ...(spend ? { spend } : {}) });
const hero = (table, classId, level, die, extra = {}) =>
  table.addHero({
    class: classId,
    level,
    hitDice: { die, total: level, spent: 0 },
    ...extra,
  });

// ---- time ----

await test("a rest takes the time its variant says, to the minute, on the in-world clock", async () => {
  const LENGTHS = [
    ["standard", "short", 60],
    ["standard", "long", 8 * 60],
    ["heroic", "short", 5],
    ["heroic", "long", 60],
    ["gritty", "long", 7 * 24 * 60],
  ];
  for (const [restVariant, kind, expected] of LENGTHS) {
    const table = await openTable({ gameSettings: { variantRules: { restVariant } } });
    table.addHero({ class: "fighter", level: 1 });
    const { minutes, outcome } = await minutesTaken(table, () => table.invoke("take_rest", { kind }));
    assert.equal(outcome.ok, true, outcome.error);
    assert.equal(minutes, expected, `${restVariant} ${kind}`);
  }
  // No variant set is the standard rule.
  const plain = await openTable();
  plain.addHero({ class: "fighter", level: 1 });
  assert.equal((await minutesTaken(plain, () => shortRest(plain))).minutes, 60);
});

await test("nobody rests in a fight: no time passes and no sheet moves", async () => {
  const table = await openTable();
  const fighter = hero(table, "fighter", 5, "d10", { maxHp: 44 });
  table.patch(fighter.id, { currentHp: 5, hitDice: { die: "d10", total: 5, spent: 1 } });
  setUsed(table, fighter.id, { second_wind: 1, action_surge: 1 });
  await table.beginFight([{ monster: "goblin", count: 1 }]);
  const before = stored(table, fighter.id);
  for (const kind of ["short", "long"]) {
    const { minutes, outcome } = await minutesTaken(table, () => table.invoke("take_rest", { kind }));
    assert.equal(outcome.ok, false, kind);
    assert.equal(minutes, 0, kind);
    assert.deepEqual(stored(table, fighter.id), before, kind);
  }
});

await test("a rest that is neither short nor long is refused and takes no time", async () => {
  const table = await openTable();
  const fighter = hero(table, "fighter", 5, "d10");
  setUsed(table, fighter.id, { second_wind: 1 });
  const before = stored(table, fighter.id);
  for (const kind of ["nap", "", "medium", 8]) {
    const { minutes, outcome } = await minutesTaken(table, () => table.invoke("take_rest", { kind }));
    assert.equal(outcome.ok, false, String(kind));
    assert.equal(minutes, 0, String(kind));
  }
  assert.deepEqual(stored(table, fighter.id), before);
});

// ---- hit dice ----

await test("each hit die heals the die plus the Constitution modifier", async () => {
  const table = await openTable();
  const fighter = hero(table, "fighter", 5, "d10", { maxHp: 50, abilities: { con: 14 } });
  const wizard = hero(table, "wizard", 5, "d6", { maxHp: 30, abilities: { con: 12 } });
  table.patch(fighter.id, { currentHp: 5 });
  table.patch(wizard.id, { currentHp: 5 });
  table.diceLog();
  table.dice(6, 7, 3);
  const rest = await shortRest(table, [
    { characterId: fighter.id, dice: 2 },
    { characterId: wizard.id, dice: 1 },
  ]);
  assert.equal(rest.ok, true, rest.error);
  assert.deepEqual(rolled(table), [[10, 6], [10, 7], [6, 3]]);
  assert.equal(table.sheet(fighter.id).currentHp, 5 + 6 + 7 + 2 * 2);
  assert.deepEqual(table.sheet(fighter.id).hitDice, { die: "d10", total: 5, spent: 2 });
  assert.equal(table.sheet(wizard.id).currentHp, 5 + 3 + 1);
  assert.deepEqual(table.sheet(wizard.id).hitDice, { die: "d6", total: 5, spent: 1 });
});

await test("healing stops at the maximum and only the dice that are left can be spent", async () => {
  const table = await openTable();
  const fighter = hero(table, "fighter", 5, "d10", { maxHp: 44, abilities: { con: 14 } });
  table.patch(fighter.id, { currentHp: 40, hitDice: { die: "d10", total: 5, spent: 3 } });
  table.diceLog();
  table.dice(10, 10);
  // Twenty asked for, two left: ODM spends the two.
  const rest = await shortRest(table, [{ characterId: fighter.id, dice: 20 }]);
  assert.equal(rest.ok, true, rest.error);
  assert.deepEqual(rolled(table), [[10, 10], [10, 10]]);
  assert.equal(table.sheet(fighter.id).currentHp, 44);
  assert.deepEqual(table.sheet(fighter.id).hitDice, { die: "d10", total: 5, spent: 5 });

  // With none left the rest heals nothing and rolls nothing.
  table.patch(fighter.id, { currentHp: 10 });
  table.dice(10);
  await shortRest(table, [{ characterId: fighter.id, dice: 1 }]);
  assert.equal(table.clearDice(), 1);
  assert.deepEqual(table.diceLog(), []);
  assert.equal(table.sheet(fighter.id).currentHp, 10);
  assert.deepEqual(table.sheet(fighter.id).hitDice, { die: "d10", total: 5, spent: 5 });
  assertInBounds(table, fighter.id);
});

await test("a hit die with a negative Constitution modifier never takes hit points away", async () => {
  const table = await openTable();
  const wizard = hero(table, "wizard", 3, "d6", { maxHp: 12, abilities: { con: 6 } });
  table.patch(wizard.id, { currentHp: 4 });
  table.dice(1);
  // 1 on the die, -2 from Constitution: a minimum of 0.
  await shortRest(table, [{ characterId: wizard.id, dice: 1 }]);
  rolled(table);
  assert.equal(table.sheet(wizard.id).currentHp, 4);
  assert.deepEqual(table.sheet(wizard.id).hitDice, { die: "d6", total: 3, spent: 1 });
});

await test("a multiclass character spends the biggest dice first, from the pool each came from", async () => {
  const table = await openTable();
  const mixed = table.addHero({
    class: "barbarian",
    level: 5,
    maxHp: 60,
    abilities: { con: 14 },
    classes: [
      { id: "barbarian", subclass: "", level: 3 },
      { id: "rogue", subclass: "", level: 2 },
    ],
    hitDice: { die: "d12", total: 5, spent: 2 },
    hitDicePools: [
      { classId: "barbarian", die: "d12", total: 3, spent: 2 },
      { classId: "rogue", die: "d8", total: 2, spent: 0 },
    ],
  });
  table.patch(mixed.id, { currentHp: 5 });
  table.diceLog();
  table.dice(12, 8, 7);
  await shortRest(table, [{ characterId: mixed.id, dice: 3 }]);
  // One d12 is all the barbarian pool has left; the rest are the rogue's d8s.
  assert.deepEqual(rolled(table), [[12, 12], [8, 8], [8, 7]]);
  const sheet = assertInBounds(table, mixed.id);
  assert.equal(sheet.currentHp, 5 + 12 + 8 + 7 + 3 * 2);
  assert.equal(sheet.hitDice.spent, 5);
  assert.deepEqual(sheet.hitDicePools.map((pool) => [pool.die, pool.spent]), [["d12", 3], ["d8", 2]]);
});

await test("with no list given the server spends for whoever is below half, and for nobody else", async () => {
  const table = await openTable();
  const hurt = hero(table, "fighter", 4, "d10", { maxHp: 40 });
  const fine = hero(table, "fighter", 4, "d10", { maxHp: 40 });
  table.patch(hurt.id, { currentHp: 15 });
  table.patch(fine.id, { currentHp: 20 });
  table.diceLog();
  table.dice(5);
  await shortRest(table);
  // 5 short of half, 5.5 a die on average: one die.
  assert.deepEqual(rolled(table), [[10, 5]]);
  assert.equal(table.sheet(hurt.id).currentHp, 20);
  assert.equal(table.sheet(hurt.id).hitDice.spent, 1);
  assert.equal(table.sheet(fine.id).currentHp, 20);
  assert.equal(table.sheet(fine.id).hitDice.spent, 0);
});

// ---- what comes back ----

await test("short-rest features come back and long-rest features do not", async () => {
  const table = await openTable();
  const SHORT = [
    ["fighter", 5, { second_wind: 1, action_surge: 1 }],
    ["monk", 5, { ki: 5 }],
    ["cleric", 6, { channel_divinity: 2 }],
    ["druid", 4, { wild_shape: 2 }],
    // Font of Inspiration: from bard 5 Bardic Inspiration comes back on a
    // short rest too (SRD 5.1). This row used to pin ODM's old "long at
    // every level".
    ["bard", 5, { bardic_inspiration: 1 }],
  ];
  const LONG = [
    ["barbarian", 5, { rage: 3 }],
    ["paladin", 5, { lay_on_hands: 25, divine_sense: 1 }],
    ["sorcerer", 5, { sorcery_points: 5 }],
    // Before Font of Inspiration it waits for a long rest.
    ["bard", 4, { bardic_inspiration: 1 }],
  ];
  const seated = [...SHORT, ...LONG].map(([classId, level, spent]) => {
    const sheet = table.addHero({ class: classId, level });
    setUsed(table, sheet.id, spent);
    return [sheet.id, spent];
  });
  const dragonborn = table.addHero({ class: "rogue", race: "dragonborn", level: 3 });
  const orc = table.addHero({ class: "rogue", race: "half-orc", level: 3 });
  setUsed(table, dragonborn.id, { breath_weapon: 1 });
  setUsed(table, orc.id, { relentless_endurance: 1 });
  assert.equal((await shortRest(table)).ok, true);
  seated.forEach(([id, spent], index) => {
    for (const [name, value] of Object.entries(spent)) {
      const expected = index < SHORT.length ? 0 : value;
      assert.equal(table.sheet(id).resources[name].used, expected, name);
    }
    assertInBounds(table, id);
  });
  assert.equal(table.sheet(dragonborn.id).resources.breath_weapon.used, 0);
  assert.equal(table.sheet(orc.id).resources.relentless_endurance.used, 1);
});

await test("temporary hit points and ordinary spell slots are untouched by a short rest", async () => {
  const table = await openTable();
  const cleric = table.addHero({
    class: "cleric",
    level: 3,
    spellcasting: casting("wis", { 1: [4, 3], 2: [2, 2] }),
  });
  table.patch(cleric.id, { tempHp: 7 });
  await shortRest(table);
  const sheet = table.sheet(cleric.id);
  assert.equal(sheet.tempHp, 7);
  assert.deepEqual(sheet.spellcasting.slots, { 1: { max: 4, used: 3 }, 2: { max: 2, used: 2 } });
});

await test("Song of Rest gives one extra die to each creature that spent a hit die", async () => {
  const table = await openTable();
  const bard = hero(table, "bard", 2, "d8", { maxHp: 15 });
  const two = hero(table, "fighter", 3, "d10", { maxHp: 30 });
  const none = hero(table, "fighter", 3, "d10", { maxHp: 30 });
  table.patch(two.id, { currentHp: 5 });
  table.patch(none.id, { currentHp: 5 });
  table.diceLog();
  table.dice(4, 5, 6);
  await shortRest(table, [{ characterId: two.id, dice: 2 }]);
  // Two d10s and ONE d6, not one d6 per die spent.
  assert.deepEqual(rolled(table), [[10, 4], [10, 5], [6, 6]]);
  assert.equal(table.sheet(two.id).currentHp, 5 + 4 + 5 + 6);
  assert.equal(table.sheet(none.id).currentHp, 5);

  // A bard who is down sings for nobody.
  table.patch(bard.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: true, dead: false } });
  table.dice(4);
  await shortRest(table, [{ characterId: none.id, dice: 1 }]);
  assert.deepEqual(rolled(table), [[10, 4]]);
  assert.equal(table.sheet(none.id).currentHp, 9);
});

await test("Arcane Recovery returns half the wizard's level in slot levels, once a day, never a 6th", async () => {
  const table = await openTable();
  const low = table.addHero({ class: "wizard", level: 1, spellcasting: casting("int", { 1: [2, 2] }) });
  const mid = table.addHero({
    class: "wizard",
    level: 5,
    spellcasting: casting("int", { 1: [4, 4], 2: [3, 3], 3: [2, 2] }),
  });
  const high = table.addHero({
    class: "wizard",
    level: 13,
    spellcasting: casting("int", { 1: [4, 0], 2: [3, 0], 3: [3, 0], 4: [3, 0], 5: [2, 0], 6: [1, 1], 7: [1, 1] }),
  });
  await shortRest(table);
  const levelsBack = (before, id) =>
    Object.entries(table.sheet(id).spellcasting.slots).reduce(
      (sum, [level, slot]) => sum + Number(level) * (before.spellcasting.slots[level].used - slot.used),
      0,
    );
  // Half of 1 rounded up is 1; half of 5 rounded up is 3.
  assert.equal(levelsBack(low, low.id), 1);
  assert.equal(levelsBack(mid, mid.id), 3);
  assert.equal(table.sheet(low.id).resources.arcane_recovery.used, 1);
  assert.equal(table.sheet(mid.id).resources.arcane_recovery.used, 1);
  // Only 6th and 7th level slots are spent: nothing to return, and the use
  // is kept for a rest that can.
  assert.equal(levelsBack(high, high.id), 0);
  assert.equal(table.sheet(high.id).resources.arcane_recovery.used, 0);

  // Once a day: the second short rest returns nothing more.
  const afterFirst = table.sheet(mid.id);
  await shortRest(table);
  assert.deepEqual(table.sheet(mid.id).spellcasting.slots, afterFirst.spellcasting.slots);
  [low.id, mid.id, high.id].forEach((id) => assertInBounds(table, id));
});

await test("Natural Recovery does the same for a Circle of the Land druid", async () => {
  const table = await openTable();
  const druid = table.addHero({
    class: "druid",
    subclass: "Circle of the Land",
    level: 4,
    spellcasting: casting("wis", { 1: [4, 4], 2: [3, 3] }),
  });
  await shortRest(table);
  const slots = table.sheet(druid.id).spellcasting.slots;
  const back = (4 - slots["1"].used) + 2 * (3 - slots["2"].used);
  assert.equal(back, 2);
  assert.equal(table.sheet(druid.id).resources.natural_recovery.used, 1);
});

// ---- who rests ----

await test("a character at 0 hit points spends no hit dice, and the dead get nothing", async () => {
  const table = await openTable();
  const down = hero(table, "fighter", 3, "d10", { maxHp: 30 });
  const dead = hero(table, "fighter", 3, "d10", { maxHp: 30 });
  table.patch(down.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: true, dead: false } });
  table.patch(dead.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  setUsed(table, dead.id, { second_wind: 1 });
  table.diceLog();
  table.dice(10, 10);
  await shortRest(table, [
    { characterId: down.id, dice: 1 },
    { characterId: dead.id, dice: 1 },
  ]);
  assert.equal(table.clearDice(), 2);
  assert.deepEqual(table.diceLog(), []);
  for (const id of [down.id, dead.id]) {
    assert.equal(table.sheet(id).currentHp, 0);
    assert.equal(table.sheet(id).hitDice.spent, 0);
  }
  assert.equal(table.sheet(dead.id).resources.second_wind.used, 1);
  assert.equal(table.sheet(dead.id).deathSaves.dead, true);
});

await test("ODM's rule: every sheet at the table rests, companions included", async () => {
  const table = await openTable();
  const player = table.addHero({ class: "monk", level: 4 });
  const companion = table.addHero({ class: "monk", level: 4 });
  markSheetAsCompanion(companion.id, "party", "steady");
  setUsed(table, player.id, { ki: 4 });
  setUsed(table, companion.id, { ki: 4 });
  await shortRest(table);
  assert.equal(table.sheet(companion.id).isCompanion, true);
  assert.equal(table.sheet(player.id).resources.ki.used, 0);
  assert.equal(table.sheet(companion.id).resources.ki.used, 0);
});

await test("a timed condition runs down by the clock across the rest", async () => {
  const table = await openTable();
  const fighter = hero(table, "fighter", 3, "d10");
  await table.invoke("set_condition", { characterId: fighter.id, condition: "poisoned", minutes: 30 });
  await table.invoke("set_condition", { characterId: fighter.id, condition: "frightened", hours: 2 });
  assert.deepEqual(table.sheet(fighter.id).conditionMeta, {
    poisoned: { rounds: 300 },
    frightened: { rounds: 1200 },
  });
  const before = clockOf(table);
  await shortRest(table);
  assert.equal(clockOf(table) - before, 60);
  const sheet = table.sheet(fighter.id);
  assert.deepEqual(sheet.conditions, ["frightened"]);
  assert.deepEqual(sheet.conditionMeta, { frightened: { rounds: 600 } });
});

// ---- findings ----

await test("Under gritty realism a short rest is 8 hours and a long rest is 7 days (DMG; and ODM's own prompt line in src/lib/dm/rules-logic.ts REST_VARIANT_LINES says \\\"a short rest takes 8 hours (overnight)\\\").", async () => {
  const table = await openTable({ gameSettings: { variantRules: { restVariant: "gritty" } } });
  table.addHero({ class: "fighter", level: 1 });
  assert.equal((await minutesTaken(table, () => shortRest(table))).minutes, 8 * 60);
});

await test("Each hit die heals the die plus the Constitution modifier, with a minimum of 0 for that die.", async () => {
  const table = await openTable();
  const wizard = hero(table, "wizard", 3, "d6", { maxHp: 20, abilities: { con: 6 } });
  table.patch(wizard.id, { currentHp: 4 });
  table.dice(1, 6);
  await shortRest(table, [{ characterId: wizard.id, dice: 2 }]);
  table.clearDice();
  assert.equal(table.sheet(wizard.id).currentHp, 4 + 0 + 4);
});

await test("A rest asked for with a spend list that cannot be read is refused; nobody's hit dice are spent on a request that was not understood.", async () => {
  const table = await openTable();
  const fighter = hero(table, "fighter", 4, "d10", { maxHp: 40 });
  const wizard = hero(table, "wizard", 4, "d6", { maxHp: 20 });
  table.patch(wizard.id, { currentHp: 3 });
  const before = stored(table, wizard.id);
  for (const dice of [0, -1, 1.5]) {
    const { minutes, outcome } = await minutesTaken(table, () =>
      shortRest(table, [{ characterId: fighter.id, dice }]),
    );
    table.clearDice();
    assert.equal(outcome.ok, false, `dice ${dice}`);
    assert.equal(minutes, 0, `dice ${dice}`);
    assert.deepEqual(stored(table, wizard.id), before, `dice ${dice}`);
  }
});

await test("a short rest heals no higher than the halved maximum of exhaustion level 4", async () => {
  const table = await openTable();
  const fighter = hero(table, "fighter", 4, "d10", { maxHp: 40 });
  table.patch(fighter.id, { exhaustion: 4, currentHp: 15 });
  table.dice(10, 10);
  await shortRest(table, [{ characterId: fighter.id, dice: 2 }]);
  table.clearDice();
  assert.equal(table.sheet(fighter.id).currentHp, 20);
});

await test("a refused spend list names nobody's dice: the same rest with a good list runs", async () => {
  const table = await openTable();
  const fighter = hero(table, "fighter", 4, "d10", { maxHp: 40 });
  table.patch(fighter.id, { currentHp: 10 });
  for (const spend of [[{ characterId: fighter.id }], [{ dice: 1 }], "two dice", [{ characterId: fighter.id, dice: 21 }]]) {
    const { minutes, outcome } = await minutesTaken(table, () => table.invoke("take_rest", { kind: "short", spend }));
    assert.equal(outcome.ok, false, JSON.stringify(spend));
    assert.equal(minutes, 0, JSON.stringify(spend));
  }
  assert.equal(table.sheet(fighter.id).hitDice.spent, 0);
  table.dice(7);
  const good = await shortRest(table, [{ characterId: fighter.id, dice: 1 }]);
  table.clearDice();
  assert.equal(good.ok, true, good.error);
  assert.equal(table.sheet(fighter.id).currentHp, 17);
});

home.close();
finish();
