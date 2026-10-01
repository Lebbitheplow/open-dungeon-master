// Potions and scrolls do what the SRD says when they are used up, through
// use_item, applied by the engine.
//
// SRD 5.1, Potions: Vitality removes all exhaustion and cures poison and
// disease (it restores no hit points of its own); Heroism grants 10
// temporary hit points and the bless spell for an hour; Giant Strength sets
// Strength to the giant's score for an hour; Invisibility makes the drinker
// invisible for an hour; Resistance grants resistance to one damage type
// for an hour. Spell Scroll: a spell on the reader's class list can be read
// and cast without a slot; one above the level they can cast needs a check
// with their spellcasting ability, DC 10 + its level, or the scroll is lost;
// a spell off their class list is unintelligible, and the scroll stays.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-consumables");
const world = await openWorld();
const { computeSheetDerived } = await import("../src/lib/srd/index.ts");

const drinker = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { str: 10 } });
const sheet = () => world.sheet(drinker.id);
const drink = async (name, extra = {}) => {
  world.patch(drinker.id, { equipment: [{ name, qty: 1 }] });
  const out = await world.invoke("use_item", { characterId: drinker.id, item: name, ...extra });
  assert.equal(out.ok, true, out.error);
  assert.equal(sheet().equipment.some((item) => item.name === name), false, `${name} was not used up`);
  return out;
};

await test("A Potion of Vitality removes every level of exhaustion and cures poison, and heals nothing by itself.", async () => {
  world.patch(drinker.id, { currentHp: 30, exhaustion: 2, conditions: ["poisoned"], conditionMeta: {} });
  world.clearDice();
  world.dice(4, 4);
  await drink("Potion of Vitality");
  assert.equal(world.clearDice(), 2, "the potion rolled healing dice");
  assert.equal(sheet().exhaustion, 0);
  assert.equal(sheet().conditions.includes("poisoned"), false);
  assert.equal(sheet().currentHp, 30);
});

await test("Heroism, Giant Strength, Invisibility and Fire Resistance potions apply their SRD effects for an hour: 10 temporary hit points and bless, Strength 21, invisible, fire resistance.", async () => {
  world.patch(drinker.id, { conditions: [], conditionMeta: {}, tempHp: 0, currentHp: 44 });
  await drink("Potion of Heroism");
  assert.equal(sheet().tempHp, 10);
  assert.ok(sheet().conditions.includes("blessed"));
  await drink("Potion of Hill Giant Strength");
  assert.equal(computeSheetDerived(sheet()).abilityMods.str, abilityMod(21));
  await drink("Potion of Invisibility");
  assert.ok(sheet().conditions.includes("invisible"));
  await drink("Potion of Fire Resistance");
  world.patch(drinker.id, { tempHp: 0, currentHp: 44 });
  await world.invoke("apply_damage", { characterId: drinker.id, amount: 10, type: "fire", reason: "a fire bolt" });
  assert.equal(sheet().currentHp, 39);
});

const mage = world.addHero({ class: "wizard", level: 1, maxHp: 10, abilities: { int: 16 }, spellcasting: { ability: "int", slots: { 1: { max: 2, used: 0 } }, prepared: [], known: [], cantrips: [] } });
const fighter = world.addHero({ class: "fighter", level: 5 });
const carries = (id, name) => world.sheet(id).equipment.some((item) => item.name === name);

await test("A spell scroll off the reader's class list is unintelligible: the use is refused and the scroll stays.", async () => {
  world.patch(fighter.id, { equipment: [{ name: "Spell Scroll (Magic Missile)", qty: 1 }] });
  const read = await world.invoke("use_item", { characterId: fighter.id, item: "Spell Scroll (Magic Missile)" });
  assert.equal(read.ok, false);
  assert.equal(carries(fighter.id, "Spell Scroll (Magic Missile)"), true);
});

await test("A scroll of a spell above what the reader can cast needs a check, DC 10 + the spell's level, and a failure wastes it; one they can cast is cast without a slot.", async () => {
  world.patch(mage.id, { equipment: [{ name: "Spell Scroll (Fireball)", qty: 1 }, { name: "Spell Scroll (Magic Missile)", qty: 1 }] });
  world.dice(2);
  const failed = await world.invoke("use_item", { characterId: mage.id, item: "Spell Scroll (Fireball)" });
  assert.equal(world.clearDice(), 0, "no check was rolled for a 3rd-level scroll");
  assert.equal(failed.ok, true, failed.error);
  assert.equal(failed.result.spellCast, false);
  assert.equal(carries(mage.id, "Spell Scroll (Fireball)"), false);
  const cast = await world.invoke("use_item", { characterId: mage.id, item: "Spell Scroll (Magic Missile)" });
  assert.equal(cast.result.spellCast, "Magic Missile");
  assert.equal(world.sheet(mage.id).spellcasting.slots["1"].used, 0);
});

world.close();
finish();
