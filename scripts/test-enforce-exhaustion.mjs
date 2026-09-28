// Exhaustion, the six level track (SRD 5.1, Appendix PH-A, Exhaustion):
//
//   1  disadvantage on ability checks
//   2  speed halved
//   3  disadvantage on attack rolls and saving throws
//   4  hit point maximum halved
//   5  speed reduced to 0
//   6  death
//
// A creature suffers its level and every level below it. An effect adds or
// removes levels; finishing a long rest removes one, "provided that the
// creature has also ingested some food and drink".
//
// ODM's own rules, pinned here as the code documents them:
//   - Exhaustion is a number on the sheet (0 to 6), never a name in the
//     conditions list; each set_condition "exhaustion" adds ONE level and each
//     clear_condition removes one (src/lib/dm/mutations.ts).
//   - Initiative is a Dexterity check, so level 1 costs it too
//     (src/lib/dm/condition-logic.ts exhaustionRollState).
//   - Food and drink are not tracked: every long rest removes a level.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite, abilityMod } from "./lib/enforce-harness.mjs";
import { kit as conditionsKit, FIGHTER } from "./lib/enforce-conditions.mjs";

const { test, finish } = suite("test-enforce-exhaustion");
const world = await openWorld();
const kit = conditionsKit(world);
const maps = await import("../src/lib/db/battle-maps.ts");
const { pcMoveBudget } = await import("../src/lib/battlemap/view.ts");

// The table, as what a level costs. Speed is out of 30 ft.
const TABLE = [
  { level: 0, checks: 1, attacks: 1, saves: 1, speed: 30, maxHp: 40 },
  { level: 1, checks: 2, attacks: 1, saves: 1, speed: 30, maxHp: 40 },
  { level: 2, checks: 2, attacks: 1, saves: 1, speed: 15, maxHp: 40 },
  { level: 3, checks: 2, attacks: 2, saves: 2, speed: 15, maxHp: 40 },
  { level: 4, checks: 2, attacks: 2, saves: 2, speed: 15, maxHp: 20 },
  { level: 5, checks: 2, attacks: 2, saves: 2, speed: 0, maxHp: 20 },
];

const hero = world.addHero(FIGHTER);
const tire = (id = hero.id) => world.invoke("set_condition", { characterId: id, condition: "exhaustion" });
const level = (id = hero.id) => world.sheet(id).exhaustion;

await test("each application adds exactly one level and the list of conditions stays empty", async () => {
  kit.reset(hero.id);
  for (let expected = 1; expected <= 5; expected += 1) {
    const out = await tire();
    assert.equal(out.ok, true, out.error);
    assert.equal(level(), expected);
    assert.deepEqual(world.sheet(hero.id).conditions, []);
    assert.equal(world.sheet(hero.id).deathSaves, null);
  }
});

await test("level 6 is death, and the track cannot pass 6", async () => {
  kit.reset(hero.id, { exhaustion: 5 });
  const out = await tire();
  assert.equal(out.ok, true, out.error);
  assert.equal(level(), 6);
  assert.equal(world.sheet(hero.id).deathSaves?.dead, true);
  await tire();
  assert.equal(level(), 6);
  const healed = await world.invoke("heal", { characterId: hero.id, amount: 10 });
  assert.equal(healed.ok, false);
});

await test("initiative is an ability check: disadvantage from level 1", async () => {
  kit.reset(hero.id, { exhaustion: 1 });
  const out = await kit.withDice([17, 3], "request_roll", { characterId: hero.id, kind: "initiative" });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  assert.equal(kit.d20s(out.dice), 2);
  assert.equal(out.result.total, 3 + abilityMod(14));
});

await test("clearing removes one level at a time and refuses at zero", async () => {
  kit.reset(hero.id, { exhaustion: 2 });
  const clear = () => world.invoke("clear_condition", { characterId: hero.id, condition: "exhaustion" });
  assert.equal((await clear()).ok, true);
  assert.equal(level(), 1);
  assert.equal((await clear()).ok, true);
  assert.equal(level(), 0);
  assert.equal((await clear()).ok, false);
  assert.equal(level(), 0);
});

await test("a long rest removes ONE level, not all of them", async () => {
  for (const [before, after] of [[5, 4], [3, 2], [1, 0], [0, 0]]) {
    kit.reset(hero.id, { exhaustion: before });
    // One long rest in 24 hours: a day goes by between them.
    await world.invoke("pass_time", { amount: 1, unit: "days" });
    const out = await world.invoke("take_rest", { kind: "long" });
    assert.equal(out.ok, true, out.error);
    assert.equal(level(), after);
  }
});

