// The medium findings of the second spells audit
// (/tmp/odm-enf2/reports/spells.md): one casting that heals six, Heat Metal,
// Banishment, the lasting spells with numbers (Aid, Magic Weapon,
// Protection from Energy, Death Ward, Protection from Evil and Good, Pass
// without Trace, Beacon of Hope, Heroism, Mirror Image, Sanctuary), the
// control spells whose condition prose does not state, Sleep's one pool,
// Dispel Magic, the reach of a healing spell and of an area's point of
// origin.
//
// SRD 5.1 as printed. Dice forced; every check reads the stored sheet, the
// encounter row, the dice rolled, or a refusal.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { freshTurn, layMap, onTurnOf } from "./lib/enforce-spells.mjs";
import { caster, closeTables, countDice, enemyOf, field, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-enforce-spell-rows");
const { skipCurrentTurn } = await import("../src/lib/dm/encounter-tools.ts");
const { advanceClock } = await import("../src/lib/db/clock.ts");
const encounters = await import("../src/lib/db/encounters.ts");

// ---- M2: one casting heals up to six ----

await test("Mass Healing Word on two allies in one turn spends one 3rd level slot", async () => {
  const { world, sheets: [priest, a, b] } = await table([caster("cleric", "wis", ["Mass Healing Word"]), FIGHTER, FIGHTER]);
  world.patch(a.id, { currentHp: 5 });
  world.patch(b.id, { currentHp: 5 });
  await onTurnOf(world, priest.id, async () => {
    world.dice(2);
    const one = await world.invokeAsIs("heal", { characterId: a.id, casterId: priest.id, spell: "Mass Healing Word", level: 3 });
    world.clearDice();
    world.dice(2);
    const two = await world.invokeAsIs("heal", { characterId: b.id, casterId: priest.id, spell: "Mass Healing Word", level: 3 });
    world.clearDice();
    assert.equal(one.ok, true, one.error);
    assert.equal(two.ok, true, two.error);
  });
  assert.ok(world.sheet(a.id).currentHp > 5);
  assert.ok(world.sheet(b.id).currentHp > 5);
  assert.equal(world.sheet(priest.id).spellcasting.slots["3"].used, 1);
});

await test("Mass Heal divides one pool of 700 hit points among creatures for one 9th level slot", async () => {
  const big = { ...FIGHTER, maxHp: 500 };
  const { world, sheets: [priest, a, b] } = await table([caster("cleric", "wis", ["Mass Heal"], [], 17), big, big]);
  world.patch(a.id, { maxHp: 500, currentHp: 1 });
  world.patch(b.id, { maxHp: 500, currentHp: 1 });
  await onTurnOf(world, priest.id, async () => {
    const one = await world.invokeAsIs("heal", { characterId: a.id, casterId: priest.id, spell: "Mass Heal", amount: 150, level: 9 });
    const two = await world.invokeAsIs("heal", { characterId: b.id, casterId: priest.id, spell: "Mass Heal", amount: 200, level: 9 });
    assert.equal(one.ok, true, one.error);
    assert.equal(two.ok, true, two.error);
  });
  assert.equal(world.sheet(a.id).currentHp, 151);
  assert.equal(world.sheet(b.id).currentHp, 201);
  assert.equal(world.sheet(priest.id).spellcasting.slots["9"].used, 1);
});

// ---- M5: Heat Metal's damage is automatic ----

// The CON save Heat Metal calls for decides only whether the object is
// dropped (SRD 5.1); the damage lands either way. This first pinned "no d20
// at all", which held while the drop was narrated; the engine now rolls
// that save (test-enforce-spell-tail.mjs), so a made save is what shows the
// damage is not its to decide.
await test("Heat Metal deals its 2d8 fire with no save roll deciding it", async () => {
  const { world, sheets: [druid], enemies: [goblin] } = await table([caster("druid", "wis", ["Heat Metal"])]);
  world.diceLog();
  world.dice(3, 3, 20);
  const out = await world.invoke("cast_at_enemy", { characterId: druid.id, targetEnemyId: goblin.id, spell: "Heat Metal", saveAbility: "con", level: 2 });
  const log = world.diceLog();
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(countDice(log, 20), 1);
  const now = enemyOf(world, goblin.id);
  assert.equal(now.maxHp - now.currentHp, 6);
});

await test("Heat Metal again on a later turn is a bonus action and no slot", async () => {
  const { world, sheets: [druid], enemies: [goblin] } = await table([caster("druid", "wis", ["Heat Metal"])]);
  world.dice(3, 3);
  await world.invoke("cast_at_enemy", { characterId: druid.id, targetEnemyId: goblin.id, spell: "Heat Metal", saveAbility: "con", level: 2 });
  world.clearDice();
  await freshTurn(world);
  world.dice(4, 4);
  const again = await world.invoke("cast_at_enemy", { characterId: druid.id, targetEnemyId: goblin.id, spell: "Heat Metal", saveAbility: "con" });
  world.clearDice();
  assert.equal(again.ok, true, again.error);
  assert.equal(world.sheet(druid.id).spellcasting.slots["2"].used, 1);
  const now = enemyOf(world, goblin.id);
  assert.equal(now.maxHp - now.currentHp, 14);
});

// ---- M6: Banishment takes the creature out of the fight ----

await test("a banished enemy is incapacitated with no repeat save, cannot be attacked, and returns when concentration ends", async () => {
  const { world, sheets: [priest, fighter], enemies: [goblin] } = await table([caster("cleric", "wis", ["Banishment"]), FIGHTER]);
  world.dice(1);
  const out = await world.invoke("cast_at_enemy", { characterId: priest.id, targetEnemyId: goblin.id, spell: "Banishment", saveAbility: "cha", level: 4 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const now = enemyOf(world, goblin.id);
  assert.ok(now.conditions.includes("banished"));
  assert.ok(now.conditions.includes("incapacitated"));
  assert.equal(now.conditionMeta.banished?.saveEnds, undefined);
  const swing = await onTurnOf(world, fighter.id, () =>
    world.invokeAsIs("pc_attack", { characterId: fighter.id, targetEnemyId: goblin.id, weapon: "Longsword" }),
  );
  assert.equal(swing.ok, false);
  await world.invoke("clear_condition", { characterId: priest.id, condition: "concentration" });
  assert.ok(!enemyOf(world, goblin.id).conditions.includes("banished"));
});

// ---- M8: lasting spells with numbers ----

await test("Aid raises three allies' maximum and current hit points by 5, by 10 from a 3rd level slot, and gives them back at its end", async () => {
  const { world, sheets: [priest, a, b] } = await table([caster("cleric", "wis", ["Aid"]), FIGHTER, FIGHTER]);
  const before = [priest, a, b].map((hero) => world.sheet(hero.id));
  const out = await world.invoke("cast_buff", { characterId: priest.id, spell: "Aid", level: 3, targetCharacterIds: [priest.id, a.id, b.id] });
  assert.equal(out.ok, true, out.error);
  for (const [index, hero] of [priest, a, b].entries()) {
    assert.equal(world.sheet(hero.id).maxHp, before[index].maxHp + 10);
    assert.equal(world.sheet(hero.id).currentHp, before[index].currentHp + 10);
  }
  await world.invoke("end_encounter", { outcome: "truce" });
  advanceClock(world.campaignId, 9, "hours");
  assert.equal(world.sheet(a.id).maxHp, before[1].maxHp);
});

await test("Magic Weapon from a 4th level slot is +2", async () => {
  const { world, sheets: [wizard, fighter] } = await table([caster("wizard", "int", ["Magic Weapon"]), FIGHTER]);
  const out = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Magic Weapon", level: 4, targetCharacterIds: [fighter.id] });
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(fighter.id).conditions.includes("magic weapon +2"));
});

await test("Protection from Energy (fire) halves fire damage", async () => {
  const { world, sheets: [druid, fighter] } = await table([caster("druid", "wis", ["Protection from Energy"]), FIGHTER]);
  const out = await world.invoke("cast_buff", { characterId: druid.id, spell: "Protection from Energy", variant: "fire", targetCharacterIds: [fighter.id] });
  assert.equal(out.ok, true, out.error);
  const before = world.sheet(fighter.id).currentHp;
  await world.invoke("apply_damage", { characterId: fighter.id, amount: 10, type: "fire" });
  assert.equal(before - world.sheet(fighter.id).currentHp, 5);
});

await test("Death Ward holds its bearer at 1 hit point the first time damage would drop them, and ends", async () => {
  const { world, sheets: [priest, fighter] } = await table([caster("cleric", "wis", ["Death Ward"], [], 9), FIGHTER]);
  const out = await world.invoke("cast_buff", { characterId: priest.id, spell: "Death Ward", targetCharacterIds: [fighter.id] });
  assert.equal(out.ok, true, out.error);
  await world.invoke("apply_damage", { characterId: fighter.id, amount: world.sheet(fighter.id).currentHp + 3 });
  assert.equal(world.sheet(fighter.id).currentHp, 1);
  assert.ok(!world.sheet(fighter.id).conditions.includes("death ward"));
});

await test("a fiend attacks a creature under Protection from Evil and Good at disadvantage", async () => {
  const { world, sheets: [priest, fighter], enemies: [fiend] } = await table(
    [caster("cleric", "wis", ["Protection from Evil and Good"]), FIGHTER],
    1,
    { type: "fiend" },
  );
  const out = await world.invoke("cast_buff", { characterId: priest.id, spell: "Protection from Evil and Good", targetCharacterIds: [fighter.id] });
  assert.equal(out.ok, true, out.error);
  world.diceLog();
  world.dice(10, 10, 1, 1);
  await world.invoke("enemy_attack", { enemyId: fiend.id, targetCharacterId: fighter.id, characterId: fighter.id });
  const log = world.diceLog();
  world.clearDice();
  assert.equal(countDice(log, 20), 2);
});

await test("Pass without Trace adds 10 to a Stealth check", async () => {
  const { world, sheets: [druid] } = await table([caster("druid", "wis", ["Pass without Trace"])]);
  await world.invoke("cast_buff", { characterId: druid.id, spell: "Pass without Trace" });
  world.dice(10);
  const out = await world.invoke("request_roll", { characterId: druid.id, kind: "skill_check", skill: "stealth", reason: "sneak" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  // d20 10 + DEX +1 + 10.
  assert.equal(out.result.total, 21);
});

// ---- M9: Beacon of Hope ----

await test("Beacon of Hope lands on two allies and makes Cure Wounds heal its maximum", async () => {
  const { world, sheets: [priest, a, b] } = await table([caster("cleric", "wis", ["Beacon of Hope", "Cure Wounds"]), FIGHTER, FIGHTER]);
  const out = await world.invoke("cast_buff", { characterId: priest.id, spell: "Beacon of Hope", targetCharacterIds: [a.id, b.id] });
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(a.id).conditions.includes("beacon of hope"));
  assert.ok(world.sheet(b.id).conditions.includes("beacon of hope"));
  world.patch(a.id, { currentHp: 1 });
  await freshTurn(world);
  world.dice(1);
  await world.invoke("heal", { characterId: a.id, casterId: priest.id, spell: "Cure Wounds", level: 1 });
  world.clearDice();
  // 1 + (8 + 4 WIS).
  assert.equal(world.sheet(a.id).currentHp, 13);
});

// ---- M10: control spells whose condition prose does not name ----

await test("Hideous Laughter with no condition named lays the target prone and incapacitated", async () => {
  const { world, sheets: [bard], enemies: [goblin] } = await table([caster("bard", "cha", ["Hideous Laughter"])]);
  world.dice(1);
  const out = await world.invoke("cast_at_enemy", { characterId: bard.id, targetEnemyId: goblin.id, spell: "Hideous Laughter", saveAbility: "wis", level: 1 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const now = enemyOf(world, goblin.id);
  assert.ok(now.conditions.includes("incapacitated"));
  assert.ok(now.conditions.includes("prone"));
});

await test("a creature laughing under Hideous Laughter saves again when hurt, with advantage, and a success ends it", async () => {
  const { world, sheets: [bard], enemies: [goblin] } = await table([caster("bard", "cha", ["Hideous Laughter"])]);
  world.dice(1);
  await world.invoke("cast_at_enemy", { characterId: bard.id, targetEnemyId: goblin.id, spell: "Hideous Laughter", saveAbility: "wis", level: 1 });
  world.clearDice();
  world.diceLog();
  world.dice(20, 20);
  await world.invoke("damage_enemy", { enemyId: goblin.id, amount: 1 });
  const log = world.diceLog();
  world.clearDice();
  assert.equal(countDice(log, 20), 2);
  assert.ok(!enemyOf(world, goblin.id).conditions.includes("incapacitated"));
});

await test("Fear frightens and Command commands, each with no condition named", async () => {
  const { world, sheets: [wizard], enemies: [a, b] } = await table([caster("wizard", "int", ["Fear", "Command"])], 2);
  world.dice(1);
  const fear = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: a.id, spell: "Fear", saveAbility: "wis", level: 3 });
  world.clearDice();
  await freshTurn(world);
  world.dice(1);
  const command = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: b.id, spell: "Command", saveAbility: "wis", level: 1 });
  world.clearDice();
  assert.equal(fear.ok, true, fear.error);
  assert.equal(command.ok, true, command.error);
  assert.ok(enemyOf(world, a.id).conditions.includes("frightened"));
  assert.ok(enemyOf(world, b.id).conditions.includes("commanded"));
});

// ---- M12: Sleep rolls one pool for the casting ----

await test("Sleep through aoe_damage rolls one 5d8 pool and puts two 7 hit point goblins to sleep for one slot", async () => {
  const { world, sheets: [wizard], enemies: [a, b] } = await table([caster("wizard", "int", ["Sleep"])], 2, { maxHp: 7 });
  world.diceLog();
  world.dice(4, 4, 4, 4, 4);
  const out = await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Sleep", level: 1, damage: "5d8", saveAbility: "wis", dc: 10, enemyIds: [a.id, b.id] });
  const log = world.diceLog();
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(countDice(log, 8), 5);
  assert.ok(enemyOf(world, a.id).conditions.includes("unconscious"));
  assert.ok(enemyOf(world, b.id).conditions.includes("unconscious"));
  assert.equal(world.sheet(wizard.id).spellcasting.slots["1"].used, 1);
});

await test("Sleep through cast_at_enemy on a second goblin the same turn draws on the same pool", async () => {
  const { world, sheets: [wizard], enemies: [a, b] } = await table([caster("wizard", "int", ["Sleep"])], 2, { maxHp: 7 });
  await onTurnOf(world, wizard.id, async () => {
    world.dice(4, 4, 4, 4, 4);
    await world.invokeAsIs("cast_at_enemy", { characterId: wizard.id, targetEnemyId: a.id, spell: "Sleep", saveAbility: "wis", level: 1 });
    world.clearDice();
    world.diceLog();
    await world.invokeAsIs("cast_at_enemy", { characterId: wizard.id, targetEnemyId: b.id, spell: "Sleep", saveAbility: "wis", level: 1 });
    assert.equal(countDice(world.diceLog(), 8), 0);
  });
  assert.ok(enemyOf(world, b.id).conditions.includes("unconscious"));
  assert.equal(world.sheet(wizard.id).spellcasting.slots["1"].used, 1);
});

await test("a sleeper wakes when it takes damage", async () => {
  const { world, sheets: [wizard], enemies: [a] } = await table([caster("wizard", "int", ["Sleep"])], 1, { maxHp: 7 });
  world.dice(4, 4, 4, 4, 4);
  await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: a.id, spell: "Sleep", saveAbility: "wis", level: 1 });
  world.clearDice();
  await world.invoke("damage_enemy", { enemyId: a.id, amount: 1 });
  assert.ok(!enemyOf(world, a.id).conditions.includes("unconscious"));
});

