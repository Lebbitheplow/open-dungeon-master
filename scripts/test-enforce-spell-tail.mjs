// The spells the second spells audit left PARTIAL (/tmp/odm-enf2/reports/
// spells.md Appendix A) whose narrated part is a number or a state the engine
// has a place for: the riders of save spells (a push, a disadvantage, a
// shrunken maximum, a lost action), conditions with their effects, and the
// spells whose one casting reaches several creatures.
//
// SRD 5.1 as printed. Dice forced; every check reads the stored sheet, the
// encounter row, the board, the dice rolled, or a refusal.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { layMap } from "./lib/enforce-spells.mjs";
import { caster, closeTables, enemyOf, field, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";
import { d20s, enemySwing, nextTurn, squareOf } from "./lib/enforce-spell-tail.mjs";

const { test, finish } = suite("test-enforce-spell-tail");
const encounters = await import("../src/lib/db/encounters.ts");
const { effectiveSpeed } = await import("../src/lib/dm/condition-logic.ts");

// ---- pushes ----

await test("A creature that fails its save against Thunderwave is pushed 10 feet away from the caster.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Thunderwave"])]);
  await layMap(world, field(), { [wizard.id]: { x: 5, y: 2 }, [goblin.id]: { x: 6, y: 2 } });
  world.dice(4, 4, 1);
  const out = await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Thunderwave", enemyIds: [goblin.id], saveAbility: "con", dc: 15, level: 1 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(squareOf(world, goblin.id), [8, 2]);
});

