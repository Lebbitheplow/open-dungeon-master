// Wild Shape, through use_resource and apply_damage (src/lib/dm/
// resource-tools.ts computeUseResource, src/lib/dm/mutations.ts,
// src/lib/srd/beast-forms.ts). scripts/test-beast-forms.mjs holds the pure
// table; this file holds what the engine does with it, on stored sheets.
//
// SRD 5.1: from 2nd level a druid assumes a beast's shape twice between
// rests. The beast's challenge rating is 1/4 at most and it has no flying or
// swimming speed; from 4th level 1/2 and no flying speed; from 8th level 1.
// A Circle of the Moon druid takes CR 1 from 2nd level and druid level / 3
// (rounded down) from 6th, under the same movement limits. The druid takes
// the beast's hit points, Armor Class and physical scores and keeps their own
// mind; at 0 beast hit points they revert and the damage left over carries
// to their own hit points; they cannot cast spells in the form (until 18th
// level); the form lasts half the druid's level in hours.
//
// ODM's rule, pinned as such: asking for Wild Shape while shaped drops the
// form and spends nothing (the SRD's bonus action to revert).
import assert from "node:assert/strict";
import { casting, openTable, refusedUnchanged, setUsed } from "./lib/enforce-resources.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-wild-shape");
const world = await openTable();

// SRD 5.1 stat blocks: [name, challenge, hit points, armor class, flies, swims].
const BEASTS = [
  ["Wolf", 1 / 4, 11, 13, false, false],
  ["Panther", 1 / 4, 13, 12, false, false],
  ["Boar", 1 / 4, 11, 11, false, false],
  ["Elk", 1 / 4, 13, 10, false, false],
  ["Black Bear", 1 / 2, 19, 11, false, false],
  ["Ape", 1 / 2, 19, 12, false, false],
  ["Crocodile", 1 / 2, 19, 12, false, true],
  ["Dire Wolf", 1, 37, 14, false, false],
  ["Brown Bear", 1, 34, 11, false, false],
  ["Giant Spider", 1, 26, 14, false, false],
  ["Giant Eagle", 1, 26, 13, true, false],
  ["Giant Octopus", 1, 52, 11, false, true],
  ["Giant Constrictor Snake", 2, 60, 12, false, true],
  ["Mammoth", 6, 126, 13, false, false],
  ["Giant Ape", 7, 157, 12, false, false],
  ["Tyrannosaurus Rex", 8, 136, 13, false, false],
];

const shape = (id, form, extra = {}) =>
  world.invoke("use_resource", { characterId: id, resource: "Wild Shape", form, ...extra });
const revert = (id) => world.invoke("use_resource", { characterId: id, resource: "Wild Shape" });
const hurt = (id, amount) => world.invoke("apply_damage", { characterId: id, amount, reason: "test" });

function allowed(level, moon, [, challenge, , , flies, swims]) {
  const circle = level >= 6 ? Math.floor(level / 3) : 1;
  const plain = level >= 8 ? 1 : level >= 4 ? 1 / 2 : 1 / 4;
  const ceiling = moon ? Math.max(plain, circle) : plain;
  return challenge <= ceiling && (!flies || level >= 8) && (!swims || level >= 4);
}

