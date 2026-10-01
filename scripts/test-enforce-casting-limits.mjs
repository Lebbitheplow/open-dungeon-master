// What stops a cast: the caster's own state, the action economy, and the
// ground between caster and target.
//
// The rules (SRD 5.1): a creature that is incapacitated (and so one that is
// paralyzed, stunned, unconscious or petrified), at 0 hit points, or dead
// takes no actions and casts nothing; a raging barbarian cannot cast or
// concentrate; a druid in Wild Shape cannot cast until Beast Spells at 18th
// level, and a polymorphed creature cannot cast at all; a caster wearing
// armor they are not proficient with cannot cast; casting a spell takes its
// casting time (an action, a bonus action, a reaction), one of each a turn,
// and a bonus action spell leaves only a cantrip for the action; a spell
// reaches its range and needs a clear path to its target.
//
// ODM's own rules, pinned where they differ: every spell ATTACK is given a
// 120 foot range (src/lib/dm/attack-logic.ts spellAttackProfile, "real
// per-spell ranges are not modeled"); a touch spell now reaches only the
// creature beside the caster (the second repair's decision), and
// with no battle map there are no spatial rules at all (map-tools.ts).
// The Hand (src/lib/battlemap/hand-spells.ts) greys out a card for several
// of the rules below; this suite asks the engine, which is what a DM's tool
// call reaches.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { castingState, cleric, fightDummies, freshTurn, layMap, packAnswers, slotsOf, FULL_CASTER_SLOTS, wizard } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-casting-limits");
const pack = await packAnswers();
const worlds = [];

async function table(heroes, count = 1, options = {}) {
  const world = await openWorld();
  worlds.push(world);
  const sheets = heroes.map((hero) => world.addHero(hero));
  const enemies = await fightDummies(world, count, { heroFaces: { [sheets[0].id]: 20 }, ...options });
  return { world, sheets, enemies };
}

// The four ways a player's spell reaches the engine with a save or an effect,
// each as a call this caster could legally make when nothing is wrong.
const castsOf = (hero, enemy) => [
  ["use_spell_slot", { characterId: hero.id, level: 1, spell: "Magic Missile" }],
  ["cast_at_enemy", { characterId: hero.id, targetEnemyId: enemy.id, spell: "Hold Person", saveAbility: "wis", level: 2 }],
  ["cast_buff", { characterId: hero.id, spell: "Blur" }],
  ["aoe_damage", { damage: "3d6", saveAbility: "dex", dc: 14, enemyIds: [enemy.id], casterId: hero.id, spell: "Burning Hands", level: 1 }],
];

// Which of the casts went through while the caster was in `state`.
async function castsAllowed(world, hero, enemy, state) {
  const allowed = [];
  for (const [name, args] of castsOf(hero, enemy)) {
    world.patch(hero.id, {
      currentHp: 30, conditions: [], conditionMeta: {}, deathSaves: null, wildShape: null, concentratingOn: null,
      spellcasting: { ...world.sheet(hero.id).spellcasting, slots: slotsOf(FULL_CASTER_SLOTS[4]) },
      ...state,
    });
    const before = castingState(world.sheet(hero.id));
    // Each cast is asked on a fresh turn: the question is the caster's
    // state, not what the turn has left (that is limit-casting-spends-no-action).
    await freshTurn(world);
    world.dice(1, 1, 1, 1, 1, 1, 1, 1);
    const out = await world.invoke(name, args);
    world.clearDice();
    if (out.ok || castingState(world.sheet(hero.id)) !== before) {
      allowed.push(name);
    }
  }
  return allowed;
}

// ---- the caster's own state ----

const { world: ward, sheets: [mage], enemies: [dummy] } = await table([wizard(5)]);

await test("the fixture's casts all go through for a caster with nothing wrong", async () => {
  assert.deepEqual(await castsAllowed(ward, mage, dummy, {}), castsOf(mage, dummy).map(([name]) => name));
});

await test("an incapacitated caster cannot make a spell attack", async () => {
  for (const condition of ["incapacitated", "paralyzed", "stunned", "unconscious", "petrified"]) {
    ward.patch(mage.id, { conditions: [condition], currentHp: 30 });
    ward.dice(15, 5, 5);
    const out = await ward.invoke("pc_attack", { characterId: mage.id, enemyId: dummy.id, targetEnemyId: dummy.id, spell: "Fire Bolt", damage: "1d10" });
    ward.clearDice();
    assert.equal(out.ok, false, condition);
  }
});

