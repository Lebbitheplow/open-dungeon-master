// Font of Magic: sorcery points into spell slots and back, through
// use_resource with a variant (src/lib/dm/resource-tools.ts parseFontOfMagic,
// computeFontOfMagic), and the long rest that takes created slots away
// (src/lib/dm/rest-logic.ts longRestPatch).
//
// SRD 5.1: a sorcerer has sorcery points equal to their level from 2nd
// level, back at a long rest, and never more than that number. Creating a
// spell slot costs 2 points for a 1st level slot, 3 for 2nd, 5 for 3rd, 6
// for 4th and 7 for 5th; no slot above 5th can be created; a created slot
// vanishes at the end of a long rest. Expending a slot gives points equal to
// the slot's level.
//
// ODM's rules, pinned as such: creating a slot of a level that has a spent
// slot hands the spent one back instead of adding a slot (the same number of
// castings either way); breaking a slot with less room than its level gives
// only the points that fit, and with no room at all is refused.
import assert from "node:assert/strict";
import { assertInBounds, casting, openTable, refusedUnchanged, setUsed } from "./lib/enforce-resources.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-font-of-magic");
const world = await openTable();

// SRD 5.1, Creating Spell Slots.
const COST = { 1: 2, 2: 3, 3: 5, 4: 6, 5: 7 };
const ORDINAL = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th", 6: "6th", 7: "7th", 8: "8th", 9: "9th" };
// A sorcerer 20's own slots.
const SLOTS_20 = { 1: [4, 0], 2: [3, 0], 3: [3, 0], 4: [3, 0], 5: [3, 0], 6: [2, 0], 7: [2, 0], 8: [1, 0], 9: [1, 0] };

const sorcerer = (level, slots, extra = {}) =>
  world.addHero({ class: "sorcerer", level, abilities: { cha: 16 }, spellcasting: casting("cha", slots), ...extra });
const create = (id, level) =>
  world.invoke("use_resource", {
    characterId: id,
    resource: "Sorcery Points",
    variant: `create a ${ORDINAL[level]}-level slot`,
  });
const convert = (id, level) =>
  world.invoke("use_resource", {
    characterId: id,
    resource: "Sorcery Points",
    variant: `convert my ${ORDINAL[level]}-level slot into sorcery points`,
  });
const points = (id) => world.sheet(id).resources.sorcery_points;
const slot = (id, level) => world.sheet(id).spellcasting.slots[String(level)];

await test("a created slot costs 2, 3, 5, 6 and 7 points for levels 1 to 5", async () => {
  for (const [level, cost] of Object.entries(COST)) {
    const hero = sorcerer(20, SLOTS_20);
    const outcome = await create(hero.id, Number(level));
    assert.equal(outcome.ok, true, outcome.error);
    assert.deepEqual(points(hero.id), { max: 20, used: cost }, `level ${level}`);
    assert.deepEqual(slot(hero.id, level), { max: SLOTS_20[level][0] + 1, used: 0 }, `level ${level}`);
    // Every other slot is as it was.
    for (const other of Object.keys(SLOTS_20).filter((key) => key !== level)) {
      assert.deepEqual(slot(hero.id, other), { max: SLOTS_20[other][0], used: 0 });
    }
    assertInBounds(world, hero.id);
  }
});

await test("no slot above 5th level can be created, whatever the points", async () => {
  const hero = sorcerer(20, SLOTS_20);
  for (const level of [6, 7, 8, 9]) {
    await refusedUnchanged(world, hero.id, () => create(hero.id, level), `level ${level}`);
  }
});

await test("a slot costs what it costs: one point short is refused, the exact price is not", async () => {
  for (const [level, cost] of Object.entries(COST)) {
    const hero = sorcerer(20, SLOTS_20);
    setUsed(world, hero.id, { sorcery_points: 20 - (cost - 1) });
    await refusedUnchanged(world, hero.id, () => create(hero.id, Number(level)), `level ${level}, short`);
    setUsed(world, hero.id, { sorcery_points: 20 - cost });
    const outcome = await create(hero.id, Number(level));
    assert.equal(outcome.ok, true, outcome.error);
    assert.deepEqual(points(hero.id), { max: 20, used: 20 });
    await refusedUnchanged(world, hero.id, () => create(hero.id, 1), "with no points");
  }
});

await test("a sorcerer's points are their level from 2nd level, and a 1st level sorcerer converts nothing", async () => {
  const first = sorcerer(1, { 1: [2, 0] });
  assert.equal(first.resources.sorcery_points, undefined);
  await refusedUnchanged(world, first.id, () => create(first.id, 1));
  await refusedUnchanged(world, first.id, () => convert(first.id, 1));
  // Two points at 2nd level buy exactly one 1st level slot.
  const second = sorcerer(2, { 1: [3, 0] });
  assert.deepEqual(second.resources.sorcery_points, { max: 2, used: 0 });
  assert.equal((await create(second.id, 1)).ok, true);
  await refusedUnchanged(world, second.id, () => create(second.id, 1));
  assert.deepEqual(slot(second.id, 1), { max: 4, used: 0 });
});

await test("only a sorcerer has a Font of Magic", async () => {
  const wizard = world.addHero({ class: "wizard", level: 5, spellcasting: casting("int", { 1: [4, 0], 2: [3, 0] }) });
  for (const resource of ["Sorcery Points", "Font of Magic"]) {
    await refusedUnchanged(world, wizard.id, () =>
      world.invoke("use_resource", { characterId: wizard.id, resource, variant: "create a 1st-level slot" }),
    );
  }
});

