// What a multiclassed character's numbers are counted from, on sheets the
// level-up route built and through the engines that read them.
//
// The rules guarded here are SRD 5.1's "Multiclassing: Class Features" and
// ODM's statement of them (docs/rules-coverage.md, "Multiclassing"):
//
// - Proficiency bonus and cantrip damage follow CHARACTER level.
// - Class features follow CLASS level: a fighter 4 / rogue 4 is an 8th-level
//   character with no Extra Attack. Sneak Attack, Martial Arts, Rage, ki,
//   Lay on Hands, Second Wind and sorcery points all count the levels of the
//   class that grants them.
// - Extra Attack from two classes does not add up; only the fighter's own
//   later versions raise it. Unarmored Defense is gained once, from the
//   first class that offered it. Channel Divinity from two classes gives
//   both sets of effects and no extra use.
// - Hit dice are spent and recovered per class, never below none spent or
//   above the pool.
//
// ODM's documented deviation (docs/rules-coverage.md, "Kept
// simplifications"): Ability Score Improvements come at CHARACTER levels 4,
// 8, 12, 16 and 19. SRD 5.1 grants them by class level, with two more for a
// fighter (6, 14) and one more for a rogue (10). Pinned below as ODM's rule.
import assert from "node:assert/strict";
import { assertCoherent, openTable, scores } from "./lib/enforce-multiclass.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-multiclass-features");
const table = await openTable();
const { world, send, hero, now, levelInto } = table;
const { getDatabase } = await import("../src/lib/db/core.ts");
const { computeSheetDerived } = await import("../src/lib/srd/index.ts");
const { combatRiders } = await import("../src/lib/srd/feature-effects.ts");
const { attacksAllowedFor } = await import("../src/lib/dm/action-tools.ts");
const { ragingMeleeBonus } = await import("../src/lib/dm/attack-logic.ts");
const { ASI_LEVELS, crossedAsiLevels, earnedAsiCount } = await import("../src/lib/srd/asi.ts");

const all13 = scores({ str: 13, dex: 13, con: 13, int: 13, wis: 13, cha: 13 });
const has = (name) => now().features.some((feature) => feature.name === name);
const count = (pattern) => now().features.filter((feature) => pattern.test(feature.name)).length;

// SRD 5.1 class tables, by class level.
const sneakDice = (level) => Math.ceil(level / 2);
const martialArts = (level) => (level >= 17 ? "d10" : level >= 11 ? "d8" : level >= 5 ? "d6" : "d4");
const rages = (level) => (level >= 17 ? 6 : level >= 12 ? 5 : level >= 6 ? 4 : level >= 3 ? 3 : 2);
const rageDamage = (level) => (level >= 16 ? 4 : level >= 9 ? 3 : 2);

// A fight with no board: distance and sightlines are another suite's rules.
async function fightGoblin() {
  const encounter = await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [now().id]: 20 } });
  getDatabase().prepare("DELETE FROM battle_maps WHERE encounter_id = ?").run(encounter.id);
  return world.enemies()[0];
}
const endFight = () => world.invoke("end_encounter", { outcome: "test over" });

await test("proficiency bonus follows character level at every level", async () => {
  hero({ class: "fighter", level: 1, abilities: all13, proficiencies: {
    saves: ["str", "con"], skills: ["athletics"], expertise: [], languages: [], tools: [], armor: [], weapons: [],
  } });
  for (let level = 2; level <= 20; level += 1) {
    await levelInto(level % 2 ? "fighter" : "rogue");
    const derived = computeSheetDerived(now());
    assert.equal(now().level, level);
    assert.equal(derived.proficiencyBonus, proficiencyBonus(level), `level ${level}`);
    assert.equal(derived.saves.str, abilityMod(13) + proficiencyBonus(level), `level ${level} save`);
    assert.equal(derived.skills.athletics, abilityMod(13) + proficiencyBonus(level), `level ${level} skill`);
  }
});

