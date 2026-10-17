// Rolls and turns settled once, with everything that bears on them
// (docs/character-table-rules-audit-2026-10-17.md, workstream 2: F04, F05,
// F09, F10, F11, F12, F29):
//
//   - advantage and disadvantage cancel once, over every source: one
//     disadvantage cancels any number of advantages.
//   - Sneak Attack is spent by a hit, not by a swing: a miss keeps it.
//   - Slow: one attack, and an action or a bonus action, not both.
//   - Haste cast mid-turn gives its action on that turn.
//   - Haste and Slow on one creature compose to the speed it had, whatever
//     the order they were laid in.
//   - Haste's lethargy: the creature cannot move.
//   - Stonecunning does not stack a third proficiency onto expertise.
//
// SRD 5.1 as printed. Dice forced; every check reads a stored row.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-enforce-attack-settlement");
const { patchEnemyConditions } = await import("../src/lib/db/encounters.ts");
const { conditionSpeed } = await import("../src/lib/srd/condition-effects.ts");
const { effectiveSpeed } = await import("../src/lib/dm/condition-logic.ts");
const { canAct } = await import("../src/lib/dm/can-act.ts");
const { breakConcentration } = await import("../src/lib/dm/concentration.ts");
const { resolveRollExpression } = await import("../src/lib/dm/rolls.ts");

const d20s = (log) => log.filter((die) => die.sides === 20).length;

await test("F04: poisoned + prone target + Reckless Attack is a straight roll (one d20)", async () => {
  const { world, sheets: [barb], enemies: [foe] } = await table([{ ...FIGHTER, class: "barbarian", level: 5 }]);
  patchEnemyConditions(foe.id, ["prone"], {});
  world.patch(barb.id, { conditions: ["poisoned"] });
  world.diceLog();
  world.dice(5, 15, 4);
  const out = await world.invokeAsIs("pc_attack", { characterId: barb.id, targetEnemyId: foe.id, weapon: "Longsword", reckless: true });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(d20s(world.diceLog().slice(0, 2)) >= 1, true);
  assert.equal(out.result.hit, false, "the 5 stands: no advantage survives a disadvantage");
});