async function walkForms(subclass, moon) {
  const problems = [];
  for (const level of [2, 3, 4, 5, 6, 7, 8, 9, 12, 18, 20]) {
    const druid = world.addHero({ class: "druid", subclass, level, maxHp: 20 });
    for (const beast of BEASTS) {
      setUsed(world, druid.id, { wild_shape: 0 });
      const outcome = await shape(druid.id, beast[0]);
      const sheet = world.sheet(druid.id);
      if (outcome.ok !== allowed(level, moon, beast)) {
        problems.push(`druid ${level} as ${beast[0]}: ${outcome.ok ? "allowed" : "refused"}`);
      } else if (outcome.ok) {
        const held = [sheet.wildShape?.form, sheet.wildShape?.beastHp, sheet.wildShape?.beastAc];
        if (JSON.stringify(held) !== JSON.stringify([beast[0], beast[2], beast[3]])) {
          problems.push(`druid ${level} as ${beast[0]}: holds ${JSON.stringify(held)}`);
        }
        // An Archdruid (druid 20) shapes without limit: nothing is counted.
        if (sheet.resources.wild_shape.used !== (level >= 20 ? 0 : 1)) {
          problems.push(`druid ${level} as ${beast[0]}: ${sheet.resources.wild_shape.used} uses spent`);
        }
      } else if (sheet.wildShape !== null || sheet.resources.wild_shape.used !== 0) {
        problems.push(`druid ${level} as ${beast[0]}: a refusal changed the sheet`);
      }
      if (sheet.wildShape) {
        await revert(druid.id);
      }
    }
  }
  return problems;
}

await test("every beast opens at its SRD druid level, with its SRD hit points and Armor Class", async () => {
  assert.deepEqual(await walkForms("Circle of the Land", false), []);
});

await test("a Circle of the Moon druid takes CR 1 at 2nd level and a third of their level from 6th", async () => {
  assert.deepEqual(await walkForms("Circle of the Moon", true), []);
});

await test("a 1st level druid has no Wild Shape, and neither does anyone else", async () => {
  for (const classId of ["druid", "ranger", "fighter"]) {
    const hero = world.addHero({ class: classId, level: 1 });
    await refusedUnchanged(world, hero.id, () => shape(hero.id, "Wolf"), classId);
  }
});

await test("the form swaps the body and keeps the mind, and the druid's own hit points wait", async () => {
  const druid = world.addHero({
    class: "druid",
    level: 8,
    maxHp: 50,
    abilities: { str: 8, dex: 12, con: 12, int: 13, wis: 18, cha: 11 },
  });
  world.patch(druid.id, { currentHp: 31 });
  const outcome = await shape(druid.id, "brown bear");
  assert.equal(outcome.ok, true, outcome.error);
  const sheet = world.sheet(druid.id);
  assert.equal(sheet.wildShape.kind, "wildshape");
  assert.deepEqual(
    [sheet.wildShape.beastHp, sheet.wildShape.beastMaxHp, sheet.wildShape.beastAc, sheet.wildShape.speed],
    [34, 34, 11, 40],
  );
  // Strength, Dexterity and Constitution are the bear's.
  assert.deepEqual(sheet.wildShape.abilities, { str: 19, dex: 10, con: 16 });
  // Intelligence, Wisdom and Charisma, hit points and maximum are the druid's.
  assert.deepEqual(sheet.abilities, druid.abilities);
  assert.equal(sheet.currentHp, 31);
  assert.equal(sheet.maxHp, 50);
  assert.deepEqual(sheet.resources.wild_shape, { max: 2, used: 1 });
});

await test("damage lands on the beast, and what is left over at 0 carries to the druid", async () => {
  const druid = world.addHero({ class: "druid", level: 2, maxHp: 17 });
  await shape(druid.id, "wolf");
  await hurt(druid.id, 5);
  assert.equal(world.sheet(druid.id).wildShape.beastHp, 6);
  assert.equal(world.sheet(druid.id).currentHp, 17);
  // Six to drop the wolf, three left over.
  await hurt(druid.id, 9);
  assert.equal(world.sheet(druid.id).wildShape, null);
  assert.equal(world.sheet(druid.id).currentHp, 14);

  // Exactly enough to drop the form carries nothing.
  await shape(druid.id, "wolf");
  await hurt(druid.id, 11);
  assert.equal(world.sheet(druid.id).wildShape, null);
  assert.equal(world.sheet(druid.id).currentHp, 14);
  assert.equal(world.sheet(druid.id).deathSaves, null);
  assert.deepEqual(world.sheet(druid.id).resources.wild_shape, { max: 2, used: 2 });
});