await test("class features wait for class levels, not character levels", async () => {
  hero({ class: "fighter", level: 4, abilities: all13 });
  await levelInto("rogue", 4);
  assert.equal(now().level, 8);
  for (const name of ["Extra Attack", "Uncanny Dodge", "Indomitable (1 use)", "Evasion"]) {
    assert.equal(has(name), false, `an 8th-level fighter 4 / rogue 4 holds ${name}`);
  }
  assert.equal(attacksAllowedFor(now()), 1);
  await levelInto("fighter");
  assert.equal(has("Extra Attack"), true);
  assert.equal(attacksAllowedFor(now()), 2);
  await levelInto("rogue");
  assert.equal(has("Uncanny Dodge"), true);
  // Every class feature says which class granted it.
  for (const feature of now().features.filter((entry) => entry.source === "class")) {
    assert.ok(["fighter", "rogue"].includes(feature.classId), `${feature.name} names no class`);
  }
});

await test("Extra Attack from two classes is still two attacks", async () => {
  for (const [from, to] of [["fighter", "paladin"], ["paladin", "ranger"], ["barbarian", "monk"], ["ranger", "fighter"]]) {
    hero({ class: from, level: 5, abilities: all13 });
    await levelInto(to, 5);
    assert.equal(count(/^extra attack/i), 1, `${from} 5 / ${to} 5`);
    assert.equal(attacksAllowedFor(now()), 2, `${from} 5 / ${to} 5`);
  }
  // Only the fighter's own third attack, at fighter 11, raises it.
  hero({ class: "paladin", level: 5, abilities: all13 });
  await levelInto("fighter", 10);
  assert.equal(attacksAllowedFor(now()), 2, "paladin 5 / fighter 10");
  await levelInto("fighter");
  assert.equal(attacksAllowedFor(now()), 3, "paladin 5 / fighter 11");
});

await test("the turn gives a fighter 5 / paladin 5 two swings and refuses a third", async () => {
  hero({ class: "fighter", level: 5, abilities: all13, equipment: [{ name: "Longsword", qty: 1 }] });
  await levelInto("paladin", 5);
  const goblin = await fightGoblin();
  const swing = () => {
    world.dice(2);
    return world.invoke("pc_attack", { characterId: now().id, enemyId: goblin.id, targetEnemyId: goblin.id, weapon: "Longsword" });
  };
  try {
    for (const label of ["first", "second"]) {
      const out = await swing();
      assert.equal(out.ok, true, `${label} swing: ${out.error}`);
      assert.equal(out.result.hit, false);
    }
    const third = await swing();
    assert.equal(third.ok, false, "a third swing went through");
  } finally {
    world.clearDice();
    await endFight();
  }
});

await test("Unarmored Defense is gained once, from the class that gave it first", async () => {
  const abilities = scores({ str: 13, dex: 14, con: 16, wis: 18 });
  hero({ class: "barbarian", level: 3, abilities, acOverride: false });
  assert.equal(now().ac, 10 + abilityMod(14) + abilityMod(16));
  await levelInto("monk", 5);
  assert.equal(count(/^unarmored defense/i), 1);
  assert.equal(now().ac, 10 + abilityMod(14) + abilityMod(16), "barbarian first: Constitution");
  hero({ class: "monk", level: 3, abilities, acOverride: false });
  assert.equal(now().ac, 10 + abilityMod(14) + abilityMod(18));
  await levelInto("barbarian", 5);
  assert.equal(now().ac, 10 + abilityMod(14) + abilityMod(18), "monk first: Wisdom");
});

await test("Channel Divinity from two classes adds effects, not uses", async () => {
  // Cleric: 1 use at cleric 2, 2 at cleric 6. Paladin: 1 use at paladin 3.
  for (const [clericLevel, paladinLevel, uses] of [[2, 3, 1], [5, 3, 1], [6, 3, 2], [6, 5, 2], [1, 3, 1]]) {
    hero({ class: "cleric", level: clericLevel, abilities: all13 });
    await levelInto("paladin", paladinLevel);
    assert.equal(now().resources.channel_divinity.max, uses, `cleric ${clericLevel} / paladin ${paladinLevel}`);
  }
  const spend = await world.invoke("use_resource", { characterId: now().id, resource: "channel divinity" });
  assert.equal(spend.ok, true, spend.error);
  assert.equal((await world.invoke("use_resource", { characterId: now().id, resource: "channel divinity" })).ok, false);
  assert.deepEqual(now().resources.channel_divinity, { max: 1, used: 1 });
});

