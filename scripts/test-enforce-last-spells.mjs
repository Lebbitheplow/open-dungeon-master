// The last spell areas and pools the engine did not hold (SRD 5.1, and the
// Abjuration wizard ODM ships):
//   - Arcane Ward: an abjurer's first abjuration spell of 1st level or higher
//     after a long rest raises a ward with hit points of twice the wizard
//     level plus the Intelligence modifier; damage to the wizard lands on the
//     ward first; each later abjuration spell restores twice its level.
//     Projected Ward: the reaction makes the ward absorb the damage a
//     creature within 30 feet takes.
//   - Wind Wall: a Small or smaller flying creature cannot pass through it,
//     and it keeps gases (a drifting cloud) at bay.
//   - Wall of Ice: each 10-foot section has AC 12 and 30 hit points and is
//     vulnerable to fire; a section at 0 leaves a sheet of frigid air, and a
//     creature moving through it for the first time on a turn makes a CON
//     save against 5d6 cold (half on a success).
//   - Earthquake: the area is difficult terrain; when it is cast and at the
//     end of each of the caster's turns every creature on the ground there
//     makes a DEX save or falls prone; fissures open, and a creature standing
//     where one opens makes a DEX save or falls in.
//   - Meteor Swarm: 20d6 fire and 20d6 bludgeoning, each meeting its own
//     resistance.
//
// Every check reads a sheet, the board, an enemy row or a refusal; dice are
// forced.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, enemyOf, FIGHTER } from "./lib/enforce-spell-kit.mjs";
import { board, holdTurn, nextTurn, stride, tokenOf, walk, zonesOf } from "./lib/enforce-zones.mjs";

const encounters = await import("../src/lib/db/encounters.ts");

const { test, finish } = suite("test-enforce-last-spells");

const hp = (world, id) => world.sheet(id).currentHp;

// The pointer moves onto this combatant's turn, as the table moves it.
// The pointer rests only on characters: it is set on the character before
// this one (enemies between are walked past).
function startTurnOf(world, refId) {
  const encounter = world.encounter();
  const { order } = encounter;
  const at = order.findIndex((entry) => entry.characterId === refId);
  let before = at;
  for (let step = 1; step <= order.length; step += 1) {
    const index = (at - step + order.length) % order.length;
    if (order[index].kind === "pc") {
      before = index;
      break;
    }
  }
  encounters.saveEncounter({ ...encounter, turnIndex: before, turnBudget: null });
  nextTurn(world);
}
const ABJURER = (level = 6) =>
  caster("wizard", "int", ["Mage Armor", "Protection from Evil and Good"], [], level, { subclass: "School of Abjuration" });

async function withWardFeatures(world, id, level) {
  const now = world.sheet(id);
  const names = new Set(now.features.map((feature) => feature.name.toLowerCase()));
  const add = [
    ...(names.has("arcane ward") ? [] : [{ name: "Arcane Ward", source: "subclass", classId: "wizard" }]),
    ...(level >= 6 && !names.has("projected ward") ? [{ name: "Projected Ward", source: "subclass", classId: "wizard" }] : []),
  ];
  if (add.length) {
    world.patch(id, { features: [...now.features, ...add] });
  }
}

// ---- Arcane Ward (School of Abjuration) ----

await test("An abjurer's first abjuration spell of 1st level or higher raises an Arcane Ward (twice the wizard level plus the Intelligence modifier), and damage to the wizard lands on the ward first.", async () => {
  const { world, sheets: [wizard] } = await board([ABJURER(6)], [{ x: 3, y: 4 }]);
  await withWardFeatures(world, wizard.id, 6);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Mage Armor", level: 1 });
  assert.equal(cast.ok, true, cast.error);
  const before = hp(world, wizard.id);
  await world.invoke("apply_damage", { characterId: wizard.id, amount: 10, type: "slashing" });
  assert.equal(hp(world, wizard.id), before, "the ward (2 x 6 + 4 = 16) takes the first 10");
  await world.invoke("apply_damage", { characterId: wizard.id, amount: 10, type: "slashing" });
  assert.equal(hp(world, wizard.id), before - 4, "6 left on the ward, 4 come through");
});

