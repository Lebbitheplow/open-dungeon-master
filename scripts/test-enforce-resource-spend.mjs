// Spending a limited-use feature, through the engine a DM reaches
// (use_resource in src/lib/dm/resource-tools.ts, dispatched by
// src/lib/dm/mutations.ts). Every check reads the sheet back from the
// database after the call.
//
//   the counter   a spend at nothing left is refused and changes nothing; a
//                 counter never leaves 0..max through any run of spends,
//                 rests and level changes; a feature the character does not
//                 have cannot be spent; an amount is a whole number the pool
//                 can cover
//   the effect    Second Wind heals 1d10 + FIGHTER level; Lay on Hands moves
//                 exactly the points spent and never past the target's
//                 maximum; Rage is a condition with real riders (resistance to
//                 bludgeoning, piercing and slashing, advantage on Strength
//                 checks) that lasts 1 minute and ends at 0 hit points;
//                 Bardic Inspiration is a die another creature holds for 10
//                 minutes and spends on one d20 roll; Channel Divinity is once
//                 between rests at cleric 2
//
// Findings recorded here: an amount of zero or less is spent as one; Rage
// works in heavy armor and outlives a turn with no attack made and no damage
// taken; no feature is charged to the action economy, so Second Wind and Rage
// cost no bonus action. (That Action Surge buys no action is the same root
// cause and is held by test-enforce-action-economy.mjs.)
import assert from "node:assert/strict";
import {
  aDayLater,
  assertInBounds,
  beginBoardlessFight,
  openTable,
  refusedUnchanged,
  rolled,
  setUsed,
} from "./lib/enforce-resources.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-resource-spend");
const world = await openTable();
const { skipCurrentTurn } = await import("../src/lib/dm/encounter-tools.ts");

const spend = (table, characterId, resource, extra = {}) =>
  table.invoke("use_resource", { characterId, resource, ...extra });
const used = (table, id, name) => table.sheet(id).resources[name].used;
const ALL_ARMOR = {
  saves: [], skills: [], expertise: [], languages: ["Common"], tools: [],
  armor: ["light", "medium", "heavy", "shields"], weapons: ["simple", "martial"],
};

// ---- the counter ----

await test("a spend with nothing left is refused and the sheet does not move", async () => {
  const roster = [
    ["barbarian", 3, "Rage", "rage"],
    ["monk", 4, "Ki Points", "ki"],
    ["fighter", 5, "Second Wind", "second_wind"],
    ["fighter", 5, "Action Surge", "action_surge"],
    ["cleric", 2, "Channel Divinity", "channel_divinity"],
    ["paladin", 3, "Lay on Hands", "lay_on_hands"],
    ["paladin", 3, "Divine Sense", "divine_sense"],
    ["sorcerer", 4, "Sorcery Points", "sorcery_points"],
  ];
  for (const [classId, level, name, id] of roster) {
    const hero = world.addHero({ class: classId, level, abilities: { cha: 14 } });
    setUsed(world, hero.id, { [id]: hero.resources[id].max });
    await refusedUnchanged(world, hero.id, () => spend(world, hero.id, name), name);
  }
});

await test("a feature the character does not have cannot be spent", async () => {
  const fighter = world.addHero({ class: "fighter", level: 5 });
  for (const name of ["Rage", "Ki Points", "Lay on Hands", "Wild Shape", "Wish Engine", "  "]) {
    await refusedUnchanged(world, fighter.id, () => spend(world, fighter.id, name), name);
  }
});

await test("several points go at once, and never more than the pool holds", async () => {
  const monk = world.addHero({ class: "monk", level: 6 });
  const three = await spend(world, monk.id, "Ki Points", { amount: 3 });
  assert.equal(three.ok, true, three.error);
  assert.deepEqual(world.sheet(monk.id).resources.ki, { max: 6, used: 3 });
  await refusedUnchanged(world, monk.id, () => spend(world, monk.id, "Ki Points", { amount: 4 }), "4 of 3");
  for (const amount of [1.5, 9999, Number.MAX_SAFE_INTEGER, "many"]) {
    await refusedUnchanged(
      world,
      monk.id,
      () => spend(world, monk.id, "Ki Points", { amount }),
      `amount ${amount}`,
    );
  }
  const rest = await spend(world, monk.id, "Ki Points", { amount: 3 });
  assert.equal(rest.ok, true, rest.error);
  assert.deepEqual(world.sheet(monk.id).resources.ki, { max: 6, used: 6 });
});