await test("Sneak Attack, Martial Arts and Rage count the levels of their own class", async () => {
  for (const level of [1, 2, 3, 5, 6, 9, 11, 12, 16, 17]) {
    hero({ class: "rogue", level, abilities: all13 });
    await levelInto("fighter", 3);
    assert.equal(combatRiders(now()).sneakAttackDice, sneakDice(level), `rogue ${level} / fighter 3`);

    hero({ class: "fighter", level: 3, abilities: all13 });
    await levelInto("monk", level);
    assert.equal(combatRiders(now()).martialArtsDie, martialArts(level), `fighter 3 / monk ${level}`);
    assert.deepEqual(now().resources.ki, level >= 2 ? { max: level, used: 0 } : undefined, `monk ${level} ki`);

    hero({ class: "barbarian", level, abilities: all13 });
    await levelInto("fighter", 3);
    assert.equal(now().resources.rage.max, rages(level), `barbarian ${level} / fighter 3`);
    assert.equal(
      ragingMeleeBonus({ ...now(), conditions: ["raging"] }, { ranged: false, ability: "str" }),
      rageDamage(level),
      `barbarian ${level} rage damage`,
    );
  }
});

await test("Lay on Hands, sorcery points and Second Wind count their own class", async () => {
  for (const level of [1, 2, 4, 7, 9]) {
    hero({ class: "fighter", level: 2, abilities: all13, maxHp: 90 });
    await levelInto("paladin", level);
    assert.deepEqual(now().resources.lay_on_hands, { max: 5 * level, used: 0 }, `paladin ${level}`);
    await levelInto("sorcerer", level);
    assert.deepEqual(
      now().resources.sorcery_points,
      level >= 2 ? { max: level, used: 0 } : undefined,
      `sorcerer ${level}`,
    );
    assertCoherent(now());
  }
  // Second Wind heals 1d10 + fighter level: fighter 2 here, character 20.
  world.patch(now().id, { currentHp: 10 });
  world.dice(4);
  const out = await world.invoke("use_resource", { characterId: now().id, resource: "second wind" });
  assert.equal(out.ok, true, out.error);
  assert.equal(now().currentHp, 10 + 4 + 2);
  assert.equal(world.clearDice(), 0);
});

await test("a cantrip grows with character level, whatever the caster level", async () => {
  // The content pack carries each cantrip's tiers; without it the engine
  // has only the dice the caller sends.
  if (!world.hasPack) {
    return;
  }
  // Fire Bolt: 1d10, 2d10 from character level 5, 3d10 from 11.
  for (const [fighterLevel, dice] of [[3, 1], [4, 2], [9, 2], [10, 3]]) {
    hero({ class: "fighter", level: fighterLevel, abilities: scores({ str: 13, int: 16 }) });
    await levelInto("wizard", 1, { levelUpSpells: ["Fire Bolt"] });
    const goblin = await fightGoblin();
    try {
      world.diceLog();
      world.dice(15, 1, 1, 1);
      const out = await world.invoke("pc_attack", {
        characterId: now().id, enemyId: goblin.id, targetEnemyId: goblin.id, spell: "Fire Bolt", damage: "1d10",
      });
      assert.equal(out.ok, true, out.error);
      const rolled = world.diceLog().filter((die) => die.sides === 10);
      assert.equal(rolled.length, dice, `fighter ${fighterLevel} / wizard 1`);
    } finally {
      world.clearDice();
      await endFight();
    }
  }
});