await test("a short rest removes nothing", async () => {
  kit.reset(hero.id, { exhaustion: 3 });
  const out = await world.invoke("take_rest", { kind: "short" });
  assert.equal(out.ok, true, out.error);
  assert.equal(level(), 3);
});

await test("a long rest does not raise the dead of exhaustion", async () => {
  kit.reset(hero.id, { exhaustion: 5 });
  await tire();
  await world.invoke("pass_time", { amount: 1, unit: "days" });
  await world.invoke("take_rest", { kind: "long" });
  assert.equal(level(), 6);
  assert.equal(world.sheet(hero.id).deathSaves?.dead, true);
});

// ---- the table, in a fight ----

kit.reset(hero.id);
await world.beginFight([{ monster: "goblin", count: 2 }], { heroFaces: { [hero.id]: 20 } });
const [goblin] = world.enemies();
const encounter = world.encounter();
const board = maps.getBattleMapForEncounter(encounter.id);
const token = maps.getTokenByRef(board.id, hero.id);
const speedAt = () => pcMoveBudget(world.campaignId, world.encounter(), board, world.sheet(hero.id), token).speed;
const boardSpeeds = TABLE.map((row) => {
  kit.reset(hero.id, { exhaustion: row.level });
  return speedAt();
});
kit.offBoard();

for (const row of TABLE) {
  await test(`level ${row.level}: ability and skill checks roll ${row.checks} d20`, async () => {
    kit.reset(hero.id, { exhaustion: row.level });
    const check = await kit.withDice([17, 3], "request_roll", {
      characterId: hero.id, kind: "ability_check", ability: "int", dc: 10,
    });
    assert.equal(kit.d20s(check.dice), row.checks);
    assert.equal(check.result.total, row.checks === 2 ? 3 : 17);
    const skill = await kit.withDice([17, 3], "request_roll", {
      characterId: hero.id, kind: "skill_check", skill: "athletics", dc: 10,
    });
    assert.equal(kit.d20s(skill.dice), row.checks);
  });

  await test(`level ${row.level}: saving throws roll ${row.saves} d20`, async () => {
    kit.reset(hero.id, { exhaustion: row.level });
    const asked = await kit.withDice([17, 3], "request_roll", {
      characterId: hero.id, kind: "saving_throw", ability: "wis", dc: 10,
    });
    assert.equal(kit.d20s(asked.dice), row.saves);
    assert.equal(asked.result.total, row.saves === 2 ? 3 : 17);
    const forced = await kit.withDice([17, 3, 1], "cast_at_player", {
      characterId: hero.id, spell: "Gaze", source: "a gaze", saveAbility: "wis", dc: 10,
      damage: "1d4",
    });
    assert.equal(forced.result.saved, row.saves === 1);
  });

  await test(`level ${row.level}: attack rolls roll ${row.attacks} d20`, async () => {
    kit.reset(hero.id, { exhaustion: row.level });
    kit.resetEnemy(goblin.id);
    const out = await kit.swing([17, 3, 4], hero.id, goblin.id, { weapon: "Longsword" });
    assert.equal(out.outcome.ok, true, out.outcome.error);
    assert.equal(kit.d20s(out.dice), row.attacks);
    assert.equal(out.result.hit, row.attacks === 1);
  });

  await test(`level ${row.level}: speed ${row.speed} ft on the board`, () => {
    assert.equal(boardSpeeds[row.level], row.speed);
  });
}

await test("exhaustion and a condition that gives advantage cancel to a straight roll", async () => {
  kit.reset(hero.id, { exhaustion: 3 });
  kit.resetEnemy(goblin.id, ["restrained"]);
  const out = await kit.swing([17, 3, 4], hero.id, goblin.id, { weapon: "Longsword" });
  assert.equal(kit.d20s(out.dice), 1);
  kit.resetEnemy(goblin.id);
});

await test("At exhaustion level 4 the hit point maximum is halved (SRD 5.1, Exhaustion).", async () => {
  kit.reset(hero.id, { exhaustion: 3 });
  await tire();
  assert.equal(level(), 4);
  await world.invoke("heal", { characterId: hero.id, amount: 100 });
  const now = world.sheet(hero.id).currentHp;
  assert.ok(now <= 20, `level 4 of a 40 hit point maximum and ${now} hit points held`);
});

await test("A creature dead of exhaustion level 6 is dead: it has no hit points and takes no actions.", async () => {
  kit.reset(hero.id, { exhaustion: 5 });
  await tire();
  assert.equal(world.sheet(hero.id).deathSaves?.dead, true);
  kit.resetEnemy(goblin.id);
  const out = await kit.swing([17, 17, 4], hero.id, goblin.id, { weapon: "Longsword" });
  assert.equal(out.outcome.ok, false, "a character dead of exhaustion made an attack roll");
});