await test("A creature in Gust of Wind's line that fails its Strength save is pushed 15 feet away from the caster.", async () => {
  const { world, sheets: [druid], enemies: [goblin] } = await table([caster("druid", "wis", ["Gust of Wind"])]);
  await layMap(world, field(), { [druid.id]: { x: 5, y: 2 }, [goblin.id]: { x: 7, y: 2 } });
  world.dice(1);
  const out = await world.invoke("aoe_damage", { casterId: druid.id, spell: "Gust of Wind", enemyIds: [goblin.id], saveAbility: "str", dc: 15, level: 2 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(squareOf(world, goblin.id), [10, 2]);
});

// ---- riders on a failed save ----

await test("A creature that fails its save against Vicious Mockery has disadvantage on the next attack roll it makes before the end of its next turn, and that attack spends it.", async () => {
  const { world, sheets: [bard, fighter], enemies: [goblin] } = await table([caster("bard", "cha", [], ["Vicious Mockery"]), FIGHTER]);
  world.dice(1, 2);
  const out = await world.invoke("cast_at_enemy", { characterId: bard.id, targetEnemyId: goblin.id, spell: "Vicious Mockery", saveAbility: "wis" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  world.diceLog();
  world.dice(10, 10, 1);
  await enemySwing(world, goblin.id, fighter.id);
  world.clearDice();
  assert.equal(d20s(world.diceLog()), 2);
  assert.ok(!enemyOf(world, goblin.id).conditions.some((name) => name.startsWith("mocked")));
});

await test("Harm cannot drop its target below 1 hit point, and a failed save shrinks its hit point maximum by the necrotic damage it took.", async () => {
  const { world, sheets: [cleric], enemies: [ogre] } = await table([caster("cleric", "wis", ["Harm"], [], 11)]);
  encounters.patchEnemyHp(ogre.id, 50, "alive");
  world.dice(1, ...new Array(14).fill(6));
  const out = await world.invoke("cast_at_enemy", { characterId: cleric.id, targetEnemyId: ogre.id, spell: "Harm", saveAbility: "con", level: 6 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const now = enemyOf(world, ogre.id);
  assert.equal(now.currentHp, 1);
  assert.equal(now.status, "alive");
  assert.equal(now.maxHp, 90 - 49);
});

await test("A creature that keeps hold of Heat Metal's object (armor it cannot drop) has disadvantage on its attack rolls until the start of the caster's next turn.", async () => {
  const { world, sheets: [druid, fighter], enemies: [goblin] } = await table([caster("druid", "wis", ["Heat Metal"]), FIGHTER]);
  world.dice(4, 4, 20);
  const out = await world.invoke("cast_at_enemy", { characterId: druid.id, targetEnemyId: goblin.id, spell: "Heat Metal", condition: "armor", saveAbility: "con", level: 2 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  world.diceLog();
  world.dice(10, 10, 1);
  await enemySwing(world, goblin.id, fighter.id);
  world.clearDice();
  assert.equal(d20s(world.diceLog()), 2);
});

await test("A creature the caster's party is fighting makes its save against Charm Person with advantage.", async () => {
  const { world, sheets: [bard], enemies: [goblin] } = await table([caster("bard", "cha", ["Charm Person"])]);
  world.diceLog();
  world.dice(1, 1);
  await world.invoke("cast_at_enemy", { characterId: bard.id, targetEnemyId: goblin.id, spell: "Charm Person", saveAbility: "wis", level: 1 });
  world.clearDice();
  assert.equal(d20s(world.diceLog()), 2);
});

await test("Charm Person ends early when the caster or a companion harms the charmed creature.", async () => {
  const { world, sheets: [bard, fighter], enemies: [goblin] } = await table([caster("bard", "cha", ["Charm Person"]), FIGHTER]);
  world.dice(1, 1);
  await world.invoke("cast_at_enemy", { characterId: bard.id, targetEnemyId: goblin.id, spell: "Charm Person", saveAbility: "wis", level: 1 });
  world.clearDice();
  assert.ok(enemyOf(world, goblin.id).conditions.includes("charmed"));
  world.dice(15, 4);
  await world.invoke("pc_attack", { characterId: fighter.id, targetEnemyId: goblin.id, weapon: "Longsword" });
  world.clearDice();
  assert.ok(!enemyOf(world, goblin.id).conditions.includes("charmed"));
});

await test("Command's Grovel lays the target prone and Halt leaves it unable to act on its turn.", async () => {
  const { world, sheets: [cleric, fighter], enemies: [a, b] } = await table([caster("cleric", "wis", ["Command"]), FIGHTER], 2);
  world.dice(1);
  await world.invoke("cast_at_enemy", { characterId: cleric.id, targetEnemyId: a.id, spell: "Command", condition: "grovel", saveAbility: "wis", level: 1 });
  world.clearDice();
  assert.ok(enemyOf(world, a.id).conditions.includes("prone"));
  const { freshTurn } = await import("./lib/enforce-spells.mjs");
  await freshTurn(world);
  world.dice(1);
  await world.invoke("cast_at_enemy", { characterId: cleric.id, targetEnemyId: b.id, spell: "Command", condition: "halt", saveAbility: "wis", level: 1 });
  world.clearDice();
  const swing = await enemySwing(world, b.id, fighter.id);
  assert.equal(swing.ok, false, "a halted creature attacks nobody");
});

await test("A creature that fails its save against Suggestion follows the course of action until the spell ends or the party damages it.", async () => {
  const { world, sheets: [bard], enemies: [goblin] } = await table([caster("bard", "cha", ["Suggestion"])]);
  world.dice(1);
  await world.invoke("cast_at_enemy", { characterId: bard.id, targetEnemyId: goblin.id, spell: "Suggestion", saveAbility: "wis", level: 2 });
  world.clearDice();
  const meta = enemyOf(world, goblin.id).conditionMeta.suggested;
  assert.equal(meta?.spell, "Suggestion");
  assert.equal(meta?.endsOnDamage, true);
});

await test("A creature that fails its save against Levitate rises off the ground and cannot walk anywhere: its speed is 0.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Levitate"])]);
  world.dice(1);
  await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Levitate", saveAbility: "con", level: 2 });
  world.clearDice();
  const conditions = enemyOf(world, goblin.id).conditions;
  assert.ok(conditions.includes("levitating"));
  assert.equal(effectiveSpeed(conditions, 30), 0);
});

// ---- one casting, several creatures ----

await test("Chain Lightning strikes its target and up to three more creatures from one casting; a fifth is refused before the slot.", async () => {
  const { world, sheets: [wizard], enemies } = await table([caster("wizard", "int", ["Chain Lightning"], [], 11)], 5);
  const refused = await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Chain Lightning", enemyIds: enemies.map((enemy) => enemy.id), saveAbility: "dex", dc: 15, level: 6 });
  assert.equal(refused.ok, false);
  assert.equal(world.sheet(wizard.id).spellcasting.slots["6"].used, 0);
  world.dice(...new Array(10).fill(1), 1, 1, 1, 1);
  const out = await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Chain Lightning", enemyIds: enemies.slice(0, 4).map((enemy) => enemy.id), saveAbility: "dex", dc: 15, level: 6 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(wizard.id).spellcasting.slots["6"].used, 1);
});

await test("Acid Splash's second target must stand within 5 feet of the first.", async () => {
  const { world, sheets: [wizard], enemies: [a, b] } = await table([caster("wizard", "int", [], ["Acid Splash"])], 2);
  await layMap(world, field(), { [wizard.id]: { x: 2, y: 2 }, [a.id]: { x: 6, y: 2 }, [b.id]: { x: 10, y: 2 } });
  const out = await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Acid Splash", enemyIds: [a.id, b.id], saveAbility: "dex", dc: 15 });
  assert.equal(out.ok, false);
  assert.equal(enemyOf(world, b.id).currentHp, enemyOf(world, b.id).maxHp);
});

// ---- conditions that hold on and hurt ----

await test("Black Tentacles restrains and deals 3d6 bludgeoning on a failed save, and a creature it holds takes 3d6 again at the start of its turn.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Black Tentacles"])]);
  world.dice(1, 1, 1, 1);
  const out = await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Black Tentacles", enemyIds: [goblin.id], saveAbility: "dex", dc: 15, level: 4 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(enemyOf(world, goblin.id).conditions.includes("restrained"));
  assert.equal(enemyOf(world, goblin.id).maxHp - enemyOf(world, goblin.id).currentHp, 3);
  world.dice(2, 2, 2);
  nextTurn(world);
  world.clearDice();
  assert.equal(enemyOf(world, goblin.id).maxHp - enemyOf(world, goblin.id).currentHp, 9);
});