// ---- M13: Heroism, Mirror Image, Sanctuary ----

await test("Heroism grants temporary hit points equal to the caster's modifier at the start of the target's turn", async () => {
  const { world, sheets: [bard, fighter] } = await table([caster("bard", "cha", ["Heroism"]), FIGHTER]);
  const out = await world.invoke("cast_buff", { characterId: bard.id, spell: "Heroism", targetCharacterIds: [fighter.id] });
  assert.equal(out.ok, true, out.error);
  for (let step = 0; step < 4 && world.sheet(fighter.id).tempHp === 0; step += 1) {
    skipCurrentTurn(world.campaignId);
  }
  assert.equal(world.sheet(fighter.id).tempHp, 4);
});

await test("an enemy's attack on a caster with Mirror Image can strike a duplicate instead", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Mirror Image"])]);
  await world.invoke("cast_buff", { characterId: wizard.id, spell: "Mirror Image" });
  const hp = world.sheet(wizard.id).currentHp;
  world.dice(15, 20);
  await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: wizard.id, characterId: wizard.id });
  world.clearDice();
  assert.equal(world.sheet(wizard.id).currentHp, hp);
  assert.ok(world.sheet(wizard.id).conditions.includes("mirror image (2)"));
});

await test("an enemy that fails its WIS save against Sanctuary cannot attack the warded character", async () => {
  const { world, sheets: [priest, fighter], enemies: [goblin] } = await table([caster("cleric", "wis", ["Sanctuary"]), FIGHTER]);
  await world.invoke("cast_buff", { characterId: priest.id, spell: "Sanctuary", targetCharacterIds: [fighter.id] });
  const hp = world.sheet(fighter.id).currentHp;
  world.dice(1, 20, 6);
  const out = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: fighter.id, characterId: fighter.id });
  world.clearDice();
  assert.equal(out.ok, false);
  assert.equal(world.sheet(fighter.id).currentHp, hp);
});