await test("a counter stays inside 0..max through any run of spends, rests and level changes", async () => {
  const monk = world.addHero({ class: "monk", level: 6 });
  let model = { max: 6, used: 0 };
  const steps = [
    ["spend", 1], ["spend", 5], ["spend", 1], ["short"], ["spend", 6], ["level", 3],
    ["spend", 1], ["long"], ["spend", 3], ["spend", 1], ["level", 10], ["spend", 7],
    ["spend", 1], ["level", 2], ["short"], ["spend", 2], ["spend", 1], ["long"],
  ];
  for (const [kind, value] of steps) {
    if (kind === "spend") {
      const outcome = await spend(world, monk.id, "Ki Points", { amount: value });
      const affordable = model.max - model.used >= value;
      assert.equal(outcome.ok, affordable, `spend ${value} at ${model.used}/${model.max}`);
      model = affordable ? { ...model, used: model.used + value } : model;
    } else if (kind === "level") {
      world.patch(monk.id, { level: value });
      model = { max: value, used: Math.min(model.used, value) };
    } else {
      if (kind === "long") {
        await aDayLater(world);
      }
      const rest = await world.invoke("take_rest", { kind });
      assert.equal(rest.ok, true, rest.error);
      model = { ...model, used: 0 };
    }
    assert.deepEqual(assertInBounds(world, monk.id, kind).resources.ki, model, `${kind} ${value ?? ""}`);
  }
});

await test("a character at 0 hit points spends nothing", async () => {
  const fighter = world.addHero({ class: "fighter", level: 5 });
  world.patch(fighter.id, {
    currentHp: 0,
    deathSaves: { successes: 0, failures: 0, stable: true, dead: false },
  });
  for (const name of ["Second Wind", "Action Surge"]) {
    await refusedUnchanged(world, fighter.id, () => spend(world, fighter.id, name), name);
  }
});

await test("Arcane Recovery is part of a short rest and cannot be spent by hand", async () => {
  const wizard = world.addHero({ class: "wizard", level: 5 });
  await refusedUnchanged(world, wizard.id, () => spend(world, wizard.id, "Arcane Recovery"));
});

// ---- the effects ----

await test("Second Wind heals 1d10 + fighter level, never past the maximum", async () => {
  const fighter = world.addHero({ class: "fighter", level: 5, maxHp: 44 });
  world.patch(fighter.id, { currentHp: 10 });
  world.diceLog();
  world.dice(7);
  const wind = await spend(world, fighter.id, "Second Wind");
  assert.equal(wind.ok, true, wind.error);
  assert.deepEqual(rolled(world), [[10, 7]]);
  assert.equal(world.sheet(fighter.id).currentHp, 10 + 7 + 5);
  assert.equal(used(world, fighter.id, "second_wind"), 1);

  const hale = world.addHero({ class: "fighter", level: 5, maxHp: 44 });
  world.patch(hale.id, { currentHp: 40 });
  world.dice(10);
  await spend(world, hale.id, "Second Wind");
  rolled(world);
  assert.equal(world.sheet(hale.id).currentHp, 44);
});

await test("a multiclass fighter's Second Wind adds the fighter levels, not the character level", async () => {
  const mixed = world.addHero({
    class: "fighter",
    level: 5,
    maxHp: 40,
    classes: [
      { id: "fighter", subclass: "", level: 2 },
      { id: "rogue", subclass: "", level: 3 },
    ],
    hitDice: { die: "d10", total: 5, spent: 0 },
    hitDicePools: [
      { classId: "fighter", die: "d10", total: 2, spent: 0 },
      { classId: "rogue", die: "d8", total: 3, spent: 0 },
    ],
  });
  world.patch(mixed.id, { currentHp: 10 });
  world.diceLog();
  world.dice(4);
  const wind = await spend(world, mixed.id, "Second Wind");
  assert.equal(wind.ok, true, wind.error);
  assert.deepEqual(rolled(world), [[10, 4]]);
  assert.equal(world.sheet(mixed.id).currentHp, 10 + 4 + 2);
});

