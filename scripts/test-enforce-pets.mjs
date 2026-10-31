// The creatures bound to a character fight and take damage as what they are
// (issue 520). A story pet named for a creature takes its stat block and,
// when it is no stronger than a druid of the owner's level could become,
// fights with it; one with no block keeps the numbers it was given and does
// not attack. Damage routed at a pet meets its own defenses, which every
// pet now keeps: a familiar's from its form, a Beast Master's beast's from
// its block, a drake's from the essence it was summoned with.
//
// The rules, from SRD 5.1 and the app's own feature text:
//   - Wolf (CR 1/4): 11 hit points, AC 13, speed 40 ft., Bite +4, 2d4+2
//     piercing. Brown Bear: CR 1. Gargoyle: CR 2, resistant to nonmagical
//     bludgeoning, piercing and slashing not made with adamantine.
//   - Imp: immune to fire and poison, resistant to cold and to nonmagical
//     bludgeoning, piercing and slashing not made with silvered weapons.
//   - Wild Shape's ceiling without the Circle of the Moon: CR 1/4, 1/2 from
//     4th level, 1 from 8th.
//   - Drake Companion (src/lib/srd/subclasses.json): its Draconic Essence is
//     chosen at each summon and it is immune to that damage; Bond of Fang
//     and Scale (7th): its Bite deals an extra 1d6 of that type. Its hit
//     points and a Beast Master's floor follow the ranger's own level.
//
// Every check reads a sheet, an enemy row or a refusal; dice are forced.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { enemyOf } from "./lib/enforce-spell-kit.mjs";
import { board, holdTurn } from "./lib/enforce-zones.mjs";

const { test, finish } = suite("test-enforce-pets");
const { createHomebrewMonster } = await import("../src/lib/bestiary/homebrew-monsters.ts");
const { draftFromCr } = await import("../src/lib/bestiary/monster-draft.ts");
const { patchSheet } = await import("../src/lib/db/sheets.ts");

const OWNER = (level, extra = {}) => ({ class: "fighter", level, maxHp: 12 + level * 8, ...extra });
const pet = (world, hero) => world.sheet(hero.id).pets[0];

async function summonedOnBoard(form, level = 1, stats = {}) {
  const { world, sheets: [hero], enemies: [dummy] } = await board([OWNER(level)], { 0: { x: 3, y: 4 }, e0: { x: 4, y: 4 } }, { stats });
  const out = await world.invoke("summon_pet", { characterId: hero.id, kind: "other", form, name: "Patch" });
  assert.equal(out.ok, true, out.error);
  holdTurn(world, hero.id);
  return { world, hero, dummy, out };
}

await test("A story pet named for an SRD creature takes its stat block and fights with it.", async () => {
  const { world, hero, dummy, out } = await summonedOnBoard("wolf");
  const wolf = pet(world, hero);
  assert.deepEqual([wolf.form, wolf.hp, wolf.ac, wolf.speed], ["Wolf", 11, 13, 40]);
  assert.match(out.result.attacks, /Bite/);
  // A 15 hits AC 13; the bite's 2d4 rolls 3 and 3, plus 2.
  world.dice(15, 3, 3, 20);
  const bite = await world.invoke("pet_attack", { characterId: hero.id, targetEnemyId: dummy.id });
  world.clearDice();
  assert.equal(bite.ok, true, bite.error);
  assert.equal(bite.result.hit, true);
  assert.equal(enemyOf(world, dummy.id).currentHp, 90 - 8);
  world.close();
});

await test("A story pet stronger than a druid of its owner's level could become is kept, but does not fight; at 8th level a brown bear does.", async () => {
  const low = await summonedOnBoard("brown bear", 1);
  assert.deepEqual(pet(low.world, low.hero).attacks, []);
  assert.match(pet(low.world, low.hero).notes, /CR 1: too strong to fight at .*command \(a story pet fights at CR 1\/4 or lower/);
  const refused = await low.world.invoke("pet_attack", { characterId: low.hero.id, targetEnemyId: low.dummy.id });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /no attacks on record/);
  low.world.close();
  const high = await summonedOnBoard("brown bear", 8);
  assert.deepEqual(pet(high.world, high.hero).attacks.map((attack) => attack.name), ["Bite", "Claws"]);
  high.world.close();
});