await test("From exhaustion level 3 every saving throw is at disadvantage, the save against an area effect included (SRD 5.1, Exhaustion).", async () => {
  kit.reset(hero.id, { exhaustion: 3 });
  const out = await kit.withDice([6, 17, 3], "aoe_damage", {
    damage: "1d6", saveAbility: "wis", dc: 10, halfOnSave: false, characterIds: [hero.id],
  });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  assert.equal(kit.d20s(out.dice), 2, `the save rolled ${out.dice.join(" ")}`);
});

await test("From exhaustion level 3 every saving throw is at disadvantage: the save that ends a condition and the death saving throw are saving throws (SRD 5.1, Exhaustion).", async () => {
  kit.reset(hero.id, { exhaustion: 3 });
  await world.invoke("set_condition", {
    characterId: hero.id, condition: "frightened", saveAbility: "wis", saveDc: 10,
  });
  world.clearDice();
  world.diceLog();
  world.dice(17, 3);
  const round = world.encounter().round;
  for (let turn = 0; turn < 4 && world.encounter().round === round; turn += 1) {
    kit.skipTurn();
  }
  world.clearDice();
  const dice = kit.rolled();
  assert.equal(kit.d20s(dice), 2, `the save to end it rolled ${dice.join(" ")}`);
});

await test("reaching level 4 takes the hit points above the halved maximum, and they do not come back with the level", async () => {
  kit.reset(hero.id, { exhaustion: 3 });
  assert.equal(world.sheet(hero.id).currentHp, 40);
  await tire();
  assert.equal(world.sheet(hero.id).currentHp, 20);
  assert.equal(world.sheet(hero.id).maxHp, 40, "the stored maximum is the sheet's own number");
  // An odd maximum halves down.
  world.patch(hero.id, { maxHp: 41, exhaustion: 3, currentHp: 41 });
  await tire();
  assert.equal(world.sheet(hero.id).currentHp, 20);
  world.patch(hero.id, { maxHp: 40 });
  // Below the half nothing is taken.
  kit.reset(hero.id, { exhaustion: 3, currentHp: 9 });
  await tire();
  assert.equal(world.sheet(hero.id).currentHp, 9);
  // One level cured: the maximum is whole again and the hit points are what they were.
  const cured = await world.invoke("clear_condition", { characterId: hero.id, condition: "exhaustion" });
  assert.equal(cured.ok, true, cured.error);
  assert.equal(level(), 3);
  assert.equal(world.sheet(hero.id).currentHp, 9);
  await world.invoke("heal", { characterId: hero.id, amount: 100 });
  assert.equal(world.sheet(hero.id).currentHp, 40);
});

await test("massive damage is measured against the halved maximum at level 4", async () => {
  // 5 hit points of a 40 maximum halved to 20: 25 leaves 20 over and kills.
  kit.reset(hero.id, { exhaustion: 4, currentHp: 5 });
  await world.invoke("apply_damage", { characterId: hero.id, amount: 24 });
  assert.equal(world.sheet(hero.id).deathSaves?.dead, false);
  kit.reset(hero.id, { exhaustion: 4, currentHp: 5 });
  await world.invoke("apply_damage", { characterId: hero.id, amount: 25 });
  assert.equal(world.sheet(hero.id).deathSaves?.dead, true);
});

await test("death by exhaustion leaves no hit points", async () => {
  kit.reset(hero.id, { exhaustion: 5, currentHp: 31, concentratingOn: "Bless" });
  await tire();
  const dead = world.sheet(hero.id);
  assert.equal(dead.currentHp, 0);
  assert.deepEqual(dead.deathSaves, { successes: 0, failures: 3, stable: false, dead: true });
  assert.equal(dead.concentratingOn, null);
});

await test("the death saving throw is at disadvantage from level 3", async () => {
  kit.reset(hero.id, { exhaustion: 3, currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  world.clearDice();
  world.diceLog();
  world.dice(17, 3);
  // The save the pointer rolls on passing a dying character, called as the
  // pointer calls it: this table has nobody else for the pointer to rest on.
  const { rollDeathSave } = await import("../src/lib/dm/death.ts");
  rollDeathSave(world.campaign(), hero.id);
  world.clearDice();
  const dice = kit.rolled();
  assert.equal(kit.d20s(dice), 2, `the death save rolled ${dice.join(" ")}`);
  // The lower face is kept: a 3 fails.
  assert.equal(world.sheet(hero.id).deathSaves.failures, 1);
});

kit.reset(hero.id);
world.close();
finish();