await test("Lay on Hands heals exactly the points spent, from a pool of 5 x level", async () => {
  const paladin = world.addHero({ class: "paladin", level: 4, maxHp: 36 });
  const friend = world.addHero({ class: "rogue", level: 4, maxHp: 30 });
  world.patch(friend.id, { currentHp: 5 });
  const touch = await spend(world, paladin.id, "Lay on Hands", { amount: 7, targetCharacterId: friend.id });
  assert.equal(touch.ok, true, touch.error);
  assert.equal(world.sheet(friend.id).currentHp, 12);
  assert.deepEqual(world.sheet(paladin.id).resources.lay_on_hands, { max: 20, used: 7 });

  // The pool cannot be overdrawn.
  const before = world.sheet(friend.id).currentHp;
  await refusedUnchanged(
    world,
    paladin.id,
    () => spend(world, paladin.id, "Lay on Hands", { amount: 14, targetCharacterId: friend.id }),
    "14 of 13",
  );
  assert.equal(world.sheet(friend.id).currentHp, before);

  // Nor can the target be healed past their maximum.
  world.patch(friend.id, { currentHp: 27 });
  await spend(world, paladin.id, "Lay on Hands", { amount: 13, targetCharacterId: friend.id });
  assert.equal(world.sheet(friend.id).currentHp, 30);
  assert.deepEqual(world.sheet(paladin.id).resources.lay_on_hands, { max: 20, used: 20 });
});

await test("Lay on Hands cannot raise the dead, and the points stay in the pool", async () => {
  const paladin = world.addHero({ class: "paladin", level: 4 });
  const fallen = world.addHero({ class: "rogue", level: 4 });
  world.patch(fallen.id, {
    currentHp: 0,
    deathSaves: { successes: 0, failures: 3, stable: false, dead: true },
  });
  await refusedUnchanged(
    world,
    paladin.id,
    () => spend(world, paladin.id, "Lay on Hands", { amount: 5, targetCharacterId: fallen.id }),
  );
  assert.equal(world.sheet(fallen.id).currentHp, 0);
  assert.equal(world.sheet(fallen.id).deathSaves.dead, true);
});

await test("Rage is a condition with real riders, and lasts one minute", async () => {
  const barbarian = world.addHero({ class: "barbarian", level: 3, maxHp: 40, abilities: { str: 16 } });
  const rage = await spend(world, barbarian.id, "Rage");
  assert.equal(rage.ok, true, rage.error);
  let sheet = world.sheet(barbarian.id);
  assert.deepEqual(sheet.resources.rage, { max: 3, used: 1 });
  assert.deepEqual(sheet.conditions, ["raging"]);
  // Ten rounds of six seconds.
  assert.deepEqual(sheet.conditionMeta, { raging: { rounds: 10 } });

  // Raging again while raging is refused and spends nothing.
  await refusedUnchanged(world, barbarian.id, () => spend(world, barbarian.id, "Rage"));

  // Resistance to bludgeoning, piercing and slashing, and to nothing else.
  for (const [type, taken] of [["slashing", 5], ["piercing", 5], ["bludgeoning", 5], ["fire", 10]]) {
    const before = world.sheet(barbarian.id).currentHp;
    await world.invoke("apply_damage", { characterId: barbarian.id, amount: 10, type, reason: "test" });
    assert.equal(before - world.sheet(barbarian.id).currentHp, taken, type);
  }

  // Advantage on Strength checks: two d20s, the higher kept.
  world.diceLog();
  world.dice(3, 17);
  const check = await world.invoke("request_roll", {
    characterId: barbarian.id,
    kind: "ability_check",
    ability: "str",
    reason: "test",
  });
  assert.deepEqual(rolled(world), [[20, 3], [20, 17]]);
  assert.equal(check.result.total, 17 + 3);

  const passed = await world.invoke("pass_time", { amount: 1, unit: "minutes" });
  assert.equal(passed.ok, true, passed.error);
  sheet = world.sheet(barbarian.id);
  assert.deepEqual(sheet.conditions, []);
  assert.deepEqual(sheet.conditionMeta, {});
  assert.deepEqual(sheet.resources.rage, { max: 3, used: 1 });
});

