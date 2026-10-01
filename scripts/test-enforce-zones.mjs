// Persistent spell areas on the battle map (src/lib/battlemap/zones*.ts,
// src/lib/dm/zone*.ts): the ground a spell changes for as long as it lasts,
// read by movement, sight, casting, the turn loop and the narrator.
//
// The rules, from SRD 5.1:
//   - Difficult terrain costs 1 extra foot per foot (Entangle, Web, Grease,
//     Spike Growth, Sleet Storm, Black Tentacles, Insect Plague, Blade
//     Barrier); Plant Growth and Wall of Thorns cost 4 feet per foot; Spirit
//     Guardians halves a hostile creature's speed in its area; Gust of Wind
//     costs 2 feet per foot to move closer to its caster.
//   - A heavily obscured area (Fog Cloud, Stinking Cloud, Cloudkill, Sleet
//     Storm, Incendiary Cloud, magical Darkness) blocks vision entirely: a
//     creature that cannot see its target attacks at disadvantage, and one
//     that cannot be seen attacks with advantage; darkvision does not see
//     through magical darkness, Devil's Sight and truesight do. A creature
//     can try to hide in it. Daylight fills its area with bright light.
//   - Silence: no spell with a verbal component is cast inside it, and a
//     creature entirely inside is immune to thunder damage.
//   - Walls of stone, ice and force stop movement; a Wall of Force does not
//     stop sight. Blade Barrier gives three-quarters cover; Wind Wall makes
//     arrows and bolts shot through it miss.
//   - Damage or a save when a creature enters the area or starts or ends its
//     turn there, as each spell says (Moonbeam, Cloudkill, Spike Growth per 5
//     feet, Grease, Web, Black Tentacles, Stinking Cloud, Sleet Storm, Wall of
//     Fire's hot side, Wall of Thorns, Spirit Guardians, Guardian of Faith).
//   - The area ends with the caster's concentration or its duration.
//
// Every check reads the board, the sheet, the encounter row, the dice rolled
// or a refusal; dice are forced.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";
import { caster, closeTables, enemyOf, FIGHTER } from "./lib/enforce-spell-kit.mjs";
import { board, holdTurn, mapOf, nextTurn, stride, tokenOf, walk, zonesOf } from "./lib/enforce-zones.mjs";

const { test, finish } = suite("test-enforce-zones");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
const encounters = await import("../src/lib/db/encounters.ts");

const moved = (world, refId) => tokenOf(world, refId).movedThisRound;
const hp = (world, id) => world.sheet(id).currentHp;
const BOW = { ...FIGHTER, equipment: [{ name: "Longbow", qty: 1, equipped: true }, { name: "Arrows", qty: 20 }] };

// ---- difficult ground ----