await test("The Arcane Ward takes the blow as it lands, without the wizard's own resistance; the wizard's resistance meets only what comes through.", async () => {
  // A tiefling abjurer resists fire. Sage Advice Compendium: the ward does not.
  const { world, sheets: [wizard] } = await board([{ ...ABJURER(6), race: "tiefling" }], [{ x: 3, y: 4 }]);
  await withWardFeatures(world, wizard.id, 6);
  await world.invoke("cast_buff", { characterId: wizard.id, spell: "Mage Armor", level: 1 });
  const before = hp(world, wizard.id);
  const ward = () => world.sheet(wizard.id).resources.sub_arcane_ward;
  await world.invoke("apply_damage", { characterId: wizard.id, amount: 10, type: "fire" });
  assert.equal(ward().max - ward().used, 6, "the ward (16) loses all 10, not a halved 5");
  assert.equal(hp(world, wizard.id), before);
  await world.invoke("apply_damage", { characterId: wizard.id, amount: 10, type: "fire" });
  assert.equal(ward().max - ward().used, 0);
  assert.equal(hp(world, wizard.id), before - 2, "4 come through the ward and the wizard's resistance halves them to 2");
});

await test("Each later abjuration spell of 1st level or higher restores twice its level to the Arcane Ward.", async () => {
  const { world, sheets: [wizard] } = await board([ABJURER(6)], [{ x: 3, y: 4 }]);
  await withWardFeatures(world, wizard.id, 6);
  await world.invoke("cast_buff", { characterId: wizard.id, spell: "Mage Armor", level: 1 });
  await world.invoke("apply_damage", { characterId: wizard.id, amount: 14, type: "slashing" });
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Protection from Evil and Good", level: 3 });
  assert.equal(cast.ok, true, cast.error);
  const before = hp(world, wizard.id);
  await world.invoke("apply_damage", { characterId: wizard.id, amount: 8, type: "slashing" });
  assert.equal(hp(world, wizard.id), before, "2 left + 6 from a 3rd level abjuration = 8 absorbed");
});

await test("Projected Ward: the abjurer's reaction makes the Arcane Ward absorb the damage a creature within 30 feet just took.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await board([ABJURER(6), FIGHTER], { 0: { x: 3, y: 4 }, 1: { x: 6, y: 4 }, e0: { x: 7, y: 4 } });
  await withWardFeatures(world, wizard.id, 6);
  await world.invoke("cast_buff", { characterId: wizard.id, spell: "Mage Armor", level: 1 });
  const before = hp(world, fighter.id);
  world.dice(18, 4);
  const swing = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: fighter.id });
  world.clearDice();
  assert.equal(swing.ok, true, swing.error);
  assert.equal(hp(world, fighter.id), before - 6);
  const ward = await world.invoke("use_reaction", { characterId: wizard.id, feature: "Projected Ward", targetCharacterId: fighter.id });
  assert.equal(ward.ok, true, ward.error);
  assert.equal(hp(world, fighter.id), before, "the ward took the 6");
});

// ---- Wind Wall ----

await test("Wind Wall: a Small or smaller flying creature cannot pass through the wall.", async () => {
  const { world, sheets: [druid], enemies: [sprite] } = await board(
    [caster("druid", "wis", ["Wind Wall"])],
    { 0: { x: 2, y: 8 }, e0: { x: 15, y: 4 } },
    { stats: { size: "Tiny", speed: "40 ft., fly 40 ft." } },
  );
  const cast = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Wind Wall", level: 3, atX: 12, atY: 0, towardX: 12, towardY: 8 });
  assert.equal(cast.ok, true, cast.error);
  await world.invoke("set_movement", { tokenName: sprite.id, movement: "fly" });
  // Its 40 feet would carry it from x 15 to x 9; the wall on x 12 stops it.
  const barred = await stride(world, sprite.id, 9, 4);
  assert.equal(tokenOf(world, sprite.id).x, 13, `the tiny flyer crossed the wind: ${JSON.stringify(barred).slice(0, 200)}`);
});

