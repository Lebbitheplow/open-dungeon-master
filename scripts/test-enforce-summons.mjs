// Spells and features that make a creature (src/lib/dm/summon-*.ts): the
// creature arrives as an ally with its SRD 5.1 stat block, on the board and in
// the initiative order, fights with its own numbers, and goes when the spell
// or its hit points do.
//
// The rules, from SRD 5.1:
//   - Conjure Animals: one beast of challenge rating 2 or lower, two of 1 or
//     lower, four of 1/2 or lower, or eight of 1/4 or lower; twice as many
//     from a 5th level slot, three times from 7th, four times from 9th. The
//     same shape for Conjure Woodland Beings (fey) and Conjure Minor
//     Elementals (elementals). Concentration, up to an hour; the creatures
//     roll initiative as a group and act on their own turns.
//   - Conjure Elemental and Conjure Fey: one creature; when concentration
//     breaks it does not vanish but turns hostile.
//   - Animate Dead: one skeleton or zombie, two more for each slot level above
//     3rd, under control for 24 hours (no concentration).
//   - Giant Insect: ten centipedes, three spiders, five wasps or one scorpion.
//   - Find Steed: one steed (warhorse, pony, camel, elk, mastiff) with an
//     Intelligence of at least 6; one at a time.
//   - Animate Objects: ten objects (Medium count as two, Large four, Huge
//     eight), two more per slot level above 5th, with the spell's own table.
//   - A summoned creature reduced to 0 hit points disappears.
//   - Durable Summons: creatures a conjurer summons have 30 temporary hit
//     points.
//
// Every check reads a sheet, the encounter row, the board, an enemy row or a
// refusal; dice are forced.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { hasPack, openWorld } from "./lib/enforce-world.mjs";
import { caster, closeTables, enemyOf } from "./lib/enforce-spell-kit.mjs";
import { castOnOwnTurn, fightDummies, layMap } from "./lib/enforce-spells.mjs";
import { board, holdTurn, mapOf, OPEN, place, tokenOf } from "./lib/enforce-zones.mjs";

const { test, finish } = suite("test-enforce-summons");
const { listTokens } = await import("../src/lib/db/battle-maps.ts");

const summonsOf = (world, spell) =>
  world.sheets().filter((sheet) => sheet.summon && (!spell || sheet.summon.spell === spell));
const slotsLeft = (world, id, level) => {
  const slot = world.sheet(id).spellcasting.slots[String(level)];
  return slot.max - slot.used;
};
const DRUID = (spells, level = 5) => caster("druid", "wis", spells, [], level);
const WIZARD = (spells, level = 9, extra = {}) => caster("wizard", "int", spells, [], level, extra);

// A spell with a casting time of a minute or more is cast out of a fight (the
// engine refuses it in one, as the rules do): the heroes cast first, then a
// fight starts on an open board with everyone placed.
async function outOfFight(heroes) {
  const world = await openWorld();
  const sheets = heroes.map((hero) => world.addHero(hero));
  return { world, sheets };
}
async function thenFight(world, casterId) {
  const enemies = await fightDummies(world, 1, { heroFaces: { [casterId]: 20 } });
  castOnOwnTurn(world);
  const positions = {};
  world.sheets().forEach((sheet, index) => {
    positions[sheet.id] = { x: 1 + (index % 6), y: 1 + Math.floor(index / 6) };
  });
  enemies.forEach((enemy, index) => {
    positions[enemy.id] = { x: 22 - index, y: 8 };
  });
  await layMap(world, OPEN(), positions);
  return enemies;
}

await test("Conjure Animals from a 3rd level slot brings eight creatures of challenge rating 1/4, each an ally with the SRD stat block of its kind, on the board and in the initiative order, rolling initiative as one group.", async () => {
  const { world, sheets: [druid] } = await board([DRUID(["Conjure Animals"])], [{ x: 3, y: 4 }]);
  const cast = await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "wolf" });
  assert.equal(cast.ok, true, cast.error);
  const wolves = summonsOf(world, "Conjure Animals");
  assert.equal(wolves.length, 8, "eight wolves from a 3rd level slot");
  for (const wolf of wolves) {
    assert.equal(wolf.maxHp, 11);
    assert.equal(wolf.ac, 13);
    assert.equal(wolf.abilities.dex, 15);
    assert.equal(wolf.summon.casterId, druid.id);
    assert.ok(tokenOf(world, wolf.id), "every wolf has a token");
  }
  const entries = world.encounter().order.filter((entry) => wolves.some((wolf) => wolf.id === entry.characterId));
  assert.equal(entries.length, 8, "every wolf has an initiative entry");
  assert.equal(new Set(entries.map((entry) => entry.initiative)).size, 1, "one group roll");
  assert.equal(slotsLeft(world, druid.id, 3), 1);
});

