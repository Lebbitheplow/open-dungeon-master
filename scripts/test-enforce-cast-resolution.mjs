// One casting, one resolution (docs/character-table-rules-audit-2026-10-17.md,
// workstream 1: F01, F02, F03, F06, F26, F30, F31):
//
//   - heal resolves a healing spell and nothing else: Fireball heals nobody,
//     for a person or for the AI, and a utility spell with an amount is no
//     back door either.
//   - a spell Counterspell stops is spent and does nothing: no attack roll,
//     no damage, no ray left over for a later call.
//   - a concentration area that comes again (Moonbeam) strikes a creature
//     once a turn, on an event: three calls on one turn are one strike.
//   - casting the same concentration spell again ends the first casting.
//   - a higher slot buys the longer lifetime the spell grants (Hex at 3rd
//     level: eight hours).
//   - a negative spellcasting modifier comes off the healing roll.
//   - one area casting resolved a creature per call is still one area: one
//     placement, one damage roll.
//
// SRD 5.1 as printed. Dice forced; every check reads a stored row.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, enemyOf, FIGHTER, field, invokeAsAi, table } from "./lib/enforce-spell-kit.mjs";
import { layMap, warlock } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-cast-resolution");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");

const slot = (world, id, level) => world.sheet(id).spellcasting.slots[String(level)];

await test("F01: heal refuses a damaging spell and spends nothing, for a person or for the AI", async () => {
  const world = await openWorld();
  const mage = world.addHero(caster("wizard", "int", ["Fireball", "Light"]));
  const ally = world.addHero({ ...FIGHTER, maxHp: 60 });
  world.patch(ally.id, { currentHp: 1 });
  world.dice(...Array(8).fill(4));
  const person = await world.invoke("heal", { characterId: ally.id, casterId: mage.id, spell: "Fireball" });
  world.clearDice();
  assert.equal(person.ok, false, "Fireball is no healing spell");
  world.say("player", "I cast Fireball.", mage);
  world.dice(...Array(8).fill(4));
  const ai = await invokeAsAi(world, "heal", { characterId: ally.id, casterId: mage.id, spell: "Fireball" });
  world.clearDice();
  assert.equal(ai.ok, false, "nor for the AI");
  const amount = await world.invoke("heal", { characterId: ally.id, casterId: mage.id, spell: "Light", amount: 10 });
  assert.equal(amount.ok, false, "a utility spell with an amount is not a healing spell either");
  assert.equal(world.sheet(ally.id).currentHp, 1);
  assert.equal(slot(world, mage.id, 3).used, 0, "nothing was spent");
});

await test("F01: a real healing spell still heals through heal", async () => {
  const world = await openWorld();
  const priest = world.addHero(caster("cleric", "wis", ["Cure Wounds"]));
  const ally = world.addHero({ ...FIGHTER, maxHp: 60 });
  world.patch(ally.id, { currentHp: 1 });
  world.dice(5);
  const out = await world.invoke("heal", { characterId: ally.id, casterId: priest.id, spell: "Cure Wounds" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).currentHp, 1 + 5 + 4, "1d8 (5) + WIS 18's +4");
});