await test("a slot broken down gives points equal to its level and is spent", async () => {
  for (const level of [1, 2, 3, 4, 5, 6, 9]) {
    const hero = sorcerer(20, SLOTS_20);
    setUsed(world, hero.id, { sorcery_points: 15 });
    const outcome = await convert(hero.id, level);
    assert.equal(outcome.ok, true, outcome.error);
    assert.deepEqual(points(hero.id), { max: 20, used: 15 - level }, `level ${level}`);
    assert.deepEqual(slot(hero.id, level), { max: SLOTS_20[level][0], used: 1 }, `level ${level}`);
  }
});

await test("a slot that is already spent, or that the sorcerer never had, gives nothing", async () => {
  const hero = sorcerer(5, { 1: [4, 4], 2: [3, 0], 3: [2, 2] });
  setUsed(world, hero.id, { sorcery_points: 5 });
  await refusedUnchanged(world, hero.id, () => convert(hero.id, 1), "spent 1st");
  await refusedUnchanged(world, hero.id, () => convert(hero.id, 3), "spent 3rd");
  await refusedUnchanged(world, hero.id, () => convert(hero.id, 4), "no 4th");
  assert.equal((await convert(hero.id, 2)).ok, true);
  assert.deepEqual(points(hero.id), { max: 5, used: 3 });
});

await test("points never pass the sorcerer's level, however many slots are broken", async () => {
  const hero = sorcerer(7, { 1: [4, 0], 2: [3, 0], 3: [3, 0], 4: [1, 0] });
  // Full: a slot would be wasted, so it is refused and kept.
  await refusedUnchanged(world, hero.id, () => convert(hero.id, 4), "at full points");
  // One point of room: ODM gives the one point that fits.
  setUsed(world, hero.id, { sorcery_points: 1 });
  assert.equal((await convert(hero.id, 3)).ok, true);
  assert.deepEqual(points(hero.id), { max: 7, used: 0 });
  assert.deepEqual(slot(hero.id, 3), { max: 3, used: 1 });
  for (const level of [1, 2, 3, 4, 1, 2, 3]) {
    await convert(hero.id, level);
    assertInBounds(world, hero.id, `breaking a level ${level} slot`);
    assert.ok(points(hero.id).used >= 0);
  }
});

await test("ODM's rule: with a spent slot of that level, creating one hands the spent slot back", async () => {
  const hero = sorcerer(7, { 1: [4, 4], 2: [3, 0], 3: [3, 0], 4: [1, 0] });
  assert.equal((await create(hero.id, 1)).ok, true);
  assert.deepEqual(slot(hero.id, 1), { max: 4, used: 3 });
  assert.deepEqual(points(hero.id), { max: 7, used: 2 });
});

await test("Metamagic spends points without touching a slot", async () => {
  const hero = sorcerer(5, { 1: [4, 1], 2: [3, 0], 3: [2, 0] });
  const before = world.sheet(hero.id).spellcasting;
  const outcome = await world.invoke("use_resource", {
    characterId: hero.id,
    resource: "Sorcery Points",
    amount: 3,
    variant: "quickened spell",
  });
  assert.equal(outcome.ok, true, outcome.error);
  assert.deepEqual(points(hero.id), { max: 5, used: 3 });
  assert.deepEqual(world.sheet(hero.id).spellcasting, before);
  await refusedUnchanged(world, hero.id, () =>
    world.invoke("use_resource", { characterId: hero.id, resource: "Sorcery Points", amount: 3 }),
  );
});

await test("created slots vanish at the end of a long rest, and the points come back", async () => {
  const table = await openTable();
  const hero = table.addHero({
    class: "sorcerer",
    level: 9,
    spellcasting: casting("cha", { 1: [4, 0], 2: [3, 0], 3: [3, 0], 4: [3, 0], 5: [1, 0] }),
  });
  const variant = (text) =>
    table.invoke("use_resource", { characterId: hero.id, resource: "Sorcery Points", variant: text });
  assert.equal((await variant("create a 1st-level slot")).ok, true);
  assert.equal((await variant("create a 2nd-level slot")).ok, true);
  assert.equal((await variant("convert my 5th-level slot into sorcery points")).ok, true);
  assert.equal((await variant("create a 3rd-level slot")).ok, true);
  assert.deepEqual(table.sheet(hero.id).resources.sorcery_points, { max: 9, used: 5 });
  assert.deepEqual(
    Object.values(table.sheet(hero.id).spellcasting.slots).map((entry) => [entry.max, entry.used]),
    [[5, 0], [4, 0], [4, 0], [3, 0], [1, 1]],
  );
  // A short rest gives back neither the points nor the slot.
  await table.invoke("take_rest", { kind: "short" });
  assert.deepEqual(table.sheet(hero.id).resources.sorcery_points, { max: 9, used: 5 });
  assert.deepEqual(table.sheet(hero.id).spellcasting.slots["5"], { max: 1, used: 1 });

  await table.invoke("take_rest", { kind: "long" });
  const sheet = assertInBounds(table, hero.id);
  assert.deepEqual(sheet.resources.sorcery_points, { max: 9, used: 0 });
  // The sorcerer 9 row of the class table: 4, 3, 3, 3, 1.
  assert.deepEqual(
    Object.values(sheet.spellcasting.slots).map((entry) => [entry.max, entry.used]),
    [[4, 0], [3, 0], [3, 0], [3, 0], [1, 0]],
  );
});

world.close();
finish();