await test("A creature that fails its save against Stinking Cloud spends its action retching: it takes no action that turn.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await table([caster("wizard", "int", ["Stinking Cloud"]), FIGHTER]);
  world.dice(1);
  await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Stinking Cloud", enemyIds: [goblin.id], saveAbility: "con", dc: 15, level: 3 });
  world.clearDice();
  const swing = await enemySwing(world, goblin.id, fighter.id);
  assert.equal(swing.ok, false);
});

await test("A confused creature rolls a d10 at the start of its turn; on 2 to 6 it neither moves nor takes an action.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await table([caster("wizard", "int", ["Confusion"]), FIGHTER]);
  world.dice(1);
  await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Confusion", enemyIds: [goblin.id], saveAbility: "wis", dc: 15, level: 4 });
  world.clearDice();
  // The d10 of its turn and the round's repeat save, in whichever order the
  // pointer rolls them: a 4 on the d10 (or a 1, with the save at 4) leaves
  // it no action either way, and neither die lets it save.
  nextTurn(world);
  world.dice(4, 1);
  // Past the fighter's turn to the goblin's.
  nextTurn(world);
  world.clearDice();
  const swing = await enemySwing(world, goblin.id, fighter.id);
  assert.equal(swing.ok, false);
});

await test("A concentrating creature caught in Sleet Storm makes a Constitution save or loses its concentration.", async () => {
  const { world, sheets: [druid], enemies: [mage] } = await table([caster("druid", "wis", ["Sleet Storm"])]);
  encounters.setEnemyConcentration(mage.id, "Hold Person");
  world.dice(20, 1);
  await world.invoke("aoe_damage", { casterId: druid.id, spell: "Sleet Storm", enemyIds: [mage.id], saveAbility: "dex", dc: 15, level: 3 });
  world.clearDice();
  assert.equal(enemyOf(world, mage.id).concentration ?? null, null);
});