// ODM's documented simplification, not the SRD's rule: see the header.
await test("Ability Score Improvements come at character levels 4, 8, 12, 16 and 19 (ODM's rule)", () => {
  assert.deepEqual([...ASI_LEVELS], [4, 8, 12, 16, 19]);
  // One level at a time, 1 to 20, each threshold is crossed exactly once:
  // nothing is granted twice and nothing is lost, however the classes split.
  const crossed = [];
  for (let level = 1; level < 20; level += 1) {
    crossed.push(...crossedAsiLevels(level, level + 1));
  }
  assert.deepEqual(crossed, [4, 8, 12, 16, 19]);
  for (let level = 1; level <= 20; level += 1) {
    assert.equal(earnedAsiCount(level), [4, 8, 12, 16, 19].filter((at) => at <= level).length, `level ${level}`);
  }
  // Where ODM and the SRD part: a fighter 3 / rogue 1 has earned one under
  // ODM (character level 4) and none under the SRD (no class at level 4); a
  // fighter 6 has earned one under ODM and two under the SRD.
  assert.equal(earnedAsiCount(3 + 1), 1);
  assert.equal(earnedAsiCount(6), 1);
});

await test("a short rest spends hit dice from the biggest pool first and never past the pools", async () => {
  hero({ class: "fighter", level: 3, abilities: scores({ str: 13, dex: 13, con: 14 }), maxHp: 90 });
  await levelInto("rogue", 2);
  world.patch(now().id, { currentHp: 5 });
  world.diceLog();
  world.dice(10, 10, 8);
  let out = await world.invoke("take_rest", { kind: "short", spend: [{ characterId: now().id, dice: 3 }] });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(world.diceLog().map((die) => die.sides), [10, 10, 10]);
  assert.deepEqual(now().hitDicePools.map((pool) => pool.spent), [3, 0]);
  // Three d10 (10, 10, 8) and Constitution +2 on each die.
  assert.equal(now().currentHp, 5 + 28 + 3 * abilityMod(14));
  assertCoherent(now());
  // Nine more asked for, two left: two d8 are rolled and no more.
  world.dice(8, 8, 8, 8);
  out = await world.invoke("take_rest", { kind: "short", spend: [{ characterId: now().id, dice: 9 }] });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(world.diceLog().map((die) => die.sides), [8, 8]);
  assert.equal(world.clearDice(), 2);
  assert.deepEqual(now().hitDicePools.map((pool) => pool.spent), [3, 2]);
  assertCoherent(now());
  // With none left a rest heals nothing.
  const before = now().currentHp;
  world.patch(now().id, { currentHp: 1 });
  await world.invoke("take_rest", { kind: "short", spend: [{ characterId: now().id, dice: 1 }] });
  assert.equal(now().currentHp, 1, `healed from ${before} with no hit dice left`);
  assert.deepEqual(now().hitDice, { die: "d10", total: 5, spent: 5 });
});

await test("a long rest returns half the hit dice, and never more than were spent", async () => {
  hero({ class: "fighter", level: 3, abilities: all13 });
  await levelInto("rogue", 2);
  await send("usage", "POST", { hitDiceSpent: 5 });
  assert.deepEqual(now().hitDicePools.map((pool) => pool.spent), [3, 2]);
  // Half of five, rounded down, is two; the d10 pool is refilled first.
  await world.invoke("pass_time", { amount: 1, unit: "days" });
  await world.invoke("take_rest", { kind: "long" });
  assert.deepEqual(now().hitDicePools.map((pool) => pool.spent), [1, 2]);
  await world.invoke("pass_time", { amount: 1, unit: "days" });
  await world.invoke("take_rest", { kind: "long" });
  assert.deepEqual(now().hitDicePools.map((pool) => pool.spent), [0, 1]);
  await world.invoke("pass_time", { amount: 1, unit: "days" });
  await world.invoke("take_rest", { kind: "long" });
  await world.invoke("pass_time", { amount: 1, unit: "days" });
  await world.invoke("take_rest", { kind: "long" });
  assert.deepEqual(now().hitDicePools.map((pool) => pool.spent), [0, 0]);
  assertCoherent(now());
});

// ---- not enforced today ----

await test("A paladin has one use of Channel Divinity between rests at every level; only the cleric's table grants a second (cleric 6) and a third (cleric 18).", async () => {
  hero({ class: "fighter", level: 2, abilities: all13 });
  await levelInto("paladin", 6);
  assert.equal(now().resources.channel_divinity.max, 1, "a fighter 2 / paladin 6 has two uses");
});

world.close();
finish();