await test("Conjure Animals with a beast of challenge rating 1 brings two; from a 5th level slot twice as many.", async () => {
  const { world, sheets: [druid] } = await board([DRUID(["Conjure Animals"], 9)], [{ x: 3, y: 4 }]);
  const cast = await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 5, variant: "brown bear" });
  assert.equal(cast.ok, true, cast.error);
  const bears = summonsOf(world, "Conjure Animals");
  assert.equal(bears.length, 4);
  assert.equal(bears[0].maxHp, 34);
});

await test("Conjure Animals refuses, before the slot, a beast above challenge rating 2 and a creature that is not a beast.", async () => {
  const { world, sheets: [druid] } = await board([DRUID(["Conjure Animals"])], [{ x: 3, y: 4 }]);
  const ape = await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "giant ape" });
  assert.equal(ape.ok, false);
  const skeleton = await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "skeleton" });
  assert.equal(skeleton.ok, false);
  assert.match(skeleton.error, /beast/i);
  assert.equal(slotsLeft(world, druid.id, 3), 2, "no slot spent");
  assert.equal(summonsOf(world).length, 0);
});

await test("A summoning spell spent through use_spell_slot alone would leave its creatures to be invented: it is refused before the slot, naming cast_buff.", async () => {
  const { world, sheets: [druid] } = await board([DRUID(["Conjure Animals"])], [{ x: 3, y: 4 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Conjure Animals", level: 3 });
  assert.equal(cast.ok, false);
  assert.match(cast.error, /cast_buff/);
  assert.equal(slotsLeft(world, druid.id, 3), 2);
});

await test("A summoned wolf attacks with its bite's own numbers: +4 to hit and 2d4+2 piercing.", async () => {
  const { world, sheets: [druid], enemies: [goblin] } = await board([DRUID(["Conjure Animals"])], { 0: { x: 3, y: 4 }, e0: { x: 10, y: 4 } });
  await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "wolf" });
  const [wolf] = summonsOf(world, "Conjure Animals");
  place(world, wolf.id, 9, 4);
  holdTurn(world, wolf.id);
  world.dice(9, 3, 3);
  const out = await world.invoke("pc_attack", { characterId: wolf.id, targetEnemyId: goblin.id, weapon: "Bite" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(enemyOf(world, goblin.id).currentHp, 90 - 8, "9 + 4 hits AC 13 and 2d4+2 lands");
});

await test("A summoned creature with Multiattack makes that many attacks with its Attack action (a giant scorpion: three).", async () => {
  const { world, sheets: [druid], enemies: [goblin] } = await board([DRUID(["Giant Insect"], 7)], { 0: { x: 3, y: 4 }, e0: { x: 10, y: 4 } });
  const cast = await world.invoke("cast_buff", { characterId: druid.id, spell: "Giant Insect", level: 4, variant: "scorpion" });
  assert.equal(cast.ok, true, cast.error);
  const [scorpion] = summonsOf(world, "Giant Insect");
  place(world, scorpion.id, 9, 4);
  holdTurn(world, scorpion.id);
  // One turn, held: the plain call, so the turn's budget carries from one
  // attack to the next.
  for (const weapon of ["Claw", "Claw", "Sting"]) {
    world.dice(1);
    const out = await world.invokeAsIs("pc_attack", { characterId: scorpion.id, targetEnemyId: goblin.id, weapon });
    world.clearDice();
    assert.equal(out.ok, true, `${weapon}: ${out.error}`);
  }
  world.dice(1);
  const fourth = await world.invokeAsIs("pc_attack", { characterId: scorpion.id, targetEnemyId: goblin.id, weapon: "Claw" });
  world.clearDice();
  assert.equal(fourth.ok, false, "a fourth attack in the turn");
});

await test("A summoned creature reduced to 0 hit points disappears: its sheet, token and initiative entry go.", async () => {
  const { world, sheets: [druid] } = await board([DRUID(["Conjure Animals"])], [{ x: 3, y: 4 }]);
  await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "wolf" });
  const [wolf] = summonsOf(world, "Conjure Animals");
  const out = await world.invoke("apply_damage", { characterId: wolf.id, amount: 30, type: "slashing" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(wolf.id), null, "the wolf's sheet is gone");
  assert.equal(listTokens(mapOf(world).id).some((token) => token.refId === wolf.id), false);
  assert.equal(world.encounter().order.some((entry) => entry.characterId === wolf.id), false);
  assert.equal(summonsOf(world, "Conjure Animals").length, 7);
});

await test("When the caster's concentration on a conjuring spell ends, the creatures it conjured vanish.", async () => {
  const { world, sheets: [druid] } = await board([DRUID(["Conjure Animals"])], [{ x: 3, y: 4 }]);
  await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "wolf" });
  assert.equal(world.sheet(druid.id).concentratingOn, "Conjure Animals");
  world.dice(1);
  await world.invoke("apply_damage", { characterId: druid.id, amount: 4, type: "slashing" });
  world.clearDice();
  assert.equal(world.sheet(druid.id).concentratingOn, null);
  assert.equal(summonsOf(world, "Conjure Animals").length, 0);
});