await test("Blight has no effect on undead or constructs, and a plant saves with disadvantage and takes the maximum damage.", async () => {
  const { world, sheets: [druid], enemies: [shrub] } = await table([caster("druid", "wis", ["Blight"])], 1, { type: "plant" });
  world.diceLog();
  world.dice(1, 1, ...new Array(8).fill(1));
  const out = await world.invoke("cast_at_enemy", { characterId: druid.id, targetEnemyId: shrub.id, spell: "Blight", saveAbility: "con", level: 4 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(d20s(world.diceLog()), 2);
  assert.equal(enemyOf(world, shrub.id).maxHp - enemyOf(world, shrub.id).currentHp, 64);
  const other = await table([caster("druid", "wis", ["Blight"])], 1, { type: "undead" });
  const refused = await other.world.invoke("cast_at_enemy", { characterId: other.sheets[0].id, targetEnemyId: other.enemies[0].id, spell: "Blight", saveAbility: "con", level: 4 });
  assert.equal(refused.ok, false);
  assert.equal(other.world.sheet(other.sheets[0].id).spellcasting.slots["4"].used, 0);
});

// ---- Bestow Curse: each of its four curses held by the engine ----

await test("A creature Bestow Curse lays the ability curse on makes that ability's saves (and checks) with disadvantage.", async () => {
  const { world, sheets: [cleric], enemies: [goblin] } = await table([caster("cleric", "wis", ["Bestow Curse", "Command"])]);
  world.dice(1);
  await world.invoke("cast_at_enemy", { characterId: cleric.id, targetEnemyId: goblin.id, spell: "Bestow Curse", condition: "wis", saveAbility: "wis", level: 3 });
  world.clearDice();
  assert.ok(enemyOf(world, goblin.id).conditions.includes("cursed (wis)"));
  const { freshTurn } = await import("./lib/enforce-spells.mjs");
  await freshTurn(world);
  world.diceLog();
  world.dice(20, 1);
  await world.invoke("cast_at_enemy", { characterId: cleric.id, targetEnemyId: goblin.id, spell: "Command", condition: "halt", saveAbility: "wis", level: 1 });
  world.clearDice();
  assert.equal(d20s(world.diceLog()), 2);
});

await test("A creature under Bestow Curse's attack curse has disadvantage on attack rolls against the caster, and only against the caster.", async () => {
  const { world, sheets: [cleric, fighter], enemies: [goblin] } = await table([caster("cleric", "wis", ["Bestow Curse"]), FIGHTER]);
  world.dice(1);
  await world.invoke("cast_at_enemy", { characterId: cleric.id, targetEnemyId: goblin.id, spell: "Bestow Curse", condition: "attacks", saveAbility: "wis", level: 3 });
  world.clearDice();
  world.diceLog();
  world.dice(1, 1);
  await enemySwing(world, goblin.id, cleric.id);
  world.clearDice();
  assert.equal(d20s(world.diceLog()), 2);
  const { freshTurn } = await import("./lib/enforce-spells.mjs");
  await freshTurn(world);
  encounters.saveEncounter({ ...world.encounter(), round: world.encounter().round + 1 });
  world.dice(1);
  await enemySwing(world, goblin.id, fighter.id);
  world.clearDice();
  assert.equal(d20s(world.diceLog()), 1);
});

await test("Bestow Curse's necrotic curse adds 1d8 necrotic to the caster's attacks and spells that hit or harm the cursed creature.", async () => {
  const { world, sheets: [cleric], enemies: [goblin] } = await table([caster("cleric", "wis", ["Bestow Curse"], ["Sacred Flame"])]);
  world.dice(1);
  await world.invoke("cast_at_enemy", { characterId: cleric.id, targetEnemyId: goblin.id, spell: "Bestow Curse", condition: "necrotic", saveAbility: "wis", level: 3 });
  world.clearDice();
  const { freshTurn } = await import("./lib/enforce-spells.mjs");
  await freshTurn(world);
  world.dice(1, 4, 4, 5);
  await world.invoke("cast_at_enemy", { characterId: cleric.id, targetEnemyId: goblin.id, spell: "Sacred Flame", saveAbility: "dex" });
  world.clearDice();
  assert.equal(enemyOf(world, goblin.id).maxHp - enemyOf(world, goblin.id).currentHp, 13);
});

await test("A creature under Bestow Curse's will curse saves at the start of each of its turns or wastes its action.", async () => {
  const { world, sheets: [cleric, fighter], enemies: [goblin] } = await table([caster("cleric", "wis", ["Bestow Curse"]), FIGHTER]);
  world.dice(1);
  await world.invoke("cast_at_enemy", { characterId: cleric.id, targetEnemyId: goblin.id, spell: "Bestow Curse", condition: "will", saveAbility: "wis", level: 3 });
  world.clearDice();
  nextTurn(world);
  world.dice(1);
  nextTurn(world);
  world.clearDice();
  const swing = await enemySwing(world, goblin.id, fighter.id);
  assert.equal(swing.ok, false);
});

// ---- the spell rows that were never partial effects but utility ----

// Calm Emotions left this list when it gained its calm (scripts/test-enforce-spell-last.mjs).
await test("the SRD's pure utility spells resolve as utility, with no save for the engine to roll", async () => {
  const { spellMechanicsFor } = await import("../src/lib/content/index.ts");
  for (const spell of ["Light"]) {
    assert.equal(spellMechanicsFor({ spell })?.mech.resolution, "utility", spell);
  }
});

closeTables();
finish();