await test("F04: two disadvantages and one advantage are a straight roll too", async () => {
  const { world, sheets: [fighter], enemies: [foe] } = await table([FIGHTER]);
  patchEnemyConditions(foe.id, ["restrained"], { restrained: { source: "net" } });
  world.patch(fighter.id, { conditions: ["poisoned", "frightened"], conditionMeta: { frightened: { source: "elsewhere" } } });
  world.dice(5, 15, 4);
  const out = await world.invokeAsIs("pc_attack", { characterId: fighter.id, targetEnemyId: foe.id, weapon: "Longsword" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.hit, false, "one d20, the 5");
});

await test("F05: a missed attack keeps Sneak Attack for the next hit this turn", async () => {
  const { world, sheets: [rogue], enemies: [foe] } = await table([{
    class: "rogue", level: 5, abilities: { dex: 18 },
    proficiencies: { ...FIGHTER.proficiencies, weapons: ["simple", "shortsword"] },
    equipment: [{ name: "Shortsword", qty: 2, equipped: true }],
    features: [{ name: "Sneak Attack" }],
  }]);
  patchEnemyConditions(foe.id, ["restrained"], { restrained: { source: "net" } });
  world.dice(1, 1);
  const miss = await world.invokeAsIs("pc_attack", { characterId: rogue.id, targetEnemyId: foe.id, weapon: "Shortsword" });
  world.clearDice();
  assert.equal(miss.ok, true, miss.error);
  assert.equal(miss.result.hit, false);
  world.diceLog();
  world.dice(15, 15, 4, 4, 4, 4);
  const hit = await world.invokeAsIs("pc_attack", { characterId: rogue.id, targetEnemyId: foe.id, weapon: "Shortsword", offHand: true });
  world.clearDice();
  assert.equal(hit.ok, true, hit.error);
  assert.equal(hit.result.hit, true);
  const d6 = world.diceLog().filter((die) => die.sides === 6).length;
  assert.equal(d6, 4, "the shortsword's d6 and Sneak Attack's 3d6");
});

await test("F05: Sneak Attack still lands once a turn", async () => {
  const { world, sheets: [rogue], enemies: [foe] } = await table([{
    class: "rogue", level: 5, abilities: { dex: 18 },
    proficiencies: { ...FIGHTER.proficiencies, weapons: ["simple", "shortsword"] },
    equipment: [{ name: "Shortsword", qty: 2, equipped: true }],
    features: [{ name: "Sneak Attack" }],
  }]);
  patchEnemyConditions(foe.id, ["restrained"], { restrained: { source: "net" } });
  world.dice(15, 15, 4, 4, 4, 4);
  await world.invokeAsIs("pc_attack", { characterId: rogue.id, targetEnemyId: foe.id, weapon: "Shortsword" });
  world.clearDice();
  world.diceLog();
  world.dice(15, 15, 4, 4, 4, 4);
  const second = await world.invokeAsIs("pc_attack", { characterId: rogue.id, targetEnemyId: foe.id, weapon: "Shortsword", offHand: true });
  world.clearDice();
  assert.equal(second.ok, true, second.error);
  assert.equal(world.diceLog().filter((die) => die.sides === 6).length, 1, "only the weapon's die the second time");
});

await test("F09: a slowed fighter makes one attack, and takes an action or a bonus action", async () => {
  const { world, sheets: [fighter], enemies: [foe] } = await table([FIGHTER]);
  world.patch(fighter.id, { conditions: ["slowed"], conditionMeta: { slowed: { spell: "Slow", source: "other-caster", rounds: 10 } } });
  world.dice(15, 4);
  const first = await world.invokeAsIs("pc_attack", { characterId: fighter.id, targetEnemyId: foe.id, weapon: "Longsword" });
  world.clearDice();
  assert.equal(first.ok, true, first.error);
  world.dice(15, 4);
  const second = await world.invokeAsIs("pc_attack", { characterId: fighter.id, targetEnemyId: foe.id, weapon: "Longsword" });
  world.clearDice();
  assert.equal(second.ok, false, "Extra Attack does not work under Slow");
});

await test("F09: slowed, Dodge then Second Wind is refused (action or bonus action, not both)", async () => {
  const { world, sheets: [fighter] } = await table([FIGHTER]);
  world.patch(fighter.id, {
    conditions: ["slowed"],
    features: [...world.sheet(fighter.id).features, { name: "Second Wind" }],
    resources: { ...world.sheet(fighter.id).resources, second_wind: { max: 1, used: 0 } },
  });
  const dodge = await world.invokeAsIs("take_action", { characterId: fighter.id, action: "dodge" });
  assert.equal(dodge.ok, true, dodge.error);
  const bonus = await world.invokeAsIs("use_resource", { characterId: fighter.id, resource: "Second Wind" });
  assert.equal(bonus.ok, false);
  assert.equal(world.encounter().turnBudget.bonusUsed, false);
});

await test("F09: a slowed monster's Multiattack is one attack", async () => {
  const { world, sheets: [fighter], enemies: [brute] } = await table([FIGHTER], 1, {
    attacksPerTurn: 3,
    attacks: [{ name: "Claw", toHit: 4, damage: "1d4", type: "slashing" }],
  });
  patchEnemyConditions(brute.id, ["slowed"], { slowed: { spell: "Slow", source: fighter.id, rounds: 10 } });
  const encounter = world.encounter();
  const { saveEncounter } = await import("../src/lib/db/encounters.ts");
  saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => entry.enemyId === brute.id), turnBudget: null });
  world.diceLog();
  world.dice(2, 2, 2, 2, 2, 2);
  const out = await world.invokeAsIs("enemy_attack", { enemyId: brute.id, targetCharacterId: fighter.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(d20s(world.diceLog()), 1, "one swing, not three");
});

await test("F09: Slow holds a 1-action spell on an 11+ and the next turn completes it for no slot", async () => {
  const { world, sheets: [mage], enemies: [foe] } = await table([caster("wizard", "int", ["Fireball"])]);
  world.patch(mage.id, { conditions: ["slowed"], conditionMeta: { slowed: { spell: "Slow", source: "other-caster", rounds: 10 } } });
  world.dice(15, 1, ...Array(8).fill(4));
  const held = await world.invokeAsIs("cast_at_enemy", { characterId: mage.id, targetEnemyId: foe.id, spell: "Fireball" });
  world.clearDice();
  assert.equal(held.ok, false, "held back");
  assert.equal(world.enemies()[0].currentHp, 90);
  assert.equal(world.sheet(mage.id).spellcasting.slots["3"].used, 1, "the slot is spent when it is cast");
  // Their next turn: the mark's turn has begun and the budget is fresh.
  const now = world.sheet(mage.id);
  world.patch(mage.id, { conditionMeta: { ...now.conditionMeta, "slowed casting": { ...now.conditionMeta["slowed casting"], turnBegun: true } } });
  const encounter = world.encounter();
  const { saveEncounter } = await import("../src/lib/db/encounters.ts");
  saveEncounter({ ...encounter, turnBudget: null });
  world.dice(1, ...Array(8).fill(4));
  const done = await world.invokeAsIs("cast_at_enemy", { characterId: mage.id, targetEnemyId: foe.id, spell: "Fireball" });
  world.clearDice();
  assert.equal(done.ok, true, done.error);
  assert.equal(world.enemies()[0].currentHp, 90 - 32);
  assert.equal(world.sheet(mage.id).spellcasting.slots["3"].used, 1, "no second slot");
  assert.equal(world.sheet(mage.id).conditions.includes("slowed casting"), false);
});