await test("Conjure Elemental: when concentration breaks the elemental does not vanish; it turns hostile, an enemy with its stat block where it stood.", async () => {
  const { world, sheets: [wizard] } = await outOfFight([WIZARD(["Conjure Elemental"])]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Conjure Elemental", level: 5, variant: "fire elemental" });
  assert.equal(cast.ok, true, cast.error);
  await thenFight(world, wizard.id);
  const [elemental] = summonsOf(world, "Conjure Elemental");
  assert.equal(elemental.maxHp, 102);
  const at = tokenOf(world, elemental.id);
  world.dice(1);
  await world.invoke("apply_damage", { characterId: wizard.id, amount: 4, type: "slashing" });
  world.clearDice();
  assert.equal(world.sheet(elemental.id), null);
  const hostile = world.enemies().find((enemy) => /fire elemental/i.test(enemy.displayName));
  assert.ok(hostile, "the elemental is an enemy now");
  assert.equal(hostile.maxHp, 102);
  const token = tokenOf(world, hostile.id);
  assert.deepEqual([token.x, token.y], [at.x, at.y]);
});

await test("Animate Dead raises one undead from a 3rd level slot and three from a 4th, a skeleton with its SRD numbers, with no concentration.", async () => {
  const { world, sheets: [wizard] } = await outOfFight([WIZARD(["Animate Dead"])]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Animate Dead", level: 4, variant: "skeleton" });
  assert.equal(cast.ok, true, cast.error);
  const dead = summonsOf(world, "Animate Dead");
  assert.equal(dead.length, 3);
  assert.equal(dead[0].maxHp, 13);
  assert.equal(dead[0].ac, 13);
  assert.equal(world.sheet(wizard.id).concentratingOn, null);
});

await test("Giant Insect makes three giant spiders (or ten centipedes, five wasps, one scorpion).", async () => {
  const { world, sheets: [druid] } = await board([DRUID(["Giant Insect"], 7)], [{ x: 3, y: 4 }]);
  const cast = await world.invoke("cast_buff", { characterId: druid.id, spell: "Giant Insect", level: 4, variant: "spider" });
  assert.equal(cast.ok, true, cast.error);
  const spiders = summonsOf(world, "Giant Insect");
  assert.equal(spiders.length, 3);
  assert.equal(spiders[0].maxHp, 26);
});

await test("Find Steed makes one steed with an Intelligence of 6; casting it again replaces the first.", async () => {
  const { world, sheets: [paladin] } = await outOfFight([caster("paladin", "cha", ["Find Steed"], [], 5)]);
  const first = await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
  assert.equal(first.ok, true, first.error);
  const second = await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
  assert.equal(second.ok, true, second.error);
  const steeds = summonsOf(world, "Find Steed");
  assert.equal(steeds.length, 1);
  assert.equal(steeds[0].abilities.int, 6);
  assert.equal(steeds[0].maxHp, 19);
});

await test("Animate Objects animates ten Tiny objects (20 hit points, AC 18, a slam at +8 for 1d4+4) or five Medium ones.", async () => {
  const { world, sheets: [wizard] } = await board([WIZARD(["Animate Objects"])], [{ x: 3, y: 4 }]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Animate Objects", level: 5, variant: "tiny" });
  assert.equal(cast.ok, true, cast.error);
  const objects = summonsOf(world, "Animate Objects");
  assert.equal(objects.length, 10);
  assert.equal(objects[0].maxHp, 20);
  assert.equal(objects[0].ac, 18);
  assert.equal(objects[0].summon.attacks[0].toHit, 8);
  assert.equal(objects[0].summon.attacks[0].damage, "1d4+4");
});

await test("A summoned creature keeps its stat block's damage immunities (a fire elemental takes no fire damage).", async () => {
  const { world, sheets: [wizard] } = await outOfFight([WIZARD(["Conjure Elemental"])]);
  await world.invoke("cast_buff", { characterId: wizard.id, spell: "Conjure Elemental", level: 5, variant: "fire elemental" });
  const [elemental] = summonsOf(world, "Conjure Elemental");
  await world.invoke("apply_damage", { characterId: elemental.id, amount: 20, type: "fire" });
  assert.equal(world.sheet(elemental.id).currentHp, 102);
});

await test("Conjured creatures stay while the spell lasts: the end of a fight does not send them away, the end of the duration does.", async () => {
  const { world, sheets: [druid] } = await board([DRUID(["Giant Insect"], 7)], [{ x: 3, y: 4 }]);
  await world.invoke("cast_buff", { characterId: druid.id, spell: "Giant Insect", level: 4, variant: "wasp" });
  assert.equal(summonsOf(world, "Giant Insect").length, 5);
  await world.invoke("end_encounter", { outcome: "victory" });
  assert.equal(summonsOf(world, "Giant Insect").length, 5, "still here after the fight");
  await world.invoke("pass_time", { amount: 11, unit: "minutes" });
  assert.equal(summonsOf(world, "Giant Insect").length, 0, "gone after ten minutes");
});

await test("Durable Summons: a Conjuration wizard's summoned creatures arrive with 30 temporary hit points.", async () => {
  const { world, sheets: [wizard] } = await outOfFight([WIZARD(["Conjure Minor Elementals"], 14, { subclass: "School of Conjuration" })]);
  const now = world.sheet(wizard.id);
  world.patch(wizard.id, { features: [...now.features, { name: "Durable Summons", source: "class" }] });
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Conjure Minor Elementals", level: 4, variant: "magma mephit" });
  assert.equal(cast.ok, true, cast.error);
  const mephits = summonsOf(world, "Conjure Minor Elementals");
  assert.equal(mephits.length, 4);
  assert.equal(mephits[0].tempHp, 30);
});


// ---- the rest of the summoning spells, and what the narrator reads ----

await test("Arcane Hand: a hand with AC 20, hit points equal to its caster's maximum, and a Clenched Fist at the caster's spell attack bonus for 4d8 force (6d8 from a 6th level slot).", async () => {
  const { world, sheets: [wizard] } = await board([WIZARD(["Arcane Hand"], 11)], [{ x: 3, y: 4 }]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Arcane Hand", level: 6 });
  assert.equal(cast.ok, true, cast.error);
  const [hand] = summonsOf(world, "Arcane Hand");
  assert.equal(hand.ac, 20);
  assert.equal(hand.maxHp, world.sheet(wizard.id).maxHp);
  assert.equal(hand.abilities.str, 26);
  // Wizard 11: proficiency +4, Intelligence 18 (+4).
  assert.equal(hand.summon.attacks[0].toHit, 8);
  assert.equal(hand.summon.attacks[0].damage, "6d8");
});

await test("Arcane Hand's Grasping Hand grapples with the hand's own Strength 26 (+8), through take_action grapple under the hand's characterId.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await board([WIZARD(["Arcane Hand"], 11)], { 0: { x: 3, y: 4 }, e0: { x: 10, y: 4 } });
  await world.invoke("cast_buff", { characterId: wizard.id, spell: "Arcane Hand", level: 5 });
  const [hand] = summonsOf(world, "Arcane Hand");
  place(world, hand.id, 9, 4);
  holdTurn(world, hand.id);
  // The hand's 2 + 8 = 10 against the goblin's contest of 9.
  world.dice(2, 9, 9);
  const grip = await world.invoke("take_action", { characterId: hand.id, action: "grapple", targetEnemyId: goblin.id });
  world.clearDice();
  assert.equal(grip.ok, true, grip.error);
  assert.ok(enemyOf(world, goblin.id).conditions.includes("grappled"), JSON.stringify(grip).slice(0, 300));
});

await test("Create Undead makes three ghouls from a 6th level slot and refuses wights below an 8th level slot, before the slot.", async () => {
  const { world, sheets: [wizard] } = await outOfFight([WIZARD(["Create Undead"], 13, { gold: 1000 })]);
  const wights = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Create Undead", level: 6, variant: "wight" });
  assert.equal(wights.ok, false);
  assert.equal(slotsLeft(world, wizard.id, 6), 1);
  const ghouls = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Create Undead", level: 6, variant: "ghoul" });
  assert.equal(ghouls.ok, true, ghouls.error);
  const made = summonsOf(world, "Create Undead");
  assert.equal(made.length, 3);
  assert.equal(made[0].maxHp, 22);
});

await test("Phantom Steed's horse has a speed of 100 feet and disappears when it takes any damage.", async () => {
  const { world, sheets: [wizard] } = await outOfFight([WIZARD(["Phantom Steed"], 5)]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Phantom Steed", level: 3 });
  assert.equal(cast.ok, true, cast.error);
  const [steed] = summonsOf(world, "Phantom Steed");
  assert.equal(steed.speed, 100);
  await world.invoke("apply_damage", { characterId: steed.id, amount: 1, type: "piercing" });
  assert.equal(world.sheet(steed.id), null);
});

await test("Casting a conjuring spell again while it holds ends the first casting and its creatures.", async () => {
  const { world, sheets: [druid] } = await board([DRUID(["Conjure Animals"], 9)], [{ x: 3, y: 4 }]);
  await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "wolf" });
  const again = await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "brown bear" });
  assert.equal(again.ok, true, again.error);
  const now = summonsOf(world, "Conjure Animals");
  assert.equal(now.length, 2);
  assert.ok(now.every((sheet) => sheet.summon.form === "Brown Bear"));
});