await test("a rage ends when the barbarian falls to 0 hit points", async () => {
  const barbarian = world.addHero({ class: "barbarian", level: 3, maxHp: 40 });
  await spend(world, barbarian.id, "Rage");
  await world.invoke("apply_damage", { characterId: barbarian.id, amount: 45, reason: "test" });
  const sheet = world.sheet(barbarian.id);
  assert.equal(sheet.currentHp, 0);
  assert.deepEqual(sheet.conditions.filter((name) => name === "raging"), []);
  assert.equal(sheet.conditionMeta.raging, undefined);
});

await test("Bardic Inspiration is a die another creature holds and spends on one d20 roll", async () => {
  const bard = world.addHero({ class: "bard", level: 5, abilities: { cha: 16 } });
  const friend = world.addHero({ class: "fighter", level: 5, abilities: { str: 14 } });
  // Never to the bard themselves.
  await refusedUnchanged(world, bard.id, () => spend(world, bard.id, "Bardic Inspiration"));

  const given = await spend(world, bard.id, "Bardic Inspiration", { targetCharacterId: friend.id });
  assert.equal(given.ok, true, given.error);
  assert.deepEqual(world.sheet(bard.id).resources.bardic_inspiration, { max: 3, used: 1 });
  // A d8 at bard 5, held for 10 minutes (100 rounds).
  assert.deepEqual(world.sheet(friend.id).conditions, ["bardic inspiration (d8)"]);
  assert.deepEqual(world.sheet(friend.id).conditionMeta, { "bardic inspiration (d8)": { rounds: 100 } });

  // One die at a time: a second is refused and costs the bard nothing.
  await refusedUnchanged(
    world,
    bard.id,
    () => spend(world, bard.id, "Bardic Inspiration", { targetCharacterId: friend.id }),
  );

  world.diceLog();
  world.dice(10, 6);
  const check = await world.invoke("request_roll", {
    characterId: friend.id,
    kind: "ability_check",
    ability: "str",
    reason: "test",
  });
  assert.deepEqual(rolled(world), [[20, 10], [8, 6]]);
  assert.equal(check.result.total, 10 + 2 + 6);
  assert.deepEqual(world.sheet(friend.id).conditions, []);

  // The next roll has no die to add.
  world.dice(10);
  const plain = await world.invoke("request_roll", {
    characterId: friend.id,
    kind: "ability_check",
    ability: "str",
    reason: "test",
  });
  assert.deepEqual(rolled(world), [[20, 10]]);
  assert.equal(plain.result.total, 12);
});

await test("an unspent inspiration die is gone after 10 minutes", async () => {
  const bard = world.addHero({ class: "bard", level: 1, abilities: { cha: 16 } });
  const friend = world.addHero({ class: "fighter", level: 1 });
  await spend(world, bard.id, "Bardic Inspiration", { targetCharacterId: friend.id });
  await world.invoke("pass_time", { amount: 9, unit: "minutes" });
  assert.deepEqual(world.sheet(friend.id).conditions, ["bardic inspiration (d6)"]);
  await world.invoke("pass_time", { amount: 1, unit: "minutes" });
  assert.deepEqual(world.sheet(friend.id).conditions, []);
  assert.equal(used(world, bard.id, "bardic_inspiration"), 1);
});

await test("Channel Divinity at cleric 2 is once between rests", async () => {
  const table = await openTable();
  const cleric = table.addHero({ class: "cleric", level: 2 });
  assert.equal((await spend(table, cleric.id, "Channel Divinity")).ok, true);
  await refusedUnchanged(table, cleric.id, () => spend(table, cleric.id, "Channel Divinity"));
  assert.equal((await table.invoke("take_rest", { kind: "short" })).ok, true);
  assert.deepEqual(table.sheet(cleric.id).resources.channel_divinity, { max: 1, used: 0 });
  assert.equal((await spend(table, cleric.id, "Channel Divinity")).ok, true);
  await refusedUnchanged(table, cleric.id, () => spend(table, cleric.id, "Channel Divinity"));
});

// ---- findings ----