// ---- M14: Dispel Magic ----

await test("Dispel Magic ends Bless on an ally and a Haste on an enemy", async () => {
  const { world, sheets: [priest, wizard, fighter], enemies: [goblin] } = await table([
    caster("cleric", "wis", ["Bless", "Dispel Magic"]),
    caster("wizard", "int", ["Dispel Magic"]),
    FIGHTER,
  ]);
  await world.invoke("cast_buff", { characterId: priest.id, spell: "Bless", level: 1, targetCharacterIds: [fighter.id] });
  assert.ok(world.sheet(fighter.id).conditions.includes("blessed"));
  const ally = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Dispel Magic", targetCharacterIds: [fighter.id] });
  assert.equal(ally.ok, true, ally.error);
  assert.ok(!world.sheet(fighter.id).conditions.includes("blessed"));
  const g = enemyOf(world, goblin.id);
  encounters.patchEnemyConditions(g.id, [...g.conditions, "hasted"], { ...g.conditionMeta, hasted: { rounds: 10 } });
  await freshTurn(world);
  const foe = await world.invoke("cast_at_enemy", { characterId: priest.id, targetEnemyId: goblin.id, spell: "Dispel Magic", saveAbility: "wis" });
  assert.equal(foe.ok, true, foe.error);
  assert.ok(!enemyOf(world, goblin.id).conditions.includes("hasted"));
});