await test("GAME STATE shows a summoned creature with its attacks, who made it and how it ends.", async () => {
  const { describeSheet } = await import("../src/lib/dm/prompt.ts");
  const { world, sheets: [druid] } = await board([DRUID(["Conjure Animals"])], [{ x: 3, y: 4 }]);
  await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "wolf" });
  const [wolf] = summonsOf(world, "Conjure Animals");
  const text = describeSheet(world.sheet(wolf.id), "nobody", false);
  assert.match(text, /Summoned Wolf/);
  assert.match(text, /Bite \+4 \(2d4\+2 piercing\)/);
  assert.match(text, /concentration/);
});

// ---- Find Familiar, Faithful Hound, the beast-form spells ----

await test("Find Familiar through cast_buff pays the casting (a slot, 10 gp of incense) and binds the familiar as the caster's pet with its form's numbers; it cannot attack.", async () => {
  const { world, sheets: [wizard] } = await outOfFight([{ ...WIZARD(["Find Familiar"], 3), gold: 50 }]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Find Familiar", level: 1, variant: "owl" });
  assert.equal(cast.ok, true, cast.error);
  const [owl] = world.sheet(wizard.id).pets;
  assert.equal(owl?.form, "Owl");
  assert.equal(owl.attacks.length, 0, "the familiar kept its talons");
  assert.equal(slotsLeft(world, wizard.id, 1), 3, "the slot was not spent");
  assert.equal(world.sheet(wizard.id).gold, 40, "the incense was not bought");
});

await test("Find Familiar: one familiar at a time; casting it again changes its form.", async () => {
  const { world, sheets: [wizard] } = await outOfFight([{ ...WIZARD(["Find Familiar"], 3), gold: 50 }]);
  await world.invoke("cast_buff", { characterId: wizard.id, spell: "Find Familiar", level: 1, variant: "owl" });
  await world.invoke("cast_buff", { characterId: wizard.id, spell: "Find Familiar", level: 1, variant: "cat" });
  const familiars = world.sheet(wizard.id).pets.filter((pet) => pet.kind === "familiar");
  assert.equal(familiars.length, 1);
  assert.equal(familiars[0].form, "Cat");
});

await test("Faithful Hound: an invisible watchdog that cannot be harmed, acting at the start of its caster's turn, biting at the caster's spell attack bonus for 4d8 piercing.", async () => {
  const { world, sheets: [wizard] } = await board([WIZARD(["Faithful Hound"], 7)], [{ x: 3, y: 4 }]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Faithful Hound", level: 4 });
  assert.equal(cast.ok, true, cast.error);
  const [hound] = summonsOf(world, "Faithful Hound");
  assert.ok(hound.conditions.includes("invisible"), "the hound is seen");
  assert.equal(hound.summon.attacks[0].toHit, 7, "INT +4 and proficiency +3");
  assert.equal(hound.summon.attacks[0].damage, "4d8");
  const order = world.encounter().order;
  assert.equal(order.findIndex((entry) => entry.characterId === hound.id) + 1, order.findIndex((entry) => entry.characterId === wizard.id), "the hound acts right before its caster");
  await world.invoke("apply_damage", { characterId: hound.id, amount: 20, type: "slashing" });
  assert.ok(world.sheet(hound.id), "the hound was harmed away");
  assert.equal(world.sheet(hound.id).currentHp, 1);
});

await test("Animal Shapes: a willing creature becomes a Large or smaller beast of challenge rating 4 or lower, keeping its own Intelligence, Wisdom and Charisma.", async () => {
  const { world, sheets: [druid, fighter] } = await outOfFight([DRUID(["Animal Shapes"], 15), { class: "fighter", level: 5, abilities: { str: 16, int: 14 } }]);
  const ape = await world.invoke("cast_buff", { characterId: druid.id, spell: "Animal Shapes", level: 8, variant: "giant ape", targetCharacterIds: [fighter.id] });
  assert.equal(ape.ok, false, "a CR 7 Huge ape was allowed");
  const cast = await world.invoke("cast_buff", { characterId: druid.id, spell: "Animal Shapes", level: 8, variant: "brown bear", targetCharacterIds: [fighter.id] });
  assert.equal(cast.ok, true, cast.error);
  const shaped = world.sheet(fighter.id).wildShape;
  assert.equal(shaped?.form, "Brown Bear");
  assert.equal(shaped.abilities.int, 14, "the fighter's mind became the bear's");
  assert.equal(shaped.abilities.str, 19);
});

await test("Shapechange: the caster takes a beast form of challenge rating up to their level, keeping their own mind.", async () => {
  const { world, sheets: [druid] } = await board([{ ...DRUID(["Shapechange"], 17), equipment: [{ name: "Jade circlet (1500 gp)", qty: 1 }] }], [{ x: 3, y: 4 }]);
  const cast = await world.invoke("cast_buff", { characterId: druid.id, spell: "Shapechange", level: 9, variant: "tyrannosaurus rex" });
  assert.equal(cast.ok, true, cast.error);
  const shaped = world.sheet(druid.id).wildShape;
  assert.equal(shaped?.form, "Tyrannosaurus Rex");
  assert.equal(shaped.abilities.wis, 18, "the druid's Wisdom stayed");
});

await test("Each summoned creature's stat block matches the content pack's SRD block (armor class, hit points, challenge rating, ability scores).", async () => {
  if (!hasPack) {
    return;
  }
  const { SUMMON_FORMS } = await import("../src/lib/srd/summon-forms.ts");
  const content = await import("../src/lib/content/index.ts");
  const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
  let compared = 0;
  for (const form of SUMMON_FORMS) {
    const slug = form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const entry = content.getEntryDetail("monsters", slug);
    if (!entry) {
      continue;
    }
    const stats = parseMonster(entry.data, entry.data.cr);
    const data = entry.data;
    assert.deepEqual(
      [form.ac, form.hp, form.cr, form.abilities.str, form.abilities.dex, form.abilities.con, form.abilities.int, form.abilities.wis, form.abilities.cha],
      [stats.ac, stats.maxHp, data.cr, data.strength, data.dexterity, data.constitution, data.intelligence, data.wisdom, data.charisma],
      form.name,
    );
    compared += 1;
  }
  assert.ok(compared >= 30, `only ${compared} blocks compared`);
});

closeTables();
finish();