await test("An amount to spend is a whole number of at least one; zero or a negative number is not a spend.", async () => {
  const paladin = world.addHero({ class: "paladin", level: 4 });
  for (const amount of [0, -5]) {
    await refusedUnchanged(
      world,
      paladin.id,
      () => spend(world, paladin.id, "Lay on Hands", { amount }),
      `amount ${amount}`,
    );
  }
});

await test("A barbarian gains the benefits of Rage only while not wearing heavy armor.", async () => {
  const barbarian = world.addHero({
    class: "barbarian",
    level: 3,
    maxHp: 40,
    acOverride: false,
    proficiencies: ALL_ARMOR,
    equipment: [{ name: "Plate", qty: 1, equipped: true }],
  });
  assert.equal(barbarian.ac, 18, "the plate is worn");
  await spend(world, barbarian.id, "Rage");
  await world.invoke("apply_damage", { characterId: barbarian.id, amount: 10, type: "slashing", reason: "test" });
  assert.equal(world.sheet(barbarian.id).currentHp, 30);
});

await test("A rage ends early if the barbarian's turn ends and they have neither attacked a hostile creature nor taken damage since their last turn.", async () => {
  const table = await openTable();
  const barbarian = table.addHero({ class: "barbarian", level: 3, maxHp: 40 });
  await beginBoardlessFight(table, [{ monster: "goblin", count: 1 }], { heroFaces: { [barbarian.id]: 20 } });
  await spend(table, barbarian.id, "Rage");
  // The barbarian's turn passes with no attack, the goblin's with none
  // either, and the barbarian's second turn passes the same way.
  for (let turn = 0; turn < 3; turn += 1) {
    assert.equal(skipCurrentTurn(table.campaignId), true);
  }
  assert.equal(table.sheet(barbarian.id).currentHp, 40, "no damage was taken");
  assert.deepEqual(table.sheet(barbarian.id).conditions, []);
});

await test("Second Wind and Rage each take the bonus action of the turn they are used on, and a turn has one.", async () => {
  const table = await openTable();
  const fighter = table.addHero({ class: "fighter", level: 2, maxHp: 20 });
  await beginBoardlessFight(table, [{ monster: "goblin", count: 1 }], { heroFaces: { [fighter.id]: 20 } });
  table.patch(fighter.id, { currentHp: 5 });
  table.dice(5);
  const wind = await spend(table, fighter.id, "Second Wind");
  table.clearDice();
  assert.equal(wind.ok, true, wind.error);
  assert.equal(table.encounter().turnBudget?.bonusUsed, true);
});

// ---- the turn pays for it ----

await test("a turn has one bonus action: Second Wind takes it, and a second bonus feature is refused unspent", async () => {
  const table = await openTable();
  // A fighter with a barbarian's rage on the sheet, so two bonus-action
  // features stand side by side.
  const fighter = table.addHero({
    class: "fighter",
    level: 2,
    maxHp: 20,
    features: [{ name: "Rage", source: "story" }],
  });
  assert.ok(table.sheet(fighter.id).resources.rage, "the story feature brought its counter");
  await beginBoardlessFight(table, [{ monster: "goblin", count: 1 }], { heroFaces: { [fighter.id]: 20 } });
  table.patch(fighter.id, { currentHp: 5 });
  table.dice(5);
  assert.equal((await spend(table, fighter.id, "Second Wind")).ok, true);
  table.clearDice();
  await refusedUnchanged(table, fighter.id, () => spend(table, fighter.id, "Rage"), "a second bonus action");
  // The action is still theirs.
  assert.equal(table.encounter().turnBudget.actionUsed, false);
});

await test("off their own turn a character uses no feature that costs the turn anything", async () => {
  const table = await openTable();
  const first = table.addHero({ class: "fighter", level: 2, maxHp: 20 });
  const second = table.addHero({ class: "fighter", level: 2, maxHp: 20 });
  await beginBoardlessFight(table, [{ monster: "goblin", count: 1 }], {
    heroFaces: { [first.id]: 20, [second.id]: 5 },
  });
  table.patch(second.id, { currentHp: 5 });
  for (const name of ["Second Wind", "Action Surge"]) {
    await refusedUnchanged(table, second.id, () => spend(table, second.id, name), name);
  }
  assert.deepEqual(rolled(table), [], "a refused Second Wind rolled its die");
  assert.equal(table.encounter().turnBudget, null);
});