await test("Entangle turns the ground in its 20-foot square into difficult terrain for as long as it lasts.", async () => {
  const { world, sheets: [druid, fighter] } = await board([caster("druid", "wis", ["Entangle"]), FIGHTER], [{ x: 2, y: 6 }, { x: 7, y: 2 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Entangle", level: 1, atX: 12, atY: 2 });
  assert.equal(cast.ok, true, cast.error);
  const out = await walk(world, fighter.id, 11, 2);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(moved(world, fighter.id), 6, "two squares of entangled ground did not cost double");
});

await test("Spike Growth: a creature moving into or within the area takes 2d4 piercing damage for every 5 feet it travels there.", async () => {
  const { world, sheets: [druid, fighter] } = await board([caster("druid", "wis", ["Spike Growth"]), FIGHTER], [{ x: 2, y: 8 }, { x: 8, y: 2 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Spike Growth", level: 2, atX: 14, atY: 2 });
  assert.equal(cast.ok, true, cast.error);
  const before = hp(world, fighter.id);
  world.dice(1, 1, 1, 1);
  const out = await walk(world, fighter.id, 11, 2);
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(hp(world, fighter.id), before - 4, "two squares of spikes did not deal 2d4 each");
});

await test("Plant Growth's overgrowth costs 4 feet of movement for every 1 foot moved through it.", async () => {
  const { world, sheets: [druid, fighter] } = await board([caster("druid", "wis", ["Plant Growth"]), FIGHTER], [{ x: 2, y: 8 }, { x: 8, y: 2 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Plant Growth", level: 3, atX: 14, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  const out = await walk(world, fighter.id, 9, 2);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(moved(world, fighter.id), 4);
});

await test("Spirit Guardians halves the speed of a hostile creature moving in its area.", async () => {
  const { world, sheets: [cleric], enemies: [goblin] } = await board([caster("cleric", "wis", ["Spirit Guardians"])], { 0: { x: 5, y: 2 }, e0: { x: 12, y: 2 } });
  const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Spirit Guardians", level: 3 });
  assert.equal(cast.ok, true, cast.error);
  world.dice(20, 1, 1, 1);
  const out = await stride(world, goblin.id, 6, 2);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.deepEqual([tokenOf(world, goblin.id).x, tokenOf(world, goblin.id).y], [8, 2]);
});

await test("Gust of Wind: a creature in the line spends 2 feet of movement for every 1 foot it moves closer to the caster.", async () => {
  const { world, sheets: [druid], enemies: [goblin] } = await board([caster("druid", "wis", ["Gust of Wind"])], { 0: { x: 4, y: 4 }, e0: { x: 14, y: 4 } });
  // A corridor two squares wide, so the goblin cannot step out of the wind.
  const kit = await combatKit(world);
  kit.openField(Array.from({ length: 24 }, (_, x) => [[x, 3, "#"], [x, 6, "#"]]).flat());
  const cast = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Gust of Wind", level: 2, towardX: 20, towardY: 4 });
  assert.equal(cast.ok, true, cast.error);
  const out = await stride(world, goblin.id, 10, 4);
  assert.equal(out.ok, true, out.error);
  assert.deepEqual([tokenOf(world, goblin.id).x, tokenOf(world, goblin.id).y], [11, 4]);
});

await test("Wall of Thorns: moving through it costs 4 feet per foot, and entering it forces a DEX save against 7d8 slashing.", async () => {
  const { world, sheets: [druid, fighter] } = await board([caster("druid", "wis", ["Wall of Thorns"], [], 11), FIGHTER], [{ x: 2, y: 8 }, { x: 11, y: 4 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Wall of Thorns", level: 6, atX: 12, atY: 0, towardX: 12, towardY: 8 });
  assert.equal(cast.ok, true, cast.error);
  const before = hp(world, fighter.id);
  world.dice(1, 1, 1, 1, 1, 1, 1, 1);
  const out = await walk(world, fighter.id, 13, 4);
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(moved(world, fighter.id), 5, "the thorns did not cost four times");
  assert.equal(hp(world, fighter.id), before - 7);
});

// ---- entering ----

await test("Web: a creature that enters the webs during its turn makes a DEX save or is restrained.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await board([caster("wizard", "int", ["Web"])], { 0: { x: 2, y: 8 }, e0: { x: 18, y: 2 } });
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Web", level: 2, atX: 12, atY: 2 });
  assert.equal(cast.ok, true, cast.error);
  world.dice(1);
  const out = await stride(world, goblin.id, 13, 2);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(enemyOf(world, goblin.id).conditions.includes("restrained"), "the web did not hold it");
});

await test("Spirit Guardians: a hostile creature entering the area for the first time on a turn makes a WIS save against 3d8 radiant.", async () => {
  const { world, sheets: [cleric], enemies: [goblin] } = await board([caster("cleric", "wis", ["Spirit Guardians"])], { 0: { x: 5, y: 2 }, e0: { x: 12, y: 2 } });
  const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Spirit Guardians", level: 3 });
  assert.equal(cast.ok, true, cast.error);
  world.dice(1, 8, 8, 8);
  const out = await stride(world, goblin.id, 8, 2);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(enemyOf(world, goblin.id).currentHp, 90 - 24);
});

await test("Black Tentacles: a creature entering the area makes a DEX save or takes 3d6 bludgeoning and is restrained.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await board([caster("wizard", "int", ["Black Tentacles"])], { 0: { x: 2, y: 8 }, e0: { x: 18, y: 2 } });
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Black Tentacles", level: 4, atX: 12, atY: 2 });
  assert.equal(cast.ok, true, cast.error);
  world.dice(1, 6, 6, 6);
  const out = await stride(world, goblin.id, 13, 2);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const now = enemyOf(world, goblin.id);
  assert.equal(now.currentHp, 90 - 18);
  assert.ok(now.conditions.includes("restrained"));
});

await test("Guardian of Faith: a hostile creature moving within 10 feet makes a DEX save against 20 radiant; the guardian vanishes after dealing 60 damage.", async () => {
  const { world, sheets: [cleric], enemies } = await board([caster("cleric", "wis", ["Guardian of Faith"], [], 9)], { 0: { x: 2, y: 8 }, e0: { x: 20, y: 1 }, e1: { x: 20, y: 4 }, e2: { x: 20, y: 7 } }, { count: 3 });
  const cast = await world.invoke("use_spell_slot", { characterId: cleric.id, spell: "Guardian of Faith", level: 4, atX: 12, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  for (const [index, enemy] of enemies.entries()) {
    world.dice(1);
    const out = await stride(world, enemy.id, 14, [2, 4, 6][index]);
    world.clearDice();
    assert.equal(out.ok, true, out.error);
    assert.equal(enemyOf(world, enemy.id).currentHp, 70, `${enemy.displayName} took no 20 radiant`);
  }
  assert.ok(!(zonesOf(world) ?? []).some((zone) => zone.spell === "Guardian of Faith"), "the guardian did not vanish at 60");
});

// ---- turns starting and ending ----

await test("Moonbeam: a creature that starts its turn in the beam makes a CON save against 2d10 radiant.", async () => {
  const { world, sheets: [druid, fighter], enemies: [goblin] } = await board([caster("druid", "wis", ["Moonbeam"]), FIGHTER], { 0: { x: 2, y: 4 }, 1: { x: 4, y: 8 }, e0: { x: 14, y: 4 } });
  const cast = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Moonbeam", level: 2, atX: 14, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  holdTurn(world, fighter.id);
  world.dice(1, 5, 5);
  nextTurn(world);
  world.clearDice();
  assert.equal(enemyOf(world, goblin.id).currentHp, 80);
});

await test("Cloudkill: a creature that starts its turn in the cloud makes a CON save against 5d8 poison, a character's save on the record.", async () => {
  const { world, sheets: [wizard, fighter] } = await board([caster("wizard", "int", ["Cloudkill"]), FIGHTER], [{ x: 2, y: 4 }, { x: 14, y: 4 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Cloudkill", level: 5, atX: 14, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  const before = hp(world, fighter.id);
  holdTurn(world, wizard.id);
  world.dice(1, 1, 1, 1, 1, 1);
  nextTurn(world);
  world.clearDice();
  assert.equal(hp(world, fighter.id), before - 5);
});

await test("Stinking Cloud: a creature starting its turn in the cloud makes a CON save or spends its action retching.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await board([caster("wizard", "int", ["Stinking Cloud"]), FIGHTER], { 0: { x: 2, y: 4 }, 1: { x: 4, y: 8 }, e0: { x: 14, y: 4 } });
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Stinking Cloud", level: 3, atX: 14, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  holdTurn(world, fighter.id);
  world.dice(1);
  nextTurn(world);
  world.clearDice();
  assert.ok(enemyOf(world, goblin.id).conditions.includes("retching"));
});

await test("Sleet Storm: a creature starting its turn in the storm makes a DEX save or falls prone.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await board([caster("wizard", "int", ["Sleet Storm"]), FIGHTER], { 0: { x: 2, y: 4 }, 1: { x: 4, y: 8 }, e0: { x: 16, y: 4 } });
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Sleet Storm", level: 3, atX: 16, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  holdTurn(world, fighter.id);
  world.dice(1);
  nextTurn(world);
  world.clearDice();
  assert.ok(enemyOf(world, goblin.id).conditions.includes("prone"));
});

await test("Grease: a creature that ends its turn in the area makes a DEX save or falls prone.", async () => {
  const { world, sheets: [wizard, fighter] } = await board([caster("wizard", "int", ["Grease"]), FIGHTER], [{ x: 2, y: 4 }, { x: 10, y: 4 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Grease", level: 1, atX: 10, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  holdTurn(world, fighter.id);
  world.dice(1);
  nextTurn(world);
  world.clearDice();
  assert.ok(world.sheet(fighter.id).conditions.includes("prone"));
});

await test("Wall of Fire: a creature ending its turn within 10 feet of the wall's burning side takes 5d8 fire.", async () => {
  const { world, sheets: [wizard, fighter] } = await board([caster("wizard", "int", ["Wall of Fire"]), FIGHTER], [{ x: 4, y: 4 }, { x: 13, y: 4 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Wall of Fire", level: 4, atX: 12, atY: 0, towardX: 12, towardY: 8 });
  assert.equal(cast.ok, true, cast.error);
  const before = hp(world, fighter.id);
  holdTurn(world, fighter.id);
  world.dice(1, 1, 1, 1, 1);
  nextTurn(world);
  world.clearDice();
  assert.equal(hp(world, fighter.id), before - 5);
});

await test("Cloudkill moves 10 feet away from its caster at the start of each of the caster's turns.", async () => {
  const { world, sheets: [wizard, fighter] } = await board([caster("wizard", "int", ["Cloudkill"]), FIGHTER], [{ x: 4, y: 4 }, { x: 2, y: 8 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Cloudkill", level: 5, atX: 12, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  holdTurn(world, fighter.id);
  nextTurn(world);
  world.clearDice();
  const cloud = zonesOf(world).find((zone) => zone.spell === "Cloudkill");
  assert.deepEqual(cloud.origin, { x: 14, y: 4 });
});

// ---- sight ----

await test("Fog Cloud heavily obscures its area: attacking a creature inside it that the attacker cannot see is at disadvantage.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await board(
    [caster("wizard", "int", ["Fog Cloud"]), FIGHTER],
    { 0: { x: 2, y: 8 }, 1: { x: 9, y: 4 }, e0: { x: 10, y: 4 } },
    { stats: { senses: { blindsight: 30, passivePerception: 10 } } },
  );
  const kit = await combatKit(world);
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Fog Cloud", level: 1, atX: 14, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  const swing = await kit.swing(fighter.id, goblin.id, [10, 10, 4]);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.toHit?.breakdown?.terms?.find((term) => term.sides === 20)?.dice?.length, 2);
});

await test("A creature inside a Fog Cloud is not seen by a character outside it: the board does not show it.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await board([caster("wizard", "int", ["Fog Cloud"]), FIGHTER], { 0: { x: 2, y: 8 }, 1: { x: 4, y: 4 }, e0: { x: 14, y: 4 } });
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Fog Cloud", level: 1, atX: 14, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  const view = buildPlayerMapView(world.campaignId, world.sheet(fighter.id).userId);
  assert.ok(!view.tokens.some((token) => token.refId === goblin.id), "the goblin in the fog is on the board");
});

await test("Magical Darkness: Devil's Sight sees through it, and a creature inside it that cannot see the attacker gives the attacker advantage.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await board([caster("wizard", "int", ["Darkness"]), FIGHTER], { 0: { x: 2, y: 8 }, 1: { x: 9, y: 4 }, e0: { x: 10, y: 4 } });
  world.patch(fighter.id, { features: [...world.sheet(fighter.id).features, { name: "Devil's Sight", description: "" }] });
  const kit = await combatKit(world);
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Darkness", level: 2, atX: 10, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  const swing = await kit.swing(fighter.id, goblin.id, [10, 10, 4]);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.toHit?.breakdown?.terms?.find((term) => term.sides === 20)?.dice?.length, 2);
});

await test("Daylight fills its area with bright light: on a dark board a character without darkvision sees a creature standing in it.", async () => {
  const { world, sheets: [cleric, fighter], enemies: [goblin] } = await board(
    [caster("cleric", "wis", ["Daylight"]), FIGHTER],
    { 0: { x: 2, y: 8 }, 1: { x: 11, y: 4 }, e0: { x: 12, y: 4 } },
    { ambient: "dark", stats: { senses: { darkvision: 60, passivePerception: 10 } } },
  );
  const kit = await combatKit(world);
  const cast = await world.invoke("use_spell_slot", { characterId: cleric.id, spell: "Daylight", level: 3, atX: 12, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  const swing = await kit.swing(fighter.id, goblin.id, [10, 4]);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.toHit?.breakdown?.terms?.find((term) => term.sides === 20)?.dice?.length, 1);
});

await test("Daylight overlapping an area of darkness made by a spell of 3rd level or lower dispels that spell.", async () => {
  const { world, sheets: [sorcerer, cleric] } = await board([caster("sorcerer", "cha", ["Darkness"]), caster("cleric", "wis", ["Daylight"])], [{ x: 2, y: 8 }, { x: 4, y: 8 }]);
  const dark = await world.invoke("use_spell_slot", { characterId: sorcerer.id, spell: "Darkness", level: 2, atX: 12, atY: 4 });
  assert.equal(dark.ok, true, dark.error);
  assert.ok(zonesOf(world).some((zone) => zone.spell === "Darkness"));
  const light = await world.invoke("use_spell_slot", { characterId: cleric.id, spell: "Daylight", level: 3, atX: 14, atY: 4 });
  assert.equal(light.ok, true, light.error);
  assert.ok(!zonesOf(world).some((zone) => zone.spell === "Darkness"));
  assert.equal(world.sheet(sorcerer.id).concentratingOn ?? null, null);
});

await test("A creature in a heavily obscured area may hide from a watcher whose view it blocks.", async () => {
  const { world, sheets: [wizard, rogue] } = await board(
    [caster("wizard", "int", ["Fog Cloud"]), { ...FIGHTER, class: "rogue" }],
    { 0: { x: 2, y: 8 }, 1: { x: 14, y: 4 }, e0: { x: 4, y: 4 } },
  );
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Fog Cloud", level: 1, atX: 14, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  holdTurn(world, rogue.id);
  world.dice(20);
  const out = await world.invoke("take_action", { characterId: rogue.id, action: "hide" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
});

// ---- silence ----

await test("Silence: a spell with a verbal component cannot be cast from inside it; nothing is spent.", async () => {
  const { world, sheets: [cleric, wizard] } = await board([caster("cleric", "wis", ["Silence"]), caster("wizard", "int", ["Magic Missile"])], [{ x: 2, y: 8 }, { x: 12, y: 4 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: cleric.id, spell: "Silence", level: 2, atX: 12, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  const slots = JSON.stringify(world.sheet(wizard.id).spellcasting.slots);
  const out = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Magic Missile", level: 1 });
  assert.equal(out.ok, false, "a verbal spell was cast inside Silence");
  assert.equal(JSON.stringify(world.sheet(wizard.id).spellcasting.slots), slots);
});

await test("Silence: a creature entirely inside the sphere is immune to thunder damage.", async () => {
  const { world, sheets: [cleric, wizard], enemies: [goblin] } = await board([caster("cleric", "wis", ["Silence"]), caster("wizard", "int", ["Shatter"])], { 0: { x: 2, y: 8 }, 1: { x: 4, y: 4 }, e0: { x: 12, y: 4 } });
  const cast = await world.invoke("use_spell_slot", { characterId: cleric.id, spell: "Silence", level: 2, atX: 12, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  world.dice(1, 8, 8, 8);
  const out = await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Shatter", enemyIds: [goblin.id], saveAbility: "con", dc: 15, level: 2 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(enemyOf(world, goblin.id).currentHp, 90);
});

await test("Silence: a creature inside it is deafened and hears nothing, so a notice check by hearing fails.", async () => {
  const { world, sheets: [cleric, fighter] } = await board([caster("cleric", "wis", ["Silence"]), FIGHTER], [{ x: 2, y: 8 }, { x: 12, y: 4 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: cleric.id, spell: "Silence", level: 2, atX: 12, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  const notice = await world.invoke("check_notice", { characterIds: [fighter.id], dc: 1, by: "hearing" });
  assert.equal(notice.ok, true, notice.error);
  assert.deepEqual(notice.result.missedBy, [world.sheet(fighter.id).name]);
});

// ---- walls ----

await test("Walls of stone and ice stop movement: nobody walks through them.", async () => {
  for (const spell of ["Wall of Stone", "Wall of Ice"]) {
    const { world, sheets: [wizard, fighter] } = await board([caster("wizard", "int", [spell], [], 11), FIGHTER], [{ x: 2, y: 8 }, { x: 10, y: 4 }]);
    const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell, level: spell === "Wall of Ice" ? 6 : 5, atX: 12, atY: 0, towardX: 12, towardY: 8 });
    assert.equal(cast.ok, true, cast.error);
    const out = await walk(world, fighter.id, 14, 4);
    assert.ok(out.status >= 400, `${spell} was walked through`);
  }
});

await test("Wall of Force: nothing passes through it, and it does not block sight.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await board([caster("wizard", "int", ["Wall of Force"]), FIGHTER], { 0: { x: 2, y: 8 }, 1: { x: 10, y: 4 }, e0: { x: 16, y: 4 } });
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Wall of Force", level: 5, atX: 12, atY: 0, towardX: 12, towardY: 8 });
  assert.equal(cast.ok, true, cast.error);
  const out = await walk(world, fighter.id, 14, 4);
  assert.ok(out.status >= 400, "the wall of force was walked through");
  const view = buildPlayerMapView(world.campaignId, world.sheet(fighter.id).userId);
  assert.ok(view.tokens.some((token) => token.refId === goblin.id), "the wall of force hid the goblin");
});

await test("Blade Barrier gives three-quarters cover (+5 AC) to a creature behind it.", async () => {
  const { world, sheets: [cleric, fighter], enemies: [goblin] } = await board([caster("cleric", "wis", ["Blade Barrier"], [], 11), BOW], { 0: { x: 2, y: 8 }, 1: { x: 8, y: 4 }, e0: { x: 16, y: 4 } });
  const kit = await combatKit(world);
  const cast = await world.invoke("use_spell_slot", { characterId: cleric.id, spell: "Blade Barrier", level: 6, atX: 12, atY: 0, towardX: 12, towardY: 8 });
  assert.equal(cast.ok, true, cast.error);
  const swing = await kit.swing(fighter.id, goblin.id, [11, 4]);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.damage, null, "an arrow at 16 hit AC 13 behind three-quarters cover");
});

await test("Wind Wall: arrows and bolts shot at a target behind the wall miss.", async () => {
  const { world, sheets: [druid, fighter], enemies: [goblin] } = await board([caster("druid", "wis", ["Wind Wall"]), BOW], { 0: { x: 2, y: 8 }, 1: { x: 8, y: 4 }, e0: { x: 16, y: 4 } });
  const kit = await combatKit(world);
  const cast = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Wind Wall", level: 3, atX: 12, atY: 0, towardX: 12, towardY: 8 });
  assert.equal(cast.ok, true, cast.error);
  await kit.swing(fighter.id, goblin.id, [20, 8, 8]);
  assert.equal(enemyOf(world, goblin.id).currentHp, 90);
});

// ---- ending ----

await test("A concentration spell's area ends when the caster's concentration does.", async () => {
  const { world, sheets: [druid, fighter] } = await board([caster("druid", "wis", ["Entangle", "Spike Growth"]), FIGHTER], [{ x: 2, y: 8 }, { x: 7, y: 2 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Entangle", level: 1, atX: 12, atY: 2 });
  assert.equal(cast.ok, true, cast.error);
  assert.ok(zonesOf(world).some((zone) => zone.spell === "Entangle"));
  const next = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Spike Growth", level: 2, atX: 20, atY: 8 });
  assert.equal(next.ok, true, next.error);
  assert.ok(!zonesOf(world).some((zone) => zone.spell === "Entangle"), "Entangle's ground outlived its concentration");
  const out = await walk(world, fighter.id, 11, 2);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(moved(world, fighter.id), 4);
});

await test("Grease (no concentration) lasts 1 minute: 10 rounds, then its area is gone.", async () => {
  const { world, sheets: [wizard, fighter] } = await board([caster("wizard", "int", ["Grease"]), FIGHTER], [{ x: 2, y: 4 }, { x: 2, y: 8 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Grease", level: 1, atX: 12, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  assert.ok(zonesOf(world).some((zone) => zone.spell === "Grease"));
  const encounter = world.encounter();
  encounters.saveEncounter({ ...encounter, round: encounter.round + 10 });
  holdTurn(world, fighter.id);
  nextTurn(world);
  world.clearDice();
  assert.ok(!zonesOf(world).some((zone) => zone.spell === "Grease"));
});

// ---- what the table and the narrator see ----

await test("The board a player sees carries each spell area with its squares, so the screen can draw it.", async () => {
  const { world, sheets: [wizard, fighter] } = await board([caster("wizard", "int", ["Web"]), FIGHTER], [{ x: 2, y: 8 }, { x: 4, y: 4 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Web", level: 2, atX: 12, atY: 2 });
  assert.equal(cast.ok, true, cast.error);
  const view = buildPlayerMapView(world.campaignId, world.sheet(fighter.id).userId);
  const web = (view.spellZones ?? []).find((zone) => zone.spell === "Web");
  assert.ok(web, "no Web on the board");
  assert.ok(web.cells.includes(2 * 24 + 12));
});

await test("GAME STATE lists each spell area with what it does, so the narrator sees it.", async () => {
  const { world, sheets: [wizard] } = await board([caster("wizard", "int", ["Web"])], [{ x: 2, y: 8 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Web", level: 2, atX: 12, atY: 2 });
  assert.equal(cast.ok, true, cast.error);
  const { serializeMapForPrompt } = await import("../src/lib/battlemap/serialize.ts");
  const maps = await import("../src/lib/db/battle-maps.ts");
  const map = mapOf(world);
  const text = serializeMapForPrompt({ ...map, terrain: map.drawnTerrain }, maps.listTokens(map.id));
  assert.match(text, /Web[^\n]*difficult terrain/);
});

// ---- more of the same areas ----

await test("Insect Plague's area is difficult terrain, and a creature ending its turn there makes a CON save against 4d10 piercing.", async () => {
  const { world, sheets: [wizard, fighter] } = await board([caster("cleric", "wis", ["Insect Plague"]), FIGHTER], [{ x: 2, y: 8 }, { x: 8, y: 2 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Insect Plague", level: 5, atX: 14, atY: 2 });
  assert.equal(cast.ok, true, cast.error);
  // Entering the swarm is a save of its own: made, for half of 4.
  world.dice(20, 1, 1, 1, 1);
  const out = await walk(world, fighter.id, 11, 2);
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(moved(world, fighter.id), 5, "the swarm's ground did not cost double");
  const before = hp(world, fighter.id);
  holdTurn(world, fighter.id);
  world.dice(1, 1, 1, 1, 1);
  nextTurn(world);
  world.clearDice();
  assert.equal(hp(world, fighter.id), before - 4);
});

await test("Incendiary Cloud: a creature entering it makes a DEX save against 10d8 fire.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await board([caster("wizard", "int", ["Incendiary Cloud"], [], 15)], { 0: { x: 2, y: 8 }, e0: { x: 20, y: 2 } }, { stats: { maxHp: 200 } });
  encounters.patchEnemyHp(goblin.id, 200, "alive");
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Incendiary Cloud", level: 8, atX: 12, atY: 2 });
  assert.equal(cast.ok, true, cast.error);
  world.dice(1, ...new Array(10).fill(2));
  const out = await stride(world, goblin.id, 16, 2);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(enemyOf(world, goblin.id).currentHp, 200 - 20);
});

await test("Blade Barrier: a creature entering the wall makes a DEX save against 6d10 slashing.", async () => {
  const { world, sheets: [cleric], enemies: [goblin] } = await board([caster("cleric", "wis", ["Blade Barrier"], [], 11)], { 0: { x: 2, y: 8 }, e0: { x: 15, y: 4 } });
  const cast = await world.invoke("use_spell_slot", { characterId: cleric.id, spell: "Blade Barrier", level: 6, atX: 12, atY: 0, towardX: 12, towardY: 8 });
  assert.equal(cast.ok, true, cast.error);
  world.dice(1, ...new Array(6).fill(3));
  const out = await stride(world, goblin.id, 11, 4);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(enemyOf(world, goblin.id).currentHp, 90 - 18);
});

await test("Sleet Storm: a creature concentrating in the storm when its turn starts makes a CON save or loses the spell.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await board([caster("wizard", "int", ["Sleet Storm"]), FIGHTER], { 0: { x: 2, y: 4 }, 1: { x: 4, y: 8 }, e0: { x: 16, y: 4 } });
  encounters.setEnemyConcentration(goblin.id, "Hold Person");
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Sleet Storm", level: 3, atX: 16, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  holdTurn(world, fighter.id);
  world.dice(1, 1);
  nextTurn(world);
  world.clearDice();
  assert.equal(enemyOf(world, goblin.id).concentration ?? null, null);
});

await test("Moonbeam's beam moves when its caster moves it (the spell again on a later turn): the old square is no longer in it.", async () => {
  const { world, sheets: [druid], enemies: [first, second] } = await board([caster("druid", "wis", ["Moonbeam"])], { 0: { x: 2, y: 4 }, e0: { x: 10, y: 2 }, e1: { x: 16, y: 6 } }, { count: 2 });
  world.dice(20, 1, 1);
  const cast = await world.invoke("aoe_damage", { casterId: druid.id, spell: "Moonbeam", enemyIds: [first.id], saveAbility: "con", dc: 15, level: 2 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  const beam = () => zonesOf(world).find((zone) => zone.spell === "Moonbeam");
  assert.ok(beam().cells.includes(2 * 24 + 10));
  world.dice(20, 1, 1);
  const again = await world.invoke("aoe_damage", { casterId: druid.id, spell: "Moonbeam", enemyIds: [second.id], saveAbility: "con", dc: 15, level: 2 });
  world.clearDice();
  assert.equal(again.ok, true, again.error);
  assert.ok(beam().cells.includes(6 * 24 + 16) && !beam().cells.includes(2 * 24 + 10));
  assert.equal(zonesOf(world).filter((zone) => zone.spell === "Moonbeam").length, 1);
});

await test("Spirit Guardians moves with its caster: after the cleric moves, the aura is around the cleric's new square.", async () => {
  const { world, sheets: [cleric], enemies: [goblin] } = await board([caster("cleric", "wis", ["Spirit Guardians"])], { 0: { x: 2, y: 2 }, e0: { x: 14, y: 2 } });
  const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Spirit Guardians", level: 3 });
  assert.equal(cast.ok, true, cast.error);
  const moved = await walk(world, cleric.id, 7, 2);
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  world.dice(20, 1, 1, 1);
  const out = await stride(world, goblin.id, 9, 2);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  // Two squares in the aura around (7,2): (10,2) and (9,2) cost double.
  assert.deepEqual([tokenOf(world, goblin.id).x, tokenOf(world, goblin.id).y], [10, 2]);
});

await test("Magical Darkness: a character with darkvision on a dark board does not see a creature standing inside it.", async () => {
  const { world, sheets: [wizard, dwarf], enemies: [goblin] } = await board(
    [caster("wizard", "int", ["Darkness"]), { ...FIGHTER, race: "hill_dwarf" }],
    { 0: { x: 2, y: 8 }, 1: { x: 6, y: 4 }, e0: { x: 12, y: 4 } },
    { ambient: "dark" },
  );
  const seen = () => buildPlayerMapView(world.campaignId, world.sheet(dwarf.id).userId).tokens.some((token) => token.refId === goblin.id);
  assert.ok(seen(), "the dwarf did not see the goblin in plain darkness");
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Darkness", level: 2, atX: 12, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  assert.ok(!seen(), "darkvision saw into magical darkness");
});

await test("Gust of Wind disperses a fog cloud its line crosses.", async () => {
  const { world, sheets: [wizard, druid] } = await board([caster("wizard", "int", ["Fog Cloud"]), caster("druid", "wis", ["Gust of Wind"])], [{ x: 2, y: 8 }, { x: 4, y: 4 }]);
  const fog = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Fog Cloud", level: 1, atX: 14, atY: 4 });
  assert.equal(fog.ok, true, fog.error);
  assert.ok(zonesOf(world).some((zone) => zone.spell === "Fog Cloud"));
  const gust = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Gust of Wind", level: 2, towardX: 20, towardY: 4 });
  assert.equal(gust.ok, true, gust.error);
  assert.ok(!zonesOf(world).some((zone) => zone.spell === "Fog Cloud"));
});

await test("A Wall of Stone blocks sight: an arrow cannot be shot at a creature behind it, and the board does not show it.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await board([caster("wizard", "int", ["Wall of Stone"]), BOW], { 0: { x: 2, y: 8 }, 1: { x: 8, y: 4 }, e0: { x: 16, y: 4 } });
  const kit = await combatKit(world);
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Wall of Stone", level: 5, atX: 12, atY: 0, towardX: 12, towardY: 8 });
  assert.equal(cast.ok, true, cast.error);
  const swing = await kit.swing(fighter.id, goblin.id, [20, 8]);
  assert.equal(swing.ok, false, "an arrow flew through a wall of stone");
  const view = buildPlayerMapView(world.campaignId, world.sheet(fighter.id).userId);
  assert.ok(!view.tokens.some((token) => token.refId === goblin.id));
});

await test("Guardian of Faith strikes only creatures hostile to its caster: an ally walking by takes nothing.", async () => {
  const { world, sheets: [cleric, fighter] } = await board([caster("cleric", "wis", ["Guardian of Faith"], [], 9), FIGHTER], [{ x: 2, y: 8 }, { x: 8, y: 4 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: cleric.id, spell: "Guardian of Faith", level: 4, atX: 12, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  assert.ok(zonesOf(world).some((zone) => zone.spell === "Guardian of Faith"));
  const before = hp(world, fighter.id);
  world.dice(1);
  const out = await walk(world, fighter.id, 11, 4);
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(hp(world, fighter.id), before);
});

await test("The rules and tools the model reads say where a spell's area is laid (atX/atY, towardX/towardY) and that the server applies it.", async () => {
  const { encounterRulesText } = await import("../src/lib/dm/prompt.ts");
  const rules = encounterRulesText(false);
  for (const phrase of ["Spell areas", "atX/atY", "towardX/towardY", "Silence", "concentration or its duration"]) {
    assert.ok(rules.includes(phrase), `the rules never mention ${phrase}`);
  }
  const { aoeDamageTool } = await import("../src/lib/dm/aoe-damage-tool.ts");
  const { castAtEnemyTool } = await import("../src/lib/dm/cast-tools.ts");
  const { mutationTools } = await import("../src/lib/dm/mutations.ts");
  const slotTool = mutationTools.find((tool) => tool.function.name === "use_spell_slot");
  for (const tool of [aoeDamageTool, castAtEnemyTool, slotTool]) {
    for (const key of ["atX", "atY", "towardX", "towardY"]) {
      assert.ok(tool.function.parameters.properties[key], `${tool.function.name} offers no ${key}`);
    }
  }
});

await test("Web: fire burns away the web around a creature it strikes, freeing it, and the burning cube deals 2d4 fire to a creature starting its turn in it.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await board([caster("wizard", "int", ["Web"]), FIGHTER], { 0: { x: 2, y: 8 }, 1: { x: 4, y: 8 }, e0: { x: 12, y: 2 } });
  world.dice(1);
  const cast = await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Web", enemyIds: [goblin.id], saveAbility: "dex", dc: 15, level: 2, atX: 12, atY: 2 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(enemyOf(world, goblin.id).conditions.includes("restrained"));
  const oil = await world.invoke("damage_enemy", { enemyId: goblin.id, amount: 3, type: "fire", source: "hazard" });
  assert.equal(oil.ok, true, oil.error);
  assert.ok(!enemyOf(world, goblin.id).conditions.includes("restrained"), "the burnt web still holds it");
  const before = enemyOf(world, goblin.id).currentHp;
  holdTurn(world, fighter.id);
  world.dice(2, 2);
  nextTurn(world);
  world.clearDice();
  assert.equal(enemyOf(world, goblin.id).currentHp, before - 4);
});

await test("An enemy's spell that only lays an area (Darkness) is cast through aoe_damage with no targets: the area is on the board, held by the enemy's concentration.", async () => {
  const { world, enemies: [mage] } = await board([FIGHTER], { 0: { x: 4, y: 4 }, e0: { x: 16, y: 4 } }, { stats: { spells: ["Darkness"] } });
  const out = await world.invoke("aoe_damage", { casterEnemyId: mage.id, spell: "Darkness", saveAbility: "dex", dc: 10, atX: 10, atY: 4 });
  assert.equal(out.ok, true, out.error);
  const dark = (zonesOf(world) ?? []).find((zone) => zone.spell === "Darkness");
  assert.ok(dark, "no darkness on the board");
  assert.equal(dark.casterKind, "enemy");
  assert.equal(enemyOf(world, mage.id).concentration, "Darkness");
});

await test("A creature standing in a lightly obscured area (Web) makes Wisdom (Perception) checks by sight at disadvantage, and its passive Perception is 5 lower.", async () => {
  const { world, sheets: [wizard, fighter] } = await board([caster("wizard", "int", ["Web"]), FIGHTER], [{ x: 2, y: 8 }, { x: 12, y: 2 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Web", level: 2, atX: 12, atY: 2 });
  assert.equal(cast.ok, true, cast.error);
  world.diceLog();
  world.dice(15, 3);
  const roll = await world.invoke("request_roll", { characterId: fighter.id, kind: "skill_check", skill: "perception", reason: "listen at the web", dc: 10 });
  world.clearDice();
  assert.equal(roll.ok, true, roll.error);
  assert.equal(world.diceLog().filter((die) => die.sides === 20).length, 2, "the Perception check in the web was not at disadvantage");
  const passive = 10 + Math.floor((world.sheet(fighter.id).abilities.wis - 10) / 2);
  const notice = await world.invoke("check_notice", { characterIds: [fighter.id], dc: passive });
  assert.equal(notice.ok, true, notice.error);
  assert.deepEqual(notice.result.missedBy, [world.sheet(fighter.id).name]);
});

await test("Passwall opens a passage through a wall: a creature walks through where the rock was.", async () => {
  const { world, sheets: [wizard, fighter] } = await board([caster("wizard", "int", ["Passwall"]), FIGHTER], [{ x: 2, y: 8 }, { x: 10, y: 4 }]);
  const kit = await combatKit(world);
  kit.openField(Array.from({ length: 9 }, (_, y) => [12, y, "#"]));
  const blocked = await walk(world, fighter.id, 14, 4);
  assert.ok(blocked.status >= 400, "the rock was walked through before any passage");
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Passwall", level: 5, atX: 12, atY: 4, towardX: 16, towardY: 4 });
  assert.equal(cast.ok, true, cast.error);
  const out = await walk(world, fighter.id, 14, 4);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(moved(world, fighter.id), 4);
});

await test("Light makes the caster's held object shed bright light 20 feet: on a dark board the caster sees the creature beside them.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await board(
    [caster("wizard", "int", [], ["Light"], 9, { equipment: [{ name: "Dagger", qty: 1, equipped: true }] })],
    { 0: { x: 11, y: 4 }, e0: { x: 12, y: 4 } },
    { ambient: "dark", stats: { senses: { darkvision: 60, passivePerception: 10 } } },
  );
  const kit = await combatKit(world);
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Light", level: 0 });
  assert.equal(cast.ok, true, cast.error);
  kit.freshTurn();
  const swing = await kit.swing(wizard.id, goblin.id, [10, 2]);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.toHit?.breakdown?.terms?.find((term) => term.sides === 20)?.dice?.length, 1);
  // Continual Flame is the same light, and it does not burn down.
  world.patch(wizard.id, {
    spellcasting: { ...world.sheet(wizard.id).spellcasting, prepared: ["Continual Flame"] },
    equipment: [...world.sheet(wizard.id).equipment, { name: "Ruby dust worth 50 gp", qty: 1 }],
  });
  const flame = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Continual Flame", level: 2 });
  assert.equal(flame.ok, true, flame.error);
  assert.equal(tokenOf(world, wizard.id).lightRadius, 4);
  assert.equal(tokenOf(world, wizard.id).burnsUntil, 0);
});

await test("Globe of Invulnerability: a spell of 5th level or lower cast from outside has no effect on a creature inside it; a character's is refused before anything is spent.", async () => {
  const { world, sheets: [wizard], enemies: [mage] } = await board(
    [caster("wizard", "int", ["Hold Person", "Fireball"], ["Fire Bolt"])],
    { 0: { x: 4, y: 4 }, e0: { x: 14, y: 4 } },
    { stats: { spells: ["Globe of Invulnerability"] } },
  );
  const globe = await world.invoke("aoe_damage", { casterEnemyId: mage.id, spell: "Globe of Invulnerability", saveAbility: "dex", dc: 10 });
  assert.equal(globe.ok, true, globe.error);
  assert.ok((zonesOf(world) ?? []).some((zone) => zone.spell === "Globe of Invulnerability"), "no globe on the board");
  const slots = JSON.stringify(world.sheet(wizard.id).spellcasting.slots);
  const hold = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: mage.id, spell: "Hold Person", saveAbility: "wis", level: 2 });
  assert.equal(hold.ok, false, "Hold Person reached through the globe");
  const bolt = await world.invoke("pc_attack", { characterId: wizard.id, targetEnemyId: mage.id, enemyId: mage.id, spell: "Fire Bolt" });
  assert.equal(bolt.ok, false, "Fire Bolt reached through the globe");
  world.dice(1, 6, 6, 6, 6, 6, 6, 6, 6);
  const ball = await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Fireball", enemyIds: [mage.id], saveAbility: "dex", dc: 15, level: 3 });
  world.clearDice();
  assert.equal(enemyOf(world, mage.id).currentHp, 90, "Fireball burned a creature inside the globe");
  assert.equal(ball.ok, false, "a Fireball that could catch only the shielded mage was cast");
  assert.equal(JSON.stringify(world.sheet(wizard.id).spellcasting.slots), slots);
});

// ---- guards ----

await test("With no battle map, a spell with an area is cast as before and lays nothing.", async () => {
  const { table } = await import("./lib/enforce-spell-kit.mjs");
  const { world, sheets: [druid] } = await table([caster("druid", "wis", ["Entangle"])]);
  const out = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Entangle", level: 1, atX: 3, atY: 3 });
  assert.equal(out.ok, true, out.error);
  assert.equal(mapOf(world), null);
});

closeTables();
finish();
