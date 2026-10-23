// True Polymorph and Shapechange give any creature the spell allows, not a
// beast alone, and a Circle of the Moon druid of 10th level becomes an
// elemental (issue 480). Polymorph, Animal Shapes and Wild Shape stay beasts.
//
// The rules, from SRD 5.1 (the Circle of the Moon from the Player's Handbook):
//   - True Polymorph, creature into creature: "the new form can be any kind
//     you choose whose challenge rating is equal to or less than the
//     target's (or its level, if the target doesn't have a challenge
//     rating)"; its game statistics, mental scores included, are replaced.
//   - Shapechange: "any creature with a challenge rating equal to your level
//     or lower. The creature can't be a construct or an undead", "without
//     ... the Spellcasting trait"; the caster keeps INT, WIS and CHA, keeps
//     their proficiencies and gains the creature's, and "can't use any
//     legendary actions".
//   - Elemental Wild Shape (Circle of the Moon, 10th level): "expend two uses
//     of Wild Shape at the same time to transform into an air elemental, an
//     earth elemental, a fire elemental, or a water elemental".
//   - Fire Elemental: AC 13, 102 hit points, resistant to nonmagical
//     bludgeoning, piercing and slashing, immune to fire and poison, and to
//     being grappled. Earth Elemental: AC 17, 126 hit points, the same
//     resistances. Ogre: a Large giant, AC 11, 59 hit points, a greatclub.
//     Adult Red Dragon: CR 17, saving throws Dex +6, Con +13, Wis +7, Cha +11.
//
// Every check reads a sheet, an enemy row or a refusal; dice are forced.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { caster, closeTables, enemyOf, table } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-enforce-shape-forms");
const { computeSheetDerived } = await import("../src/lib/srd/index.ts");

const slotsOf = (sheet) => JSON.stringify(sheet.spellcasting.slots);

// ---- True Polymorph ----

await test("True Polymorph turns a 17th level fighter into a fire elemental: its block, its immunity to fire and its resistance to a nonmagical blade, and no grapple holds it.", async () => {
  const world = await openWorld();
  const wizard = world.addHero(caster("wizard", "int", ["True Polymorph"], [], 17));
  const fighter = world.addHero({ class: "fighter", level: 17, maxHp: 150 });
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "True Polymorph", level: 9, variant: "fire elemental", targetCharacterIds: [fighter.id] });
  assert.equal(cast.ok, true, cast.error);
  const shape = world.sheet(fighter.id).wildShape;
  assert.deepEqual([shape.form, shape.type, shape.beastHp, shape.beastAc, shape.abilities.dex, shape.abilities.int], ["Fire Elemental", "elemental", 102, 13, 17, 6]);
  await world.invoke("apply_damage", { characterId: fighter.id, amount: 12, type: "fire" });
  assert.equal(world.sheet(fighter.id).wildShape.beastHp, 102, "the fire elemental took fire damage");
  await world.invoke("apply_damage", { characterId: fighter.id, amount: 10, type: "slashing" });
  assert.equal(world.sheet(fighter.id).wildShape.beastHp, 97, "a nonmagical blade was not halved");
  await world.invoke("set_condition", { characterId: fighter.id, condition: "grappled" });
  assert.ok(!world.sheet(fighter.id).conditions.includes("grappled"), "the fire elemental was grappled");
});