await test("F09: Slow's d20 under 11 lets the spell through at once", async () => {
  const { world, sheets: [mage], enemies: [foe] } = await table([caster("wizard", "int", ["Fireball"])]);
  world.patch(mage.id, { conditions: ["slowed"], conditionMeta: { slowed: { spell: "Slow", source: "other-caster", rounds: 10 } } });
  world.dice(5, 1, ...Array(8).fill(4));
  const out = await world.invokeAsIs("cast_at_enemy", { characterId: mage.id, targetEnemyId: foe.id, spell: "Fireball" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.enemies()[0].currentHp, 90 - 32);
});

await test("F10: Haste cast on oneself gives its action on the same turn", async () => {
  const { world, sheets: [mage] } = await table([caster("wizard", "int", ["Haste"])]);
  const cast = await world.invokeAsIs("cast_buff", { characterId: mage.id, spell: "Haste" });
  assert.equal(cast.ok, true, cast.error);
  const dash = await world.invokeAsIs("take_action", { characterId: mage.id, action: "dash" });
  assert.equal(dash.ok, true, dash.error);
  const again = await world.invokeAsIs("take_action", { characterId: mage.id, action: "dash" });
  assert.equal(again.ok, false, "one extra action, not two");
});

test("F11: Haste and Slow compose the same in either order", () => {
  assert.equal(conditionSpeed(["hasted", "slowed"], 30), 30);
  assert.equal(conditionSpeed(["slowed", "hasted"], 30), 30);
  assert.equal(conditionSpeed(["hasted"], 30), 60);
  assert.equal(conditionSpeed(["slowed"], 30), 15);
});

await test("F12: Haste's lethargy stops movement until after the creature's next turn", async () => {
  const { world, sheets: [mage, fighter] } = await table([caster("wizard", "int", ["Haste"]), FIGHTER]);
  const cast = await world.invoke("cast_buff", { characterId: mage.id, spell: "Haste", targetCharacterIds: [fighter.id] });
  assert.equal(cast.ok, true, cast.error);
  breakConcentration(world.campaign(), null, mage.id, "released");
  const now = world.sheet(fighter.id);
  const encounter = world.encounter();
  encounter.turnIndex = encounter.order.findIndex((entry) => entry.characterId === fighter.id);
  assert.equal(effectiveSpeed(now.conditions, now.speed), 0);
  assert.equal(canAct({ sheet: now, encounter, kind: "move" }).ok, false);
});

await test("F29: Stonecunning on an expert's History check adds no third proficiency", async () => {
  const world = await openWorld();
  const rogue = world.addHero({
    class: "rogue", level: 5, race: "hill_dwarf", abilities: { int: 10 },
    proficiencies: { ...FIGHTER.proficiencies, skills: ["history"], expertise: ["history"] },
  });
  const resolved = resolveRollExpression({ kind: "skill_check", skill: "history", reason: "origin of stonework", about: "stonework" }, world.sheet(rogue.id));
  assert.match(resolved.expression, /^1d20\+6$/, resolved.expression);
  const plain = world.addHero({
    class: "fighter", level: 5, race: "hill_dwarf", abilities: { int: 10 },
    proficiencies: { ...FIGHTER.proficiencies, skills: [], expertise: [] },
  });
  const untrained = resolveRollExpression({ kind: "skill_check", skill: "history", reason: "origin of stonework", about: "stonework" }, world.sheet(plain.id));
  assert.match(untrained.expression, /^1d20\+6$/, "untrained: double proficiency from Stonecunning");
  world.close();
});

closeTables();
finish();
