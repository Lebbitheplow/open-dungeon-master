// Potions and scrolls do what the SRD says when they are used up, through
// use_item, applied by the engine.
//
// SRD 5.1, Potions: Vitality removes all exhaustion and cures poison and
// disease (it restores no hit points of its own); Elixir of Health cures
// disease and removes the blinded, deafened, paralyzed and poisoned
// conditions, and leaves exhaustion alone; Heroism grants 10
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

await test("An Elixir of Health removes blinded, deafened, paralyzed and poisoned, and leaves exhaustion and other conditions alone.", async () => {
  // Paralyzed, the drinker cannot take an action: an ally pours it.
  const ally = world.addHero({ class: "cleric", level: 5 });
  world.patch(drinker.id, { currentHp: 30, exhaustion: 2, conditions: ["blinded", "deafened", "paralyzed", "poisoned", "frightened"], conditionMeta: {} });
  world.patch(ally.id, { equipment: [{ name: "Elixir of Health", qty: 1 }] });
  const out = await world.invoke("use_item", { characterId: ally.id, item: "Elixir of Health", targetCharacterId: drinker.id });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(sheet().conditions, ["frightened"]);
  assert.equal(sheet().exhaustion, 2);
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
  world.patch(fighter.id, { equipment: [{ name: "Spell Scroll (Magic Missile)", qty: 1, tags: ["consumable", "scroll", "carried"], spell: "Magic Missile" }] });
  const read = await world.invoke("use_item", { characterId: fighter.id, item: "Spell Scroll (Magic Missile)" });
  assert.equal(read.ok, false);
  assert.equal(carries(fighter.id, "Spell Scroll (Magic Missile)"), true);
});

await test("A scroll of a spell above what the reader can cast needs a check, DC 10 + the spell's level, and a failure wastes it; one they can cast is cast without a slot.", async () => {
  world.patch(mage.id, { equipment: [{ name: "Spell Scroll (Fireball)", qty: 1, tags: ["consumable", "scroll", "carried"], spell: "Fireball" }, { name: "Spell Scroll (Magic Missile)", qty: 1, tags: ["consumable", "scroll", "carried"], spell: "Magic Missile" }] });
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

// The same scroll at five tables: what it holds is a field, whatever it is
// called.
const SCROLL = ["consumable", "scroll", "carried"];
for (const name of ["Scroll of Magic Missile", "Pergamena di Dardo incantato", "Parchemin de projectile magique", "Pergamino de proyectil mágico", "Schriftrolle Magisches Geschoss"]) {
  await test(`A scroll given its spell is read as that spell: "${name}" casts Magic Missile.`, async () => {
    world.patch(mage.id, { equipment: [] });
    const granted = await world.invoke("grant_item", { characterId: mage.id, name, tags: SCROLL, spell: "magic missile", reason: "found" });
    assert.equal(granted.ok, true, granted.error);
    assert.deepEqual(world.sheet(mage.id).equipment, [{ name, qty: 1, tags: SCROLL, spell: "Magic Missile" }]);
    const cast = await world.invoke("use_item", { characterId: mage.id, item: name });
    assert.equal(cast.result.spellCast, "Magic Missile", JSON.stringify(cast));
  });
}

await test("A scroll's name is never read for its spell: a Scroll of Magic Missile given no spell casts nothing.", async () => {
  world.patch(mage.id, { equipment: [{ name: "Scroll of Magic Missile", qty: 1, tags: SCROLL }] });
  const used = await world.invoke("use_item", { characterId: mage.id, item: "Scroll of Magic Missile" });
  assert.equal(used.result?.spellCast, undefined, JSON.stringify(used));
});

await test("A spell is refused on a thing that is no scroll, and a spell nobody knows is refused.", async () => {
  world.patch(mage.id, { equipment: [] });
  const ring = await world.invoke("grant_item", { characterId: mage.id, name: "Ring of Protection", spell: "Fireball", reason: "found" });
  assert.equal(ring.retry, true, "a ring was given a spell");
  const unknown = await world.invoke("grant_item", { characterId: mage.id, name: "Scroll", tags: SCROLL, spell: "Gloomwhistle", reason: "found" });
  assert.equal(unknown.retry, true, "a scroll was given a spell nobody knows");
  assert.deepEqual(world.sheet(mage.id).equipment, []);
});

await test("An unidentified scroll keeps its spell off the sheet until it is revealed, and two scrolls of different spells never merge.", async () => {
  world.patch(mage.id, { equipment: [] });
  await world.invoke("grant_item", { characterId: mage.id, name: "a sealed parchment", unidentified: true, tags: SCROLL, spell: "Fireball", reason: "found" });
  assert.deepEqual(world.sheet(mage.id).equipment, [{ name: "a sealed parchment", qty: 1, identified: false }]);
  const revealed = await world.invoke("reveal_item", { characterId: mage.id, name: "a sealed parchment", revealedName: "Pergamena", tags: SCROLL, spell: "Fireball", reason: "read" });
  assert.equal(revealed.ok, true, revealed.error);
  await world.invoke("grant_item", { characterId: mage.id, name: "Pergamena", tags: SCROLL, spell: "Magic Missile", reason: "found" });
  assert.deepEqual(world.sheet(mage.id).equipment.map((item) => [item.name, item.qty, item.spell]), [["Pergamena", 1, "Fireball"], ["Pergamena", 1, "Magic Missile"]]);
});

await test("A potion taken from a chest and drunk in one breath is refused until it is given, and the refusal says to give it first, by an SRD name or the table's own.", async () => {
  world.patch(drinker.id, { equipment: [] });
  for (const name of ["Potion of Healing", "Pozione di guarigione"]) {
    const out = await world.invoke("use_item", { characterId: drinker.id, item: name });
    assert.ok(out.error, `${name} was drunk without being carried`);
    assert.match(out.error, /given with grant_item first, then used/);
  }
});

world.close();
finish();