await test("Wind Wall stops only a Small or smaller flyer: a Medium flyer crosses it.", async () => {
  const { world, sheets: [druid], enemies: [harpy] } = await board(
    [caster("druid", "wis", ["Wind Wall"])],
    { 0: { x: 2, y: 8 }, e0: { x: 15, y: 4 } },
    { stats: { size: "Medium", speed: "40 ft., fly 40 ft." } },
  );
  const cast = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Wind Wall", level: 3, atX: 12, atY: 0, towardX: 12, towardY: 8 });
  assert.equal(cast.ok, true, cast.error);
  await world.invoke("set_movement", { tokenName: harpy.id, movement: "fly" });
  const crossed = await stride(world, harpy.id, 9, 4);
  assert.equal(tokenOf(world, harpy.id).x, 9, JSON.stringify(crossed).slice(0, 300));
});

await test("Wind Wall keeps gases at bay: a drifting cloud stops at the wall.", async () => {
  const { world, sheets: [druid, wizard] } = await board(
    [caster("druid", "wis", ["Wind Wall"]), caster("wizard", "int", ["Cloudkill"], [], 9), FIGHTER],
    [{ x: 20, y: 8 }, { x: 0, y: 4 }, { x: 22, y: 1 }],
  );
  const wall = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Wind Wall", level: 3, atX: 12, atY: 0, towardX: 12, towardY: 8 });
  assert.equal(wall.ok, true, wall.error);
  const cloud = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Cloudkill", level: 5, atX: 6, atY: 4 });
  assert.equal(cloud.ok, true, cloud.error);
  // The wizard's turn starts: the cloud drifts 10 feet away from them, from
  // x 2..10 toward x 4..12, and the wall stands on x 12.
  const reach = (zone) => Math.max(...zone.cells.map((cell) => cell % 24));
  assert.equal(reach(zonesOf(world).find((zone) => zone.spell === "Cloudkill")), 10, "the cloud as cast reaches x 10");
  world.dice(...new Array(20).fill(20));
  startTurnOf(world, wizard.id);
  world.clearDice();
  const kill = zonesOf(world).find((zone) => zone.spell === "Cloudkill");
  assert.ok(kill, "the cloud still stands");
  assert.equal(kill.origin.x, 8, "the cloud drifted");
  assert.ok(kill.cells.every((cell) => cell % 24 < 12), "the cloud crossed the wind wall");
});

// ---- Wall of Ice ----

async function iceWall() {
  const staged = await board([caster("wizard", "int", ["Wall of Ice"], [], 11), FIGHTER], [{ x: 2, y: 8 }, { x: 10, y: 4 }]);
  const cast = await staged.world.invoke("use_spell_slot", { characterId: staged.sheets[0].id, spell: "Wall of Ice", level: 6, atX: 12, atY: 0, towardX: 12, towardY: 8 });
  assert.equal(cast.ok, true, cast.error);
  return staged;
}

await test("Wall of Ice: a 10-foot section has AC 12 and 30 hit points and is vulnerable to fire; a section brought to 0 no longer stands.", async () => {
  const { world, sheets: [, fighter] } = await iceWall();
  const out = await world.invoke("damage_object", { name: "Wall of Ice section 3", damage: "16", damageType: "fire" });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.ac, 12);
  assert.equal(out.result.hp, 30);
  assert.equal(out.result.broken, true, "16 fire is 32 against its 30");
  // The squares either side of the broken section still bar the way.
  assert.ok(zonesOf(world).find((zone) => zone.spell === "Wall of Ice").cells.length > 0, "the rest of the wall stands");
  const through = await walk(world, fighter.id, 14, 4);
  assert.equal(through.status, 200, JSON.stringify(through.body));
});

await test("A broken section of a Wall of Ice leaves frigid air: a creature moving through it for the first time on a turn makes a CON save or takes 5d6 cold (half on a success).", async () => {
  const { world, sheets: [, fighter] } = await iceWall();
  await world.invoke("damage_object", { name: "Wall of Ice section 3", damage: "30", damageType: "bludgeoning" });
  const before = hp(world, fighter.id);
  world.dice(1, 1, 1, 1, 1, 1);
  const through = await walk(world, fighter.id, 14, 4);
  world.clearDice();
  assert.equal(through.status, 200, JSON.stringify(through.body));
  assert.equal(hp(world, fighter.id), before - 5);
});