await test("F30: a negative casting modifier comes off the healing (WIS 8 Cure Wounds rolling 4 heals 3)", async () => {
  const world = await openWorld();
  const priest = world.addHero(caster("cleric", "wis", ["Cure Wounds"], [], 1, { abilities: { wis: 8 } }));
  world.patch(priest.id, { currentHp: 1 });
  world.dice(4);
  const out = await world.invoke("heal", { characterId: priest.id, spell: "Cure Wounds" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(priest.id).currentHp, 4, "1 + (4 - 1)");
});

await test("F02: a countered Scorching Ray is spent and rolls nothing", async () => {
  const { world, sheets: [mage], enemies: [mage2] } = await table([caster("wizard", "int", ["Scorching Ray"])], 1, {
    spells: ["Counterspell"],
    spellcasting: { dc: 15, ability: "int", casterLevel: 9, spells: [{ name: "Counterspell", level: 3 }], slots: { 3: 3 } },
  });
  world.diceLog();
  world.dice(15, 4, 4);
  const out = await world.invokeAsIs("pc_attack", { characterId: mage.id, targetEnemyId: mage2.id, spell: "Scorching Ray" });
  world.clearDice();
  const log = world.diceLog();
  assert.equal(enemyOf(world, mage2.id).currentHp, 90, "no ray lands");
  assert.equal(log.filter((die) => die.sides === 20).length, 0, "no attack roll is made");
  assert.equal(slot(world, mage.id, 2).used, 1, "the slot is spent all the same");
  assert.match(String(out.error ?? out.result?.note ?? ""), /counter/i);
  // The countered casting holds no rays for a later call.
  world.dice(15, 4, 4);
  const again = await world.invokeAsIs("pc_attack", { characterId: mage.id, targetEnemyId: mage2.id, spell: "Scorching Ray" });
  world.clearDice();
  assert.equal(enemyOf(world, mage2.id).currentHp, 90, "no second ray from the countered casting");
  assert.notEqual(again.result?.hit, true);
});

await test("F03: Moonbeam comes again once a turn, not once a call", async () => {
  const { world, sheets: [druid], enemies: [target] } = await table([caster("druid", "wis", ["Moonbeam"])], 1, { maxHp: 300 });
  const calls = [];
  for (let i = 0; i < 3; i += 1) {
    world.dice(1, 4, 4);
    calls.push(await world.invokeAsIs("cast_at_enemy", { characterId: druid.id, targetEnemyId: target.id, spell: "Moonbeam" }));
    world.clearDice();
  }
  assert.equal(calls[0].ok, true, calls[0].error);
  assert.equal(enemyOf(world, target.id).currentHp, 292, "one strike this turn");
  assert.equal(calls[1].ok, false, "the second call has no event behind it");
  assert.equal(slot(world, druid.id, 2).used, 1);
  // The creature's own turn starting is an event: once.
  const encounter = world.encounter();
  saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => entry.enemyId === target.id), turnBudget: null });
  world.dice(1, 4, 4);
  const start = await world.invokeAsIs("cast_at_enemy", { characterId: druid.id, targetEnemyId: target.id, spell: "Moonbeam" });
  world.clearDice();
  assert.equal(start.ok, true, start.error);
  assert.equal(enemyOf(world, target.id).currentHp, 284, "its turn starting in the beam");
  world.dice(1, 4, 4);
  const twice = await world.invokeAsIs("cast_at_enemy", { characterId: druid.id, targetEnemyId: target.id, spell: "Moonbeam" });
  world.clearDice();
  assert.equal(twice.ok, false);
  assert.equal(enemyOf(world, target.id).currentHp, 284);
});

await test("F03: on a board, the beam's automatic strike and an explicit call are one event", async () => {
  const { world, sheets: [druid], enemies: [target] } = await table([caster("druid", "wis", ["Moonbeam"])], 1, { maxHp: 300 });
  await layMap(world, field(12), { [druid.id]: { x: 1, y: 2 }, [target.id]: { x: 5, y: 2 } });
  const calls = [];
  for (let i = 0; i < 3; i += 1) {
    world.dice(1, 4, 4);
    calls.push(await world.invokeAsIs("cast_at_enemy", { characterId: druid.id, targetEnemyId: target.id, spell: "Moonbeam" }));
    world.clearDice();
  }
  assert.equal(calls[0].ok, true, calls[0].error);
  assert.equal(enemyOf(world, target.id).currentHp, 292);
  assert.equal(slot(world, druid.id, 2).used, 1);
});

