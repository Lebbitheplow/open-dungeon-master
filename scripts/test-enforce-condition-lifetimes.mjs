// How long a spell's or a monster's condition lasts, and whose it is
// (docs/dnd-rules-audit-2026-10-09-extent.md, R2 and R3: F05, F06, F07,
// F08, F20, N01, N02, N03):
//
//   - Hold Person: a WIS save at the END of each of the target's turns, and
//     the spell ends after 1 minute whatever the saves do.
//   - Two casters' Hold Person on one creature are two instances: ending one
//     caster's concentration leaves the other's.
//   - Concentration has a clock: a 1-minute spell is not held three hours on.
//   - Aid cast twice on one creature does not stack; the higher casting
//     counts, and ending it takes the maximum back down.
//   - Geas lasts 30 days, a year from a 7th-level slot, and until dispelled
//     from 9th.
//   - A monster's "poisoned for 1 minute" is ten rounds.
//
// SRD 5.1 as printed. Dice forced; every check reads a stored row.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { kit as conditionsKit } from "./lib/enforce-conditions.mjs";
import { caster, closeTables, enemyOf, table } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-enforce-condition-lifetimes");
const { spellMechFor } = await import("../src/lib/srd/spell-mechanics.ts");
const { spellConditionMeta } = await import("../src/lib/dm/spell-effects.ts");
const { parseSaveEffect } = await import("../src/lib/dm/monster-abilities.ts");

const HOLD = ["Hold Person", "Blur", "Detect Thoughts"];
const enemyMeta = (world, id) => enemyOf(world, id).conditionMeta ?? {};
const paralyzed = (world, id) => enemyOf(world, id).conditions.includes("paralyzed");

// One round of turns. A paralyzed enemy's turn passes on its own, and the
// enemy turns the pointer walks past are played in the DM turn that follows
// the move, so their end-of-turn saves are rolled on the next move.
function nextRound(world, kit) {
  const round = world.encounter().round;
  for (let turn = 0; turn < 8 && world.encounter().round === round; turn += 1) {
    assert.equal(kit.skipTurn(), true);
  }
  assert.equal(world.encounter().round, round + 1);
}

await test("Hold Person: the save comes at the end of the target's turn, and the spell ends after a minute", async () => {
  const { world, sheets: [mage], enemies: [dummy] } = await table([caster("wizard", "int", HOLD)]);
  const kit = conditionsKit(world);
  world.dice(1);
  const out = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: dummy.id, spell: "Hold Person", saveAbility: "wis", level: 2 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const meta = enemyMeta(world, dummy.id).paralyzed;
  assert.equal(meta.rounds, 10, "a minute is ten rounds, save or no save");
  assert.equal(meta.saveEnds?.ability, "wis");
  // Every save fails: the hold ends with the minute, not before and not never.
  // The save is thrown once a round, as the target's turn ends: none in the
  // move that hands the target its turn, one in each move after.
  const saves = [];
  for (let round = 1; round <= 10; round += 1) {
    assert.ok(paralyzed(world, dummy.id), `still held in round ${round}`);
    world.diceLog();
    world.dice(...Array(6).fill(1));
    nextRound(world, kit);
    world.clearDice();
    saves.push(world.diceLog().filter((die) => die.sides === 20).length);
  }
  assert.deepEqual(saves, [0, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(paralyzed(world, dummy.id), false, "a minute of failed saves later the spell is over");
});

await test("Two casters' Hold Person are two holds: the first caster's concentration ending leaves the second's", async () => {
  const { world, sheets: [first, second], enemies: [dummy] } = await table([caster("wizard", "int", HOLD), caster("wizard", "int", HOLD)]);
  for (const mage of [first, second]) {
    world.dice(1);
    const out = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: dummy.id, spell: "Hold Person", saveAbility: "wis", level: 2 });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
  }
  // The first caster takes up another concentration spell: their hold ends.
  const blur = await world.invoke("cast_buff", { characterId: first.id, spell: "Blur" });
  assert.equal(blur.ok, true, blur.error);
  assert.ok(paralyzed(world, dummy.id), "the second caster's hold still stands");
  assert.equal(world.sheet(second.id).concentratingOn, "Hold Person");
  const again = await world.invoke("cast_buff", { characterId: second.id, spell: "Blur" });
  assert.equal(again.ok, true, again.error);
  assert.equal(paralyzed(world, dummy.id), false, "with both holds ended the creature is free");
});

await test("Concentration has a clock: Detect Thoughts is not held three hours on", async () => {
  const world = await openWorld();
  const mage = world.addHero(caster("wizard", "int", HOLD));
  const out = await world.invoke("use_spell_slot", { characterId: mage.id, spell: "Detect Thoughts", level: 2 });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(mage.id).concentratingOn, "Detect Thoughts");
  await world.invoke("pass_time", { amount: 3, unit: "hours" });
  assert.equal(world.sheet(mage.id).concentratingOn, null, "a 1-minute spell outlived its minute");
  world.close();
});

await test("Aid does not stack: the higher casting counts, and ending it takes the maximum back down", async () => {
  const world = await openWorld();
  const priest = world.addHero(caster("cleric", "wis", ["Aid"], [], 9));
  const tank = world.addHero({ class: "fighter", level: 5, maxHp: 40 });
  const base = world.sheet(tank.id).maxHp;
  const low = await world.invoke("cast_buff", { characterId: priest.id, spell: "Aid", level: 2, targetCharacterIds: [tank.id] });
  assert.equal(low.ok, true, low.error);
  assert.equal(world.sheet(tank.id).maxHp, base + 5);
  const high = await world.invoke("cast_buff", { characterId: priest.id, spell: "Aid", level: 3, targetCharacterIds: [tank.id] });
  assert.equal(high.ok, true, high.error);
  assert.equal(world.sheet(tank.id).maxHp, base + 10, "the 3rd-level casting's 10, not 5 + 10");
  const ended = await world.invoke("clear_condition", { characterId: tank.id, condition: "aided" });
  assert.equal(ended.ok, true, ended.error);
  assert.equal(world.sheet(tank.id).maxHp, base, "Aid's maximum went with it");
  world.close();
});

test("Geas lasts 30 days, a year from a 7th-level slot, and until dispelled from 9th", () => {
  const condition = spellMechFor(["Geas"]).condition;
  const DAY = 14400;
  const source = (slotLevel) => ({ spell: "Geas", casterId: "c", slotLevel });
  assert.equal(spellConditionMeta(condition, source(5), { ability: "wis", dc: 15 }).rounds, 30 * DAY);
  assert.equal(spellConditionMeta(condition, source(7), { ability: "wis", dc: 15 }).rounds, 365 * DAY);
  assert.equal(spellConditionMeta(condition, source(9), { ability: "wis", dc: 15 }).rounds, undefined, "until dispelled");
});

test("A monster's condition for 1 minute is ten rounds; for 1 hour, six hundred", () => {
  const minute = parseSaveEffect("Hit: 4 (1d4 + 2) piercing damage, and the target must succeed on a DC 11 Constitution saving throw or be poisoned for 1 minute.");
  assert.equal(minute.condition, "poisoned");
  assert.equal(minute.rounds, 10);
  const hour = parseSaveEffect("The target must succeed on a DC 13 Wisdom saving throw or be frightened for 1 hour.");
  assert.equal(hour.rounds, 600);
});

closeTables();
finish();