await test("an incapacitated caster casts nothing", async () => {
  const problems = [];
  for (const condition of ["incapacitated", "paralyzed", "stunned", "unconscious", "petrified"]) {
    const allowed = await castsAllowed(ward, mage, dummy, { conditions: [condition] });
    if (allowed.length) {
      problems.push(`${condition}: ${allowed.join(", ")}`);
    }
  }
  assert.deepEqual(problems, [], problems.join("; "));
});

await test("a caster at 0 hit points cannot cast at an enemy, buff, or attack with a spell", async () => {
  ward.patch(mage.id, { currentHp: 0, conditions: [], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  const before = castingState(ward.sheet(mage.id));
  for (const [name, args] of [
    castsOf(mage, dummy)[1],
    castsOf(mage, dummy)[2],
    ["pc_attack", { characterId: mage.id, enemyId: dummy.id, targetEnemyId: dummy.id, spell: "Fire Bolt", damage: "1d10" }],
  ]) {
    const out = await ward.invoke(name, args);
    assert.equal(out.ok, false, name);
  }
  assert.equal(castingState(ward.sheet(mage.id)), before);
});

await test("a caster at 0 hit points or dead casts nothing", async () => {
  const dying = await castsAllowed(ward, mage, dummy, {
    currentHp: 0, deathSaves: { successes: 0, failures: 1, stable: false, dead: false },
  });
  const dead = await castsAllowed(ward, mage, dummy, {
    currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true },
  });
  assert.deepEqual({ dying, dead }, { dying: [], dead: [] }, `dying: ${dying.join(", ")}; dead: ${dead.join(", ")}`);
});

await test("a raging caster casts nothing", async () => {
  const allowed = await castsAllowed(ward, mage, dummy, { conditions: ["raging"], conditionMeta: { raging: { rounds: 10 } } });
  assert.deepEqual(allowed, [], `cast while raging: ${allowed.join(", ")}`);
});

await test("a caster in armor they are not trained in casts nothing", async () => {
  const world = await openWorld();
  worlds.push(world);
  const tin = world.addHero(wizard(5, { acOverride: false, equipment: [{ name: "Plate", qty: 1, equipped: true }] }));
  const [enemy] = await fightDummies(world, 1);
  assert.ok(world.sheet(tin.id).ac >= 18, "the plate is worn");
  const allowed = await castsAllowed(world, tin, enemy, {});
  assert.deepEqual(allowed, [], `cast in plate without training: ${allowed.join(", ")}`);
});

// ---- transformed ----

const druid = (level) => ({
  class: "druid",
  level,
  abilities: { wis: 16 },
  spellcasting: {
    ability: "wis",
    slots: slotsOf(FULL_CASTER_SLOTS[level - 1]),
    known: [],
    prepared: ["Cure Wounds", "Thunderwave", "Faerie Fire"],
    cantrips: ["Poison Spray", "Guidance", "Produce Flame"],
  },
});
const WOLF = { form: "Wolf", beastHp: 11, beastMaxHp: 11, beastAc: 13 };

await test("a druid in Wild Shape cannot spend a slot until Beast Spells", async () => {
  const world = await openWorld();
  worlds.push(world);
  const young = world.addHero(druid(5));
  const elder = world.addHero(druid(18));
  for (const hero of [young, elder]) {
    world.patch(hero.id, { wildShape: WOLF });
  }
  const before = castingState(world.sheet(young.id));
  const refused = await world.invoke("use_spell_slot", { characterId: young.id, level: 1, spell: "Cure Wounds" });
  assert.equal(refused.ok, false);
  assert.equal(castingState(world.sheet(young.id)), before);
  const cast = await world.invoke("use_spell_slot", { characterId: elder.id, level: 1, spell: "Cure Wounds" });
  assert.equal(cast.ok, true, cast.error);
  // Polymorph leaves no mind to cast with, Beast Spells or not.
  world.patch(elder.id, { wildShape: { ...WOLF, kind: "polymorph" } });
  assert.equal((await world.invoke("use_spell_slot", { characterId: elder.id, level: 1, spell: "Cure Wounds" })).ok, false);
});

await test("a druid in Wild Shape casts nothing below 18th level, cantrips included", async () => {
  const { world, sheets: [beast], enemies: [enemy] } = await table([druid(5)]);
  world.patch(beast.id, { wildShape: WOLF });
  const allowed = [];
  for (const [name, args] of [
    ["cast_at_enemy", { characterId: beast.id, targetEnemyId: enemy.id, spell: "Poison Spray", saveAbility: "con", damage: "1d12" }],
    ["cast_buff", { characterId: beast.id, spell: "Guidance" }],
    ["pc_attack", { characterId: beast.id, enemyId: enemy.id, targetEnemyId: enemy.id, spell: "Produce Flame", damage: "1d8" }],
  ]) {
    world.dice(10, 1, 1);
    const out = await world.invoke(name, args);
    world.clearDice();
    if (out.ok) {
      allowed.push(name);
    }
  }
  assert.deepEqual(allowed, [], `cast as a wolf: ${allowed.join(", ")}`);
});

// ---- the action economy ----

await test("casting a spell spends its casting time from the turn", async () => {
  const { world, sheets: [hero], enemies: [enemy] } = await table([wizard(5)]);
  world.dice(1);
  const first = await world.invoke("cast_at_enemy", { characterId: hero.id, targetEnemyId: enemy.id, spell: "Hold Person", saveAbility: "wis", level: 2 });
  world.clearDice();
  assert.equal(first.ok, true, first.error);
  const spent = world.encounter().turnBudget?.actionUsed === true;
  world.dice(1, 1, 1, 1, 1, 1, 1, 1, 1);
  const second = await world.invoke("aoe_damage", { damage: "8d6", saveAbility: "dex", dc: 14, enemyIds: [enemy.id], casterId: hero.id, spell: pack ? "Fireball" : "Burning Hands", level: 3 });
  world.clearDice();
  assert.ok(spent, "Hold Person left the action unspent in the turn budget");
  assert.equal(second.ok, false, "a second levelled spell was cast with the same action");
});

await test("an action spell is cast on the caster's own turn", async () => {
  const { world, sheets: [first, waiting], enemies: [enemy] } = await table([wizard(5), cleric(5)]);
  assert.equal(world.encounter().order[world.encounter().turnIndex].characterId, first.id);
  world.dice(1);
  const out = await world.invoke("cast_at_enemy", { characterId: waiting.id, targetEnemyId: enemy.id, spell: "Hold Person", saveAbility: "wis", level: 2 });
  world.clearDice();
  assert.equal(out.ok, false, "a caster acted on another combatant's turn");
});

await test("the Shield spell is a reaction: one a round, and it costs a slot", async () => {
  const { world, sheets: [hero] } = await table([wizard(5, { acOverride: false })]);
  const ac = world.sheet(hero.id).ac;
  const first = await world.invoke("use_reaction", { characterId: hero.id, feature: "Shield" });
  assert.equal(first.ok, true, first.error);
  assert.equal(world.sheet(hero.id).spellcasting.slots["1"].used, 1);
  assert.deepEqual(world.encounter().reactionsUsed, [hero.id]);
  assert.equal(world.sheet(hero.id).ac, ac + 5);
  const again = await world.invoke("use_reaction", { characterId: hero.id, feature: "Shield" });
  assert.equal(again.ok, false);
  assert.equal(world.sheet(hero.id).spellcasting.slots["1"].used, 1);
});

await test("Shield with no slot left is refused and the reaction is kept", async () => {
  const { world, sheets: [hero] } = await table([wizard(5, { spellcasting: { slots: { 1: { max: 4, used: 4 } } } })]);
  const out = await world.invoke("use_reaction", { characterId: hero.id, feature: "Shield" });
  assert.equal(out.ok, false);
  assert.deepEqual(world.encounter().reactionsUsed, []);
  assert.equal(world.sheet(hero.id).conditions.includes("shielded"), false);
});

await test("a reaction spell must be held and costs its slot", async () => {
  const { world, sheets: [hero] } = await table([cleric(5)]);
  const before = castingState(world.sheet(hero.id));
  const out = await world.invoke("use_reaction", { characterId: hero.id, feature: "Counterspell" });
  assert.ok(out.ok === false, "a cleric with no Counterspell cast it as a reaction");
  assert.equal(castingState(world.sheet(hero.id)), before);
});

await test("a spell with a casting time of a minute or more is not cast in a fight", async () => {
  const { world, sheets: [hero] } = await table([wizard(5, { spellcasting: { prepared: ["Identify"] } })]);
  const out = await world.invoke("use_spell_slot", { characterId: hero.id, level: 1, spell: "Identify" });
  assert.equal(out.ok, false, "Identify was cast in the middle of a fight");
});

// ---- components ----

await test("Revivify cannot be cast without its diamonds or the gold for them", async () => {
  const world = await openWorld();
  worlds.push(world);
  const poor = world.addHero(cleric(5, { gold: 0, equipment: [] }));
  const out = await world.invoke("use_spell_slot", { characterId: poor.id, level: 3, spell: "Revivify" });
  assert.equal(out.ok, false, "Revivify was cast with no diamond and no gold");
});

// ---- range and line of sight ----

const FIELD = Array.from({ length: 5 }, () => ".".repeat(60));
const WALLED = FIELD.map((row) => `${row.slice(0, 5)}#${row.slice(6)}`);

await test("a spell attack needs a clear line and stops at the edge of its reach", async () => {
  const { world, sheets: [hero], enemies: [enemy] } = await table([wizard(5)]);
  const bolt = () => world.invoke("pc_attack", { characterId: hero.id, enemyId: enemy.id, targetEnemyId: enemy.id, spell: "Fire Bolt", damage: "1d10" });
  await layMap(world, WALLED, { [hero.id]: { x: 1, y: 2 }, [enemy.id]: { x: 10, y: 2 } });
  world.dice(15, 5, 5);
  assert.equal((await bolt()).ok, false, "a wall stands between them");
  world.clearDice();
  await layMap(world, FIELD, { [hero.id]: { x: 1, y: 2 }, [enemy.id]: { x: 58, y: 2 } });
  world.dice(15, 5, 5);
  assert.equal((await bolt()).ok, false, "285 feet is out of reach");
  world.clearDice();
  await layMap(world, FIELD, { [hero.id]: { x: 1, y: 2 }, [enemy.id]: { x: 25, y: 2 } });
  world.dice(15, 5, 5);
  const near = await bolt();
  world.clearDice();
  assert.equal(near.ok, true, near.error);
});

await test("A touch spell attack is a melee spell attack: it reaches only a creature beside the caster", async () => {
  // SRD 5.1: Shocking Grasp and Inflict Wounds have a range of touch and
  // "make a melee spell attack". The owner's decision (second repair): a
  // touch spell is a melee spell attack with touch reach, adjacent on a map.
  // This replaced the pin "every spell attack reaches 120 feet, a touch
  // spell too".
  const { world, sheets: [hero], enemies: [enemy] } = await table([wizard(5)]);
  await layMap(world, FIELD, { [hero.id]: { x: 1, y: 2 }, [enemy.id]: { x: 21, y: 2 } });
  world.dice(15, 5, 5);
  const out = await world.invoke("pc_attack", { characterId: hero.id, enemyId: enemy.id, targetEnemyId: enemy.id, spell: "Shocking Grasp", damage: "1d8" });
  world.clearDice();
  assert.equal(out.ok, false, "a touch spell reached 100 feet");
  await layMap(world, FIELD, { [hero.id]: { x: 1, y: 2 }, [enemy.id]: { x: 2, y: 2 } });
  world.dice(15, 5, 5);
  const beside = await world.invoke("pc_attack", { characterId: hero.id, enemyId: enemy.id, targetEnemyId: enemy.id, spell: "Shocking Grasp", damage: "1d8" });
  world.clearDice();
  assert.equal(beside.ok, true, beside.error);
});

await test("a spell attack reaches its own range and no farther", async () => {
  const { world, sheets: [hero], enemies: [enemy] } = await table([wizard(5)]);
  await layMap(world, FIELD, { [hero.id]: { x: 1, y: 2 }, [enemy.id]: { x: 48, y: 2 } });
  world.dice(15, 15, 5, 5);
  const out = await world.invoke("pc_attack", { characterId: hero.id, enemyId: enemy.id, targetEnemyId: enemy.id, spell: "Fire Bolt", damage: "1d10" });
  world.clearDice();
  assert.equal(out.ok, false, "Fire Bolt was cast at a target 235 feet away");
});

await test("a spell reaches its range with a clear path on a mapped fight", async () => {
  const { world, sheets: [hero, friend], enemies: [enemy] } = await table([wizard(5), { class: "fighter", level: 5 }]);
  await layMap(world, WALLED, { [hero.id]: { x: 1, y: 2 }, [friend.id]: { x: 55, y: 0 }, [enemy.id]: { x: 56, y: 2 } });
  const landed = [];
  for (const [name, args] of [
    ...castsOf(hero, enemy).slice(1, 2),
    castsOf(hero, enemy)[3],
    ["cast_buff", { characterId: hero.id, spell: "Mage Armor", targetCharacterIds: [friend.id] }],
  ]) {
    world.dice(1, 1, 1, 1);
    const out = await world.invoke(name, args);
    world.clearDice();
    if (out.ok) {
      landed.push(name);
    }
  }
  assert.deepEqual(landed, [], `landed through a wall at 270 feet: ${landed.join(", ")}`);
});

await test("a spell that targets only its caster lands on the caster, whoever was named", async () => {
  const world = await openWorld();
  worlds.push(world);
  const hero = world.addHero(wizard(5));
  const friend = world.addHero({ class: "fighter", level: 5 });
  const out = await world.invoke("cast_buff", { characterId: hero.id, spell: "Blur", targetCharacterIds: [friend.id] });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(world.sheet(hero.id).conditions, ["blurred"]);
  assert.deepEqual(world.sheet(friend.id).conditions, []);
});

for (const world of worlds) {
  world.clearDice();
}
worlds[0].close();
finish();