// ---- M15, M16: reach ----

await test("Cure Wounds on an ally 145 feet away is refused and spends nothing", async () => {
  const { world, sheets: [priest, fighter], enemies: [goblin] } = await table([caster("cleric", "wis", ["Cure Wounds"]), FIGHTER]);
  await layMap(world, field(), { [priest.id]: { x: 1, y: 2 }, [fighter.id]: { x: 30, y: 2 }, [goblin.id]: { x: 35, y: 0 } });
  world.patch(fighter.id, { currentHp: 5 });
  const out = await world.invoke("heal", { characterId: fighter.id, casterId: priest.id, spell: "Cure Wounds", level: 1 });
  assert.equal(out.ok, false);
  assert.equal(world.sheet(priest.id).spellcasting.slots["1"].used, 0);
  assert.equal(world.sheet(fighter.id).currentHp, 5);
});

await test("a Fireball cannot catch a creature beyond its range and radius, and nothing is spent", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Fireball"])]);
  await layMap(world, field(80), { [wizard.id]: { x: 0, y: 2 }, [goblin.id]: { x: 79, y: 2 } });
  const out = await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Fireball", level: 3, damage: "8d6", saveAbility: "dex", dc: 15, enemyIds: [goblin.id] });
  assert.equal(out.ok, false);
  assert.equal(world.sheet(wizard.id).spellcasting.slots["3"].used, 0);
});

closeTables();
finish();