await test("True Polymorph holds the form to the target's level, and Polymorph still gives only a beast: a 5th level fighter is refused a young red dragon (CR 10) and an ogre by Polymorph, nothing spent.", async () => {
  const world = await openWorld();
  const archmage = world.addHero(caster("wizard", "int", ["True Polymorph"], [], 17));
  const mage = world.addHero(caster("wizard", "int", ["Polymorph"], [], 9));
  const fighter = world.addHero({ class: "fighter", level: 5, maxHp: 44 });
  const before = [slotsOf(world.sheet(archmage.id)), slotsOf(world.sheet(mage.id))];
  const dragon = await world.invoke("cast_buff", { characterId: archmage.id, spell: "True Polymorph", level: 9, variant: "young red dragon", targetCharacterIds: [fighter.id] });
  assert.equal(dragon.ok, false);
  assert.match(dragon.error, /CR 10, above the CR 5/);
  const ogre = await world.invoke("cast_buff", { characterId: mage.id, spell: "Polymorph", level: 4, variant: "ogre", targetCharacterIds: [fighter.id] });
  assert.equal(ogre.ok, false);
  assert.match(ogre.error, /Ogre is a giant, not a beast/);
  assert.deepEqual([slotsOf(world.sheet(archmage.id)), slotsOf(world.sheet(mage.id))], before);
  assert.equal(world.sheet(fighter.id).wildShape, null);
  // The same fighter becomes an ogre (CR 2) under True Polymorph.
  const giant = await world.invoke("cast_buff", { characterId: archmage.id, spell: "True Polymorph", level: 9, variant: "ogre", targetCharacterIds: [fighter.id] });
  assert.equal(giant.ok, true, giant.error);
  assert.deepEqual(world.sheet(fighter.id).wildShape.attacks.map((attack) => attack.name), ["Greatclub", "Javelin"]);
});

await test("True Polymorph at a CR 2 creature makes it an ogre on a failed save, a giant with the ogre's block; an owlbear (CR 3) is refused before the slot.", async () => {
  const { world, sheets: [wizard], enemies: [dummy] } = await table([caster("wizard", "int", ["True Polymorph"], [], 17)], 1, { cr: 2, xp: 450 });
  const before = slotsOf(world.sheet(wizard.id));
  const owlbear = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: dummy.id, spell: "True Polymorph", saveAbility: "wis", variant: "owlbear" });
  assert.equal(owlbear.ok, false);
  assert.match(owlbear.error, /Owlbear is CR 3, above the CR 2/);
  assert.equal(slotsOf(world.sheet(wizard.id)), before);
  world.dice(1);
  const out = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: dummy.id, spell: "True Polymorph", saveAbility: "wis", variant: "ogre" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.saved, false);
  const ogre = enemyOf(world, dummy.id);
  assert.deepEqual([ogre.stats.type, ogre.stats.size, ogre.maxHp, ogre.ac], ["giant", "Large", 59, 11]);
  assert.deepEqual(ogre.stats.attacks.map((attack) => attack.name), ["Greatclub", "Javelin"]);
});

// ---- Shapechange ----

// The jade circlet worth 1,500 gp the spell's material asks for.
const CIRCLET = { maxHp: 90, equipment: [{ name: "Jade circlet", qty: 1, worth: 1500 }] };

await test("Shapechange at 17th level takes an adult red dragon (CR 17): the dragon's body and immunity to fire, the wizard's mind, the dragon's saving throws, and no legendary actions.", async () => {
  const world = await openWorld();
  const wizard = world.addHero(caster("wizard", "int", ["Shapechange"], [], 17, CIRCLET));
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Shapechange", level: 9, variant: "adult red dragon" });
  assert.equal(cast.ok, true, cast.error);
  assert.match(cast.seen ?? cast.result?.seen ?? "", /has seen/);
  const traits = String(cast.formTraits ?? cast.result?.formTraits ?? "");
  assert.doesNotMatch(traits, /Legendary action/i);
  const sheet = world.sheet(wizard.id);
  assert.deepEqual([sheet.wildShape.form, sheet.wildShape.type, sheet.wildShape.beastHp, sheet.wildShape.abilities.str, sheet.wildShape.abilities.int], ["Adult Red Dragon", "dragon", 256, 27, 18]);
  // Dexterity 10 and a 17th level proficiency bonus of +6: the dragon's
  // Dexterity save, which the wizard gains; their Intelligence, which the
  // dragon's statistics do not touch, is still their own 18.
  const saves = computeSheetDerived(sheet).saves;
  assert.equal(saves.dex, 6);
  assert.equal(computeSheetDerived(sheet).abilityMods.int, 4);
  await world.invoke("apply_damage", { characterId: wizard.id, amount: 30, type: "fire" });
  assert.equal(world.sheet(wizard.id).wildShape.beastHp, 256);
});

