// Using up a consumable, through use_item (src/lib/dm/resource-tools.ts
// computeUseItem, src/lib/dm/item-logic.ts).
//
// SRD 5.1: a Potion of Healing restores 2d4 + 2 hit points, Greater 4d4 + 4,
// Superior 8d4 + 8, Supreme 10d4 + 20, and drinking one uses it up. The
// server rolls the dice, the healing never passes the drinker's maximum, the
// row's quantity falls by one and the row goes when the last is used. An
// item that is not carried cannot be used, and a potion poured into the dead
// is refused and stays in the pack.
import assert from "node:assert/strict";
import { openTable, refusedUnchanged, rolled } from "./lib/enforce-resources.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-use-item");
const world = await openTable();

const qty = (id, name) => world.sheet(id).equipment.find((item) => item.name === name)?.qty ?? 0;
const use = (characterId, item, extra = {}) => world.invoke("use_item", { characterId, item, ...extra });

await test("each healing potion rolls its SRD dice", async () => {
  const POTIONS = [
    ["Potion of Healing", 2, 2],
    ["Potion of Greater Healing", 4, 4],
    ["Potion of Superior Healing", 8, 8],
    ["Potion of Supreme Healing", 10, 20],
  ];
  for (const [name, dice, flat] of POTIONS) {
    const drinker = world.addHero({ class: "fighter", level: 10, maxHp: 120, equipment: [{ name, qty: 1 }] });
    world.patch(drinker.id, { currentHp: 10 });
    world.diceLog();
    const faces = Array.from({ length: dice }, (_, index) => (index % 4) + 1);
    world.dice(faces);
    const drunk = await use(drinker.id, name);
    assert.equal(drunk.ok, true, drunk.error);
    assert.deepEqual(rolled(world), faces.map((face) => [4, face]), name);
    const healed = faces.reduce((sum, face) => sum + face, 0) + flat;
    assert.equal(world.sheet(drinker.id).currentHp, 10 + healed, name);
    assert.equal(qty(drinker.id, name), 0, name);
  }
});

await test("a potion is used one at a time and the row goes with the last", async () => {
  const drinker = world.addHero({
    class: "fighter",
    level: 5,
    maxHp: 60,
    equipment: [{ name: "Potion of Healing", qty: 2 }, { name: "Rope", qty: 1 }],
  });
  world.patch(drinker.id, { currentHp: 10 });
  world.dice(3, 4);
  await use(drinker.id, "Potion of Healing");
  rolled(world);
  assert.equal(world.sheet(drinker.id).currentHp, 19);
  assert.equal(qty(drinker.id, "Potion of Healing"), 1);
  world.dice(1, 1);
  await use(drinker.id, "Potion of Healing");
  rolled(world);
  assert.equal(world.sheet(drinker.id).currentHp, 23);
  assert.deepEqual(world.sheet(drinker.id).equipment.map((item) => item.name), ["Rope"]);
  await refusedUnchanged(world, drinker.id, () => use(drinker.id, "Potion of Healing"));
});

await test("healing from a potion stops at the maximum", async () => {
  const drinker = world.addHero({
    class: "fighter",
    level: 5,
    maxHp: 44,
    equipment: [{ name: "Potion of Healing", qty: 1 }],
  });
  world.patch(drinker.id, { currentHp: 41 });
  world.dice(4, 4);
  await use(drinker.id, "Potion of Healing");
  rolled(world);
  assert.equal(world.sheet(drinker.id).currentHp, 44);
});

await test("a potion fed to a friend heals the friend and leaves the giver's pack", async () => {
  const giver = world.addHero({ class: "cleric", level: 3, maxHp: 24, equipment: [{ name: "Potion of Healing", qty: 1 }] });
  const friend = world.addHero({ class: "rogue", level: 3, maxHp: 24 });
  world.patch(giver.id, { currentHp: 6 });
  world.patch(friend.id, { currentHp: 0, deathSaves: { successes: 1, failures: 2, stable: false, dead: false } });
  world.dice(2, 3);
  const fed = await use(giver.id, "Potion of Healing", { targetCharacterId: friend.id });
  assert.equal(fed.ok, true, fed.error);
  rolled(world);
  assert.equal(world.sheet(friend.id).currentHp, 7);
  // Any healing ends the dying state.
  assert.equal(world.sheet(friend.id).deathSaves, null);
  assert.equal(world.sheet(giver.id).currentHp, 6);
  assert.equal(qty(giver.id, "Potion of Healing"), 0);
});

await test("an item that is not carried cannot be used", async () => {
  const empty = world.addHero({ class: "fighter", level: 1, equipment: [{ name: "Rope", qty: 1 }] });
  world.patch(empty.id, { currentHp: 5 });
  for (const item of ["Potion of Healing", "Potion of Supreme Healing", "Scroll of Wish"]) {
    await refusedUnchanged(world, empty.id, () => use(empty.id, item), item);
  }
});

await test("a potion poured into the dead is refused and stays in the pack", async () => {
  const healer = world.addHero({ class: "cleric", level: 1, equipment: [{ name: "Potion of Healing", qty: 1 }] });
  const fallen = world.addHero({ class: "rogue", level: 1 });
  world.patch(fallen.id, {
    currentHp: 0,
    deathSaves: { successes: 0, failures: 3, stable: false, dead: true },
  });
  await refusedUnchanged(world, healer.id, () =>
    use(healer.id, "Potion of Healing", { targetCharacterId: fallen.id }),
  );
  assert.equal(world.sheet(fallen.id).currentHp, 0);
  assert.equal(qty(healer.id, "Potion of Healing"), 1);
});

await test("any other consumable is counted down and rolls nothing", async () => {
  const camper = world.addHero({ class: "ranger", level: 1, equipment: [{ name: "Rations", qty: 3 }] });
  world.diceLog();
  const eaten = await use(camper.id, "Rations");
  assert.equal(eaten.ok, true, eaten.error);
  assert.deepEqual(world.diceLog(), []);
  assert.equal(qty(camper.id, "Rations"), 2);
  assert.equal(world.sheet(camper.id).currentHp, camper.currentHp);
});

world.close();
finish();