await test("F06: casting Hold Person again ends the first casting's hold", async () => {
  const { world, sheets: [mage], enemies: [a, b] } = await table([caster("wizard", "int", ["Hold Person"])], 2);
  for (const enemy of [a, b]) {
    world.dice(1);
    const out = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: enemy.id, spell: "Hold Person", level: 2 });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
  }
  assert.equal(enemyOf(world, a.id).conditions.includes("paralyzed"), false, "the first casting ended");
  assert.equal(enemyOf(world, b.id).conditions.includes("paralyzed"), true);
  assert.equal(slot(world, mage.id, 2).used, 2);
});

await test("F06: more targets of ONE upcast Hold Person stay held together", async () => {
  const { world, sheets: [mage], enemies: [a, b] } = await table([caster("wizard", "int", ["Hold Person"])], 2);
  for (const enemy of [a, b]) {
    world.dice(1);
    const out = await world.invokeAsIs("cast_at_enemy", { characterId: mage.id, targetEnemyId: enemy.id, spell: "Hold Person", level: 3 });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
  }
  assert.ok(enemyOf(world, a.id).conditions.includes("paralyzed"));
  assert.ok(enemyOf(world, b.id).conditions.includes("paralyzed"));
  assert.equal(slot(world, mage.id, 3).used, 1);
});

await test("F26: Hex from a 3rd-level pact slot is held for eight hours", async () => {
  const world = await openWorld();
  const lock = world.addHero(warlock(5));
  const out = await world.invoke("cast_buff", { characterId: lock.id, spell: "Hex" });
  assert.equal(out.ok, true, out.error);
  const held = world.sheet(lock.id);
  assert.equal(held.concentrationRounds, 4800, "eight hours of concentration");
  await world.invoke("pass_time", { amount: 2, unit: "hours" });
  assert.equal(world.sheet(lock.id).concentratingOn, "Hex", "two hours in, still held");
  await world.invoke("pass_time", { amount: 7, unit: "hours" });
  assert.equal(world.sheet(lock.id).concentratingOn, null, "nine hours in, over");
  world.close();
});

await test("F31: one Fireball cannot catch two creatures 190 feet apart, a call at a time", async () => {
  const { world, sheets: [mage], enemies: [a, b] } = await table([caster("wizard", "int", ["Fireball"])], 2);
  await layMap(world, field(45), { [mage.id]: { x: 20, y: 2 }, [a.id]: { x: 1, y: 2 }, [b.id]: { x: 39, y: 2 } });
  const calls = [];
  for (const enemy of [a, b]) {
    world.dice(1, ...Array(8).fill(4));
    calls.push(await world.invokeAsIs("cast_at_enemy", { characterId: mage.id, targetEnemyId: enemy.id, spell: "Fireball" }));
    world.clearDice();
  }
  assert.equal(calls[0].ok, true, calls[0].error);
  assert.equal(calls[1].ok, false, "the second creature is not in the first one's sphere");
  assert.equal(enemyOf(world, b.id).currentHp, 90);
});

await test("F31: two creatures in one Fireball take the same damage roll", async () => {
  const { world, sheets: [mage], enemies: [a, b] } = await table([caster("wizard", "int", ["Fireball"])], 2);
  await layMap(world, field(45), { [mage.id]: { x: 2, y: 2 }, [a.id]: { x: 20, y: 2 }, [b.id]: { x: 22, y: 2 } });
  world.dice(1, ...Array(8).fill(4));
  const first = await world.invokeAsIs("cast_at_enemy", { characterId: mage.id, targetEnemyId: a.id, spell: "Fireball" });
  world.clearDice();
  world.dice(1, ...Array(8).fill(1));
  const second = await world.invokeAsIs("cast_at_enemy", { characterId: mage.id, targetEnemyId: b.id, spell: "Fireball" });
  world.clearDice();
  assert.equal(first.ok, true, first.error);
  assert.equal(second.ok, true, second.error);
  assert.equal(enemyOf(world, a.id).currentHp, 90 - 32);
  assert.equal(enemyOf(world, b.id).currentHp, 90 - 32, "the area's one roll, not a second");
  assert.equal(slot(world, mage.id, 3).used, 1);
});

closeTables();
finish();