await test("Shapechange takes an archmage without its Spellcasting trait, and refuses a construct, an undead and a creature above the caster's level, nothing spent.", async () => {
  const world = await openWorld();
  const wizard = world.addHero(caster("wizard", "int", ["Shapechange"], [], 17, CIRCLET));
  const before = slotsOf(world.sheet(wizard.id));
  for (const [variant, reason] of [["iron golem", /construct/], ["lich", /undead/], ["ancient red dragon", /CR 24, above the CR 17/]]) {
    const out = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Shapechange", level: 9, variant });
    assert.equal(out.ok, false, variant);
    assert.match(out.error, reason);
  }
  assert.equal(slotsOf(world.sheet(wizard.id)), before);
  const archmage = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Shapechange", level: 9, variant: "archmage" });
  assert.equal(archmage.ok, true, archmage.error);
  const traits = String(archmage.formTraits ?? archmage.result?.formTraits ?? "");
  assert.match(traits, /Magic Resistance/);
  assert.doesNotMatch(traits, /Spellcasting/);
});

// ---- Elemental Wild Shape ----

const DRUID = (level, subclass) => ({ class: "druid", subclass, level, maxHp: 70, abilities: { wis: 16 } });

await test("A Circle of the Moon druid of 10th level spends two uses of Wild Shape to become an earth elemental, which halves a nonmagical blow.", async () => {
  const world = await openWorld();
  const druid = world.addHero(DRUID(10, "Circle of the Moon"));
  const out = await world.invoke("use_resource", { characterId: druid.id, resource: "Wild Shape", form: "earth elemental" });
  assert.equal(out.ok, true, out.error);
  const sheet = world.sheet(druid.id);
  assert.deepEqual([sheet.wildShape.form, sheet.wildShape.type, sheet.wildShape.beastHp, sheet.wildShape.beastAc], ["Earth Elemental", "elemental", 126, 17]);
  assert.equal(sheet.resources.wild_shape.used, 2, "Elemental Wild Shape spends two uses");
  await world.invoke("apply_damage", { characterId: druid.id, amount: 10, type: "bludgeoning" });
  assert.equal(world.sheet(druid.id).wildShape.beastHp, 121);
});

await test("Elemental Wild Shape is refused, nothing spent, to a Circle of the Land druid, a 9th level Moon druid, and a Moon druid with one use left.", async () => {
  const world = await openWorld();
  const land = world.addHero(DRUID(10, "Circle of the Land"));
  const young = world.addHero(DRUID(9, "Circle of the Moon"));
  const spent = world.addHero(DRUID(10, "Circle of the Moon"));
  world.patch(spent.id, { resources: { ...world.sheet(spent.id).resources, wild_shape: { max: 2, used: 1 } } });
  for (const [druid, reason] of [[land, /not of the Circle of the Moon/], [young, /10th level/], [spent, /cannot spend 2/]]) {
    const before = JSON.stringify(world.sheet(druid.id).resources);
    const out = await world.invoke("use_resource", { characterId: druid.id, resource: "Wild Shape", form: "fire elemental" });
    assert.equal(out.ok, false, druid.name);
    assert.match(out.error, reason);
    assert.equal(JSON.stringify(world.sheet(druid.id).resources), before);
    assert.equal(world.sheet(druid.id).wildShape, null);
  }
  // Wild Shape itself takes a beast: an ogre of the table is refused, even
  // with numbers sent along for it.
  const ogre = await world.invoke("use_resource", { characterId: land.id, resource: "Wild Shape", form: "ogre", formHp: 59, formAc: 11, formCr: 2 });
  assert.equal(ogre.ok, false);
  assert.match(ogre.error, /Ogre is a giant, not a beast/);
});

closeTables();
finish();