// ---- Earthquake ----

await test("Earthquake: at the end of each of the caster's turns, each creature on the ground in the area makes a DEX save or falls prone.", async () => {
  const { world, sheets: [cleric, fighter], enemies: [goblin] } = await board(
    [caster("cleric", "wis", ["Earthquake"], [], 15), FIGHTER],
    { 0: { x: 2, y: 8 }, 1: { x: 3, y: 8 }, e0: { x: 12, y: 4 } },
  );
  // The casting: no fissure (one, off the board's squares would be random),
  // every save made.
  world.dice(...new Array(12).fill(20));
  const cast = await world.invoke("use_spell_slot", { characterId: cleric.id, spell: "Earthquake", level: 8, atX: 12, atY: 4 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(zonesOf(world).some((zone) => zone.spell === "Earthquake"), "the area is laid");
  holdTurn(world, cleric.id);
  world.dice(1, 1, 1, 1, 1, 1);
  nextTurn(world);
  world.clearDice();
  assert.ok(enemyOf(world, goblin.id).conditions.includes("prone"), "the goblin kept its feet");
  assert.ok(world.sheet(fighter.id).conditions.includes("prone"));
});

await test("Earthquake's area is difficult terrain.", async () => {
  const { world, sheets: [cleric, fighter] } = await board([caster("cleric", "wis", ["Earthquake"], [], 15), FIGHTER], [{ x: 2, y: 8 }, { x: 6, y: 2 }]);
  world.dice(...new Array(12).fill(20));
  await world.invoke("use_spell_slot", { characterId: cleric.id, spell: "Earthquake", level: 8, atX: 12, atY: 4 });
  world.clearDice();
  const out = await walk(world, fighter.id, 8, 2);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(tokenOf(world, fighter.id).movedThisRound, 4);
});

await test("Earthquake: fissures open at the start of the caster's next turn; a creature standing where one opens makes a DEX save or falls in, taking falling damage for the fissure's depth and landing prone.", async () => {
  const { world, sheets: [cleric], enemies: [goblin] } = await board([caster("cleric", "wis", ["Earthquake"], [], 15), FIGHTER], { 0: { x: 2, y: 8 }, 1: { x: 3, y: 8 }, e0: { x: 12, y: 4 } });
  world.dice(...new Array(12).fill(20));
  const cast = await world.invoke("use_spell_slot", { characterId: cleric.id, spell: "Earthquake", level: 8, atX: 12, atY: 4 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  const before = enemyOf(world, goblin.id).currentHp;
  assert.ok(!enemyOf(world, goblin.id).conditions.includes("prone"), "no fissure opens with the casting");
  // The next round, the cleric's turn starts. One fissure (d6 = 1), running
  // across the area (d2 = 1) through rows 4 and 5 (d9 = 5 of rows 0 to 8),
  // 10 feet deep (d10 = 1): the goblin on row 4 fails its DEX save (1) and
  // falls 10 feet (1d6 = 6).
  const encounter = world.encounter();
  encounters.saveEncounter({ ...encounter, round: encounter.round + 1 });
  world.dice(1, 1, 5, 1, 1, 6);
  startTurnOf(world, cleric.id);
  world.clearDice();
  const goblinNow = enemyOf(world, goblin.id);
  assert.equal(goblinNow.currentHp, before - 6);
  assert.ok(goblinNow.conditions.includes("prone"));
});

// ---- Meteor Swarm ----

await test("Meteor Swarm deals 20d6 fire and 20d6 bludgeoning; a creature resistant to fire halves only the fire.", async () => {
  const { world, sheets: [wizard], enemies: [imp] } = await board([caster("wizard", "int", ["Meteor Swarm"], [], 17)], { 0: { x: 2, y: 8 }, e0: { x: 14, y: 4 } }, { stats: { resist: "fire" } });
  world.dice(1, ...new Array(40).fill(1));
  const out = await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Meteor Swarm", enemyIds: [imp.id], saveAbility: "dex", dc: 18, level: 9 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(enemyOf(world, imp.id).currentHp, 90 - 10 - 20);
});

await test("Flame Strike deals 4d6 fire and 4d6 radiant; a creature resistant to radiant halves only the radiant.", async () => {
  const { world, sheets: [cleric], enemies: [wight] } = await board([caster("cleric", "wis", ["Flame Strike"], [], 9)], { 0: { x: 2, y: 8 }, e0: { x: 8, y: 4 } }, { stats: { resist: "radiant" } });
  const before = enemyOf(world, wight.id).currentHp;
  world.dice(...new Array(9).fill(1));
  const out = await world.invoke("aoe_damage", { casterId: cleric.id, spell: "Flame Strike", enemyIds: [wight.id], saveAbility: "dex", dc: 15, level: 5 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(enemyOf(world, wight.id).currentHp, before - 4 - 2);
});

await test("Ice Storm's hail leaves its area difficult terrain after the blast.", async () => {
  const { world, sheets: [druid, fighter], enemies: [goblin] } = await board([caster("druid", "wis", ["Ice Storm"], [], 9), FIGHTER], { 0: { x: 2, y: 8 }, 1: { x: 10, y: 2 }, e0: { x: 12, y: 4 } });
  world.dice(...new Array(8).fill(20));
  const out = await world.invoke("aoe_damage", { casterId: druid.id, spell: "Ice Storm", enemyIds: [goblin.id], saveAbility: "dex", dc: 15, level: 4, atX: 12, atY: 4 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(zonesOf(world).some((zone) => zone.spell === "Ice Storm"), "the hail lies on the board");
  const walked = await walk(world, fighter.id, 12, 2);
  assert.equal(walked.status, 200, JSON.stringify(walked.body));
  assert.equal(tokenOf(world, fighter.id).movedThisRound, 4, "two squares of difficult ground cost four");
});

await test("damage_object on a Wall of Ice with no section named is refused, listing the sections standing, and rolls nothing.", async () => {
  const { world } = await iceWall();
  const out = await world.invoke("damage_object", { name: "Wall of Ice", damage: "30", damageType: "fire" });
  const error = out.error ?? out.result?.error;
  assert.ok(error, JSON.stringify(out));
  assert.match(error, /section/);
  assert.equal(zonesOf(world).find((zone) => zone.spell === "Wall of Ice").cells.length, 9, "the wall is whole");
});

await test("The frigid air of a broken Wall of Ice section ends when the caster's concentration on the wall ends.", async () => {
  const { world, sheets: [wizard] } = await iceWall();
  await world.invoke("damage_object", { name: "Wall of Ice section 2", damage: "30", damageType: "bludgeoning" });
  assert.ok(zonesOf(world).some((zone) => zone.spell === "Frigid Air"), "the frigid air is laid");
  world.dice(1);
  await world.invoke("apply_damage", { characterId: wizard.id, amount: 10, type: "slashing" });
  world.clearDice();
  assert.equal(world.sheet(wizard.id).concentratingOn ?? null, null, "the wizard lost concentration");
  assert.ok(!zonesOf(world).some((zone) => zone.spell === "Frigid Air" || zone.spell === "Wall of Ice"), "the wall and its frigid air are gone");
});

await test("Earthquake shakes only creatures on the ground: a flying creature does not fall prone.", async () => {
  const { world, sheets: [cleric], enemies: [harpy] } = await board(
    [caster("cleric", "wis", ["Earthquake"], [], 15), FIGHTER],
    { 0: { x: 2, y: 8 }, 1: { x: 3, y: 8 }, e0: { x: 12, y: 4 } },
    { stats: { speed: "20 ft., fly 40 ft." } },
  );
  await world.invoke("set_movement", { tokenName: harpy.id, movement: "fly" });
  world.dice(...new Array(12).fill(1));
  const cast = await world.invoke("use_spell_slot", { characterId: cleric.id, spell: "Earthquake", level: 8, atX: 12, atY: 4 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(!enemyOf(world, harpy.id).conditions.includes("prone"), "the flyer was knocked prone");
  assert.ok(world.sheet(cleric.id).conditions.includes("prone"), "the cleric on the ground was not");
});

closeTables();
finish();