await test("A story pet with no stat block needs its hit points and AC, and cannot attack.", async () => {
  const world = await openWorld();
  const hero = world.addHero(OWNER(3));
  const bare = await world.invoke("summon_pet", { characterId: hero.id, kind: "other", form: "clockwork crow" });
  assert.equal(bare.retry, true);
  assert.match(bare.error, /names no stat block the table knows.*or send its hp and ac for a pet that cannot attack/);
  const sent = await world.invoke("summon_pet", { characterId: hero.id, kind: "other", form: "clockwork crow", hp: 6, ac: 13 });
  assert.equal(sent.ok, true, sent.error);
  assert.match(sent.result.attacks, /cannot attack/);
  world.close();
});

await test("A story pet the table made in the workshop fights with that block, its rider meeting its own resistance.", async () => {
  const { world, sheets: [hero], enemies: [dummy] } = await board([OWNER(1)], { 0: { x: 3, y: 4 }, e0: { x: 4, y: 4 } }, { stats: { resist: "lightning" } });
  const draft = draftFromCr("Clockwork Crow", 0.125);
  draft.stats.attacks = [{ name: "Spark Peck", toHit: 4, damage: "1d4+2+1d6", type: "piercing/lightning", mode: "melee", reach: 5, riders: [{ dice: "1d6", type: "lightning" }] }];
  draft.stats.immune = "poison";
  createHomebrewMonster(world.owner.id, draft, "");
  const out = await world.invoke("summon_pet", { characterId: hero.id, kind: "other", form: "Clockwork Crow" });
  assert.equal(out.ok, true, out.error);
  const crow = pet(world, hero);
  assert.deepEqual(crow.attacks[0], { name: "Spark Peck", toHit: 4, damage: "1d4+2", type: "piercing", reach: 5, riders: [{ dice: "1d6", type: "lightning" }] });
  assert.equal(crow.immune, "poison");
  holdTurn(world, hero.id);
  // 2 + 2 piercing, and 4 lightning halved to 2.
  world.dice(15, 2, 4);
  const peck = await world.invoke("pet_attack", { characterId: hero.id, targetEnemyId: dummy.id });
  world.clearDice();
  assert.equal(peck.ok, true, peck.error);
  assert.equal(enemyOf(world, dummy.id).currentHp, 90 - 6);
  world.close();
});

// Issue 659: the refusal told the model an ordinary familiar delivers touch
// spells, which the engine never does (it has no square on the board, and a
// touch spell is measured from its caster).
await test("An ordinary familiar cannot attack, and its refusal promises no touch spell the server will not deliver.", async () => {
  const world = await openWorld();
  const wizard = world.addHero({ class: "wizard", level: 3, maxHp: 20, abilities: { int: 16 }, spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, known: [], prepared: ["Find Familiar"], cantrips: [] } });
  const summoned = await world.invoke("summon_pet", { characterId: wizard.id, kind: "familiar", form: "cat" });
  assert.equal(summoned.ok, true, summoned.error);
  const swing = await world.invoke("pet_attack", { characterId: wizard.id, targetEnemyId: "nobody" });
  assert.notEqual(swing.ok, true);
  assert.match(swing.error ?? "", /cannot attack/);
  assert.doesNotMatch(swing.error ?? "", /deliver touch spells/);
  world.close();
});