await test("temporary hit points go before the beast's, and a blow through both can fell the druid", async () => {
  const druid = world.addHero({ class: "druid", level: 2, maxHp: 17 });
  world.patch(druid.id, { currentHp: 4, tempHp: 3 });
  await shape(druid.id, "wolf");
  await hurt(druid.id, 5);
  assert.equal(world.sheet(druid.id).tempHp, 0);
  assert.equal(world.sheet(druid.id).wildShape.beastHp, 9);
  // Nine to the wolf, six through to a druid on four.
  await hurt(druid.id, 15);
  const sheet = world.sheet(druid.id);
  assert.equal(sheet.wildShape, null);
  assert.equal(sheet.currentHp, 0);
  assert.notEqual(sheet.deathSaves, null);
  assert.equal(sheet.deathSaves.dead, false);
});

await test("ODM's rule: asking again while shaped drops the form and spends nothing", async () => {
  const druid = world.addHero({ class: "druid", level: 4, maxHp: 30 });
  world.patch(druid.id, { currentHp: 22 });
  await shape(druid.id, "ape");
  await hurt(druid.id, 7);
  const back = await revert(druid.id);
  assert.equal(back.ok, true, back.error);
  const sheet = world.sheet(druid.id);
  assert.equal(sheet.wildShape, null);
  assert.equal(sheet.currentHp, 22);
  assert.deepEqual(sheet.resources.wild_shape, { max: 2, used: 1 });
});

await test("two shapes between rests, and a short rest brings both back", async () => {
  const table = await openTable();
  const druid = table.addHero({ class: "druid", level: 4, maxHp: 30 });
  const call = (form) =>
    table.invoke("use_resource", { characterId: druid.id, resource: "Wild Shape", ...(form ? { form } : {}) });
  for (const form of ["wolf", "ape"]) {
    assert.equal((await call(form)).ok, true, form);
    await call();
  }
  assert.deepEqual(table.sheet(druid.id).resources.wild_shape, { max: 2, used: 2 });
  await refusedUnchanged(table, druid.id, () => call("boar"), "a third shape");
  await table.invoke("take_rest", { kind: "short" });
  assert.deepEqual(table.sheet(druid.id).resources.wild_shape, { max: 2, used: 0 });
  assert.equal((await call("boar")).ok, true);
});

await test("a shape needs a beast named, and costs nothing when refused", async () => {
  const druid = world.addHero({ class: "druid", level: 4 });
  for (const form of [undefined, "", "   "]) {
    await refusedUnchanged(world, druid.id, () => shape(druid.id, form), `form ${JSON.stringify(form)}`);
  }
  // A beast outside the table with no stat block given is refused too.
  await refusedUnchanged(world, druid.id, () => shape(druid.id, "giant badger"));
});

await test("a druid in beast form casts nothing, and the slot is not spent", async () => {
  const druid = world.addHero({
    class: "druid",
    level: 4,
    abilities: { wis: 16 },
    spellcasting: casting("wis", { 1: [4, 0], 2: [3, 0] }, { prepared: ["Cure Wounds"] }),
  });
  await shape(druid.id, "wolf");
  await refusedUnchanged(world, druid.id, () =>
    world.invoke("use_spell_slot", { characterId: druid.id, level: 1, name: "Cure Wounds" }),
  );
});

// ---- findings ----

await test("A druid's beast form is limited by challenge rating and movement at every level; a 2nd level druid takes CR 1/4 at most.", async () => {
  const druid = world.addHero({ class: "druid", level: 2, maxHp: 17 });
  await refusedUnchanged(world, druid.id, () =>
    shape(druid.id, "ancient red dragon", { formHp: 300, formAc: 22 }),
  );
  // A real CR 5 beast the table does not list, with its real numbers.
  await refusedUnchanged(world, druid.id, () =>
    shape(druid.id, "giant crocodile", { formHp: 85, formAc: 14 }),
  );
});