await test("Action Surge costs nothing and buys a second action on the turn it is used", async () => {
  const table = await openTable();
  const fighter = table.addHero({ class: "fighter", level: 2, maxHp: 20 });
  await beginBoardlessFight(table, [{ monster: "goblin", count: 1 }], { heroFaces: { [fighter.id]: 20 } });
  const act = (action) => table.invoke("take_action", { characterId: fighter.id, action });
  assert.equal((await act("dodge")).ok, true);
  assert.equal((await act("dash")).ok, false, "a second action with no surge");
  const surge = await spend(table, fighter.id, "Action Surge");
  assert.equal(surge.ok, true, surge.error);
  assert.equal(table.encounter().turnBudget.bonusUsed, false);
  assert.equal((await act("dash")).ok, true, "the action the surge bought");
  assert.equal((await act("disengage")).ok, false, "and no third");
});

await test("out of a fight a feature costs no turn, and an incapacitated character uses none", async () => {
  const table = await openTable();
  const fighter = table.addHero({ class: "fighter", level: 2, maxHp: 20 });
  table.patch(fighter.id, { currentHp: 5, conditions: ["stunned"] });
  await refusedUnchanged(table, fighter.id, () => spend(table, fighter.id, "Second Wind"), "stunned");
  table.patch(fighter.id, { conditions: [] });
  table.dice(4);
  assert.equal((await spend(table, fighter.id, "Second Wind")).ok, true);
  table.clearDice();
  assert.equal((await spend(table, fighter.id, "Action Surge")).ok, true);
});

await test("a rage that is fed lasts: an attack made or damage taken since the last turn keeps it", async () => {
  const table = await openTable();
  const barbarian = table.addHero({
    class: "barbarian",
    level: 3,
    maxHp: 40,
    abilities: { str: 16 },
    equipment: [{ name: "Greataxe", qty: 1 }],
    proficiencies: ALL_ARMOR,
  });
  await beginBoardlessFight(table, [{ monster: "goblin", count: 1 }], { heroFaces: { [barbarian.id]: 20 } });
  const [goblin] = table.enemies();
  const { getDatabase } = await import("../src/lib/db/core.ts");
  getDatabase().prepare("UPDATE encounter_enemies SET max_hp = 500, current_hp = 500 WHERE id = ?").run(goblin.id);
  assert.equal((await spend(table, barbarian.id, "Rage")).ok, true);
  // Turn one: an attack, hit or miss.
  table.dice(10, 6);
  const swing = await table.invoke("pc_attack", {
    characterId: barbarian.id, enemyId: goblin.id, targetEnemyId: goblin.id, weapon: "Greataxe",
  });
  table.clearDice();
  assert.equal(swing.ok, true, swing.error);
  assert.equal(skipCurrentTurn(table.campaignId), true);
  assert.deepEqual(table.sheet(barbarian.id).conditions, ["raging"], "the attack fed the rage");
  // Turn two: no attack, but a wound taken.
  await table.invoke("apply_damage", { characterId: barbarian.id, amount: 4, type: "fire" });
  assert.equal(skipCurrentTurn(table.campaignId), true);
  assert.deepEqual(table.sheet(barbarian.id).conditions, ["raging"], "the wound fed the rage");
  assert.equal(table.sheet(barbarian.id).conditionMeta.raging.stoked, undefined);
  // Turn three: nothing at all.
  assert.equal(skipCurrentTurn(table.campaignId), true);
  assert.deepEqual(table.sheet(barbarian.id).conditions, []);
});

await test("an unlimited feature is used and never counted down", async () => {
  const table = await openTable();
  const barbarian = table.addHero({ class: "barbarian", level: 20, maxHp: 200 });
  for (let rage = 0; rage < 8; rage += 1) {
    const out = await spend(table, barbarian.id, "Rage");
    assert.equal(out.ok, true, `rage ${rage + 1}: ${out.error}`);
    await table.invoke("clear_condition", { characterId: barbarian.id, condition: "raging" });
  }
  assert.equal(used(table, barbarian.id, "rage"), 0);
});

world.close();
finish();