await test("An imp familiar takes no fire or poison, half of cold, and half of a nonmagical blow but all of a magical one.", async () => {
  const world = await openWorld();
  const warlock = world.addHero({ class: "warlock", level: 3, maxHp: 30, abilities: { cha: 16 } });
  world.patch(warlock.id, { features: [...world.sheet(warlock.id).features, { name: "Pact of the Chain", source: "class" }] });
  const summoned = await world.invoke("summon_pet", { characterId: warlock.id, kind: "familiar", form: "imp" });
  assert.equal(summoned.ok, true, summoned.error);
  assert.match(summoned.result.defenses, /immune to fire, poison/);
  const hit = (args) => world.invoke("apply_damage", { characterId: warlock.id, petName: "Imp", ...args });
  const fire = await hit({ amount: 6, type: "fire" });
  assert.equal(fire.ok, true, fire.error);
  assert.equal(fire.result.damage, 0);
  assert.match(fire.result.defenses, /immune to fire damage/);
  await hit({ amount: 6, type: "poison" });
  assert.equal(pet(world, warlock).hp, 10);
  await hit({ amount: 6, type: "cold" });
  assert.equal(pet(world, warlock).hp, 7);
  await hit({ amount: 4, type: "bludgeoning" });
  assert.equal(pet(world, warlock).hp, 5);
  await hit({ amount: 4, type: "bludgeoning", magical: true });
  assert.equal(pet(world, warlock).hp, 1);
  assert.equal(world.sheet(warlock.id).currentHp, world.sheet(warlock.id).maxHp, "never the owner's");
  world.close();
});

await test("A familiar or beast companion stored before pets kept defenses has its form's when it is read.", async () => {
  const world = await openWorld();
  const warlock = world.addHero({ class: "warlock", level: 3, maxHp: 30 });
  world.patch(warlock.id, { features: [...world.sheet(warlock.id).features, { name: "Pact of the Chain", source: "class" }] });
  await world.invoke("summon_pet", { characterId: warlock.id, kind: "familiar", form: "imp" });
  const stored = { ...pet(world, warlock) };
  delete stored.resist;
  delete stored.immune;
  patchSheet(warlock.id, { pets: [stored] });
  assert.equal(pet(world, warlock).immune, "fire, poison");
  world.close();
});

await test("A drake is summoned with its essence and is immune to it; from 7th level its bite carries that essence.", async () => {
  const world = await openWorld();
  const ranger = world.addHero({ class: "ranger", subclass: "Drakewarden", level: 3, maxHp: 30 });
  const asked = await world.invoke("summon_pet", { characterId: ranger.id, kind: "drake", form: "drake" });
  assert.equal(asked.retry, true);
  assert.match(asked.error, /Draconic Essence.*acid, cold, fire, lightning, poison\. Ask the player which/);
  const out = await world.invoke("summon_pet", { characterId: ranger.id, kind: "drake", form: "drake", essence: "fire" });
  assert.equal(out.ok, true, out.error);
  assert.equal(pet(world, ranger).immune, "fire");
  assert.equal(pet(world, ranger).attacks[0].riders, undefined);
  const burn = await world.invoke("apply_damage", { characterId: ranger.id, petName: "Drake", amount: 10, type: "fire" });
  assert.equal(burn.result.damage, 0);
  assert.equal(pet(world, ranger).hp, 20);
  // A ranger whose features name the essence is not asked again.
  world.patch(ranger.id, { level: 7, features: [...world.sheet(ranger.id).features, { name: "Bond of Fang and Scale (Cold)", source: "class" }] });
  const grown = await world.invoke("summon_pet", { characterId: ranger.id, kind: "drake", form: "drake" });
  assert.equal(grown.ok, true, grown.error);
  const drake = pet(world, ranger);
  assert.equal(drake.immune, "cold");
  assert.deepEqual(drake.attacks[0].riders, [{ dice: "1d6", type: "cold" }]);
  assert.equal(drake.maxHp, 5 + 7 * 5);
  world.close();
});

await test("A multiclass Beast Master's companion has the floor of four times the ranger's own level, not the character's.", async () => {
  const world = await openWorld();
  const ranger = world.addHero({ class: "ranger", subclass: "Beast Master", level: 8, maxHp: 60 });
  world.patch(ranger.id, { classes: [{ id: "ranger", subclass: "Beast Master", level: 3 }, { id: "fighter", subclass: "", level: 5 }] });
  const out = await world.invoke("summon_pet", { characterId: ranger.id, kind: "beast_companion", form: "wolf" });
  assert.equal(out.ok, true, out.error);
  assert.equal(pet(world, ranger).maxHp, 12);
  world.close();
});

finish();