await test("A druid stays in beast shape for a number of hours equal to half their druid level (rounded down), then reverts.", async () => {
  const table = await openTable();
  const druid = table.addHero({ class: "druid", level: 2, maxHp: 17 });
  await table.invoke("use_resource", { characterId: druid.id, resource: "Wild Shape", form: "wolf" });
  await table.invoke("pass_time", { amount: 59, unit: "minutes" });
  assert.equal(table.sheet(druid.id).wildShape?.form, "Wolf", "still shaped inside the hour");
  await table.invoke("pass_time", { amount: 2, unit: "hours" });
  assert.equal(table.sheet(druid.id).wildShape, null);
});

await test("While shaped the druid has the beast's hit points, so healing received in the form restores the beast's hit points.", async () => {
  const druid = world.addHero({ class: "druid", level: 4, maxHp: 30 });
  world.patch(druid.id, { currentHp: 10 });
  await shape(druid.id, "wolf");
  await hurt(druid.id, 8);
  const healed = await world.invoke("heal", { characterId: druid.id, amount: 4, reason: "test" });
  assert.equal(healed.ok, true, healed.error);
  assert.equal(world.sheet(druid.id).wildShape.beastHp, 7);
  assert.equal(world.sheet(druid.id).currentHp, 10);
});

await test("a beast the table does not list is taken on its stated challenge rating, inside the same caps", async () => {
  const druid = world.addHero({ class: "druid", level: 4, maxHp: 30 });
  // No challenge rating, no form.
  await refusedUnchanged(world, druid.id, () => shape(druid.id, "badger", { formHp: 3, formAc: 10 }));
  // A flier before druid 8 and numbers no CR 1/4 beast has are refused.
  await refusedUnchanged(world, druid.id, () =>
    shape(druid.id, "blood hawk", { formHp: 7, formAc: 12, formCr: 0.125, formFlies: true }),
  );
  await refusedUnchanged(world, druid.id, () =>
    shape(druid.id, "ancient red dragon", { formHp: 300, formAc: 22, formCr: 0.25 }),
  );
  await refusedUnchanged(world, druid.id, () =>
    shape(druid.id, "armored thing", { formHp: 20, formAc: 19, formCr: 0.25 }),
  );
  // A real CR 0 beast with its real numbers.
  const out = await shape(druid.id, "badger", { formHp: 3, formAc: 10, formCr: 0 });
  assert.equal(out.ok, true, out.error);
  const held = world.sheet(druid.id);
  assert.deepEqual(
    [held.wildShape.form, held.wildShape.beastHp, held.wildShape.beastAc],
    ["badger", 3, 10],
  );
  assert.equal(held.resources.wild_shape.used, 1);
});

await test("the form lasts half the druid's level in hours, and a new form starts the count again", async () => {
  const table = await openTable();
  const druid = table.addHero({ class: "druid", level: 5, maxHp: 30 });
  const take = (form) => table.invoke("use_resource", { characterId: druid.id, resource: "Wild Shape", form });
  assert.equal((await take("wolf")).ok, true);
  await table.invoke("pass_time", { amount: 90, unit: "minutes" });
  // Back to their own shape and into another: two hours from now.
  await table.invoke("use_resource", { characterId: druid.id, resource: "Wild Shape" });
  assert.equal(table.sheet(druid.id).wildShape, null);
  assert.equal((await take("black bear")).ok, true);
  await table.invoke("pass_time", { amount: 119, unit: "minutes" });
  assert.equal(table.sheet(druid.id).wildShape?.form, "Black Bear");
  await table.invoke("pass_time", { amount: 1, unit: "minutes" });
  assert.equal(table.sheet(druid.id).wildShape, null);
  assert.equal(table.sheet(druid.id).currentHp, 30, "their own hit points were waiting");
});

world.close();
finish();
