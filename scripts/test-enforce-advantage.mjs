// Advantage and disadvantage on attack rolls (src/lib/dm/condition-logic.ts
// attackContext and mergeAdvantage, reached through pc_attack and
// enemy_attack): two d20s, the higher or the lower kept. Any number of
// sources of each is one of each, and one of each is a straight roll.
//
// The sources, from SRD 5.1:
//   - the target prone: advantage from within 5 feet, disadvantage from
//     farther away
//   - the attacker prone, blinded, restrained, poisoned or frightened:
//     disadvantage
//   - the target blinded, restrained, stunned, paralyzed, unconscious or
//     petrified: advantage; paralyzed or unconscious and hit from within 5
//     feet: a critical hit
//   - an unseen attacker: advantage; an unseen target: disadvantage
//   - a ranged attack past normal range, or with a hostile creature within
//     5 feet: disadvantage
//   - a heavy weapon in Small hands: disadvantage
//   - exhaustion level 3: disadvantage
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-advantage");
const world = await openWorld();
const kit = await combatKit(world);

const GEAR = [
  { name: "Longsword", qty: 1 },
  { name: "Longbow", qty: 1 },
  { name: "Greatsword", qty: 1 },
  { name: "Glaive", qty: 1 },
  { name: "Dagger", qty: 1 },
];
const hero = world.addHero({
  class: "fighter", level: 3, abilities: { str: 16, dex: 14 }, proficiencies: TRAINED, equipment: GEAR,
});
const ally = world.addHero({
  class: "fighter", level: 3, abilities: { str: 16 }, proficiencies: TRAINED, equipment: GEAR,
});
const small = world.addHero({
  class: "fighter", level: 3, race: "lightfoot_halfling", abilities: { str: 16 }, proficiencies: TRAINED,
  equipment: GEAR,
});
const heroes = [hero, ally, small];

// `who` at the pointer at 5,5; the first dummy `apart` tiles south of them.
async function stage(who = hero, { apart = 1, count = 1 } = {}) {
  await kit.endFight();
  const heroFaces = Object.fromEntries(heroes.map((entry) => [entry.id, entry.id === who.id ? 19 : 2]));
  await kit.fight(count, { heroFaces });
  const enemies = world.enemies();
  for (const enemy of enemies) {
    kit.setEnemy(enemy.id, { maxHp: 400 });
  }
  kit.place(who.id, 5, 5);
  kit.place(enemies[0].id, 5, 5 + apart);
  return enemies;
}

// The state of one player attack: how many d20s, and which was kept.
async function roll(who, enemy, args, faces = [7, 13, 1, 1, 1]) {
  const swing = await kit.swing(who.id, enemy.id, faces, args);
  assert.equal(swing.ok, true, swing.error);
  const rolled = d20Faces(swing.toHit);
  return { state: swing.toHit.advantage, dice: rolled.length, kept: swing.toHit.breakdown.natural, swing };
}

const expectState = (outcome, state, label) => {
  assert.equal(outcome.state, state, label);
  assert.equal(outcome.dice, state === "none" ? 1 : 2, label);
  if (state !== "none") {
    assert.equal(outcome.kept, state === "advantage" ? 13 : 7, label);
  }
};

await test("a straight roll is one d20", async () => {
  const [enemy] = await stage();
  expectState(await roll(hero, enemy, { weapon: "Longsword" }), "none", "no source");
});

await test("the attacker's own conditions: disadvantage", async () => {
  for (const condition of ["prone", "blinded", "restrained", "poisoned", "frightened"]) {
    const [enemy] = await stage();
    world.patch(hero.id, { conditions: [condition] });
    expectState(await roll(hero, enemy, { weapon: "Longsword" }), "disadvantage", condition);
  }
});

await test("the target's conditions: advantage", async () => {
  for (const condition of ["blinded", "restrained", "stunned", "paralyzed", "unconscious", "petrified"]) {
    const [enemy] = await stage();
    kit.setEnemy(enemy.id, { conditions: [condition] });
    expectState(await roll(hero, enemy, { weapon: "Longsword" }), "advantage", condition);
  }
});

await test("a paralyzed or unconscious target hit from within 5 feet takes a critical hit", async () => {
  for (const condition of ["paralyzed", "unconscious"]) {
    const [enemy] = await stage();
    kit.setEnemy(enemy.id, { conditions: [condition] });
    const close = await kit.swing(hero.id, enemy.id, [7, 13, 2, 3], { weapon: "Longsword" });
    assert.equal(close.result.crit, true, condition);
    assert.equal(close.damage.total, 2 + 3 + 3, condition);
    const [distant] = await stage(hero, { apart: 4 });
    kit.setEnemy(distant.id, { conditions: [condition] });
    // An unconscious creature is prone as well, which is disadvantage from
    // range and cancels the advantage: both dice are made to hit.
    const far = await kit.swing(hero.id, distant.id, [13, 13, 2, 3], { weapon: "Longbow" });
    assert.equal(far.result.hit, true, condition);
    assert.notEqual(far.result.crit, true, condition);
  }
  const [enemy] = await stage();
  kit.setEnemy(enemy.id, { conditions: ["stunned"] });
  const stunned = await kit.swing(hero.id, enemy.id, [7, 13, 2, 3], { weapon: "Longsword" });
  assert.notEqual(stunned.result.crit, true);
});

await test("a prone target: advantage up close, disadvantage from range", async () => {
  let [enemy] = await stage();
  kit.setEnemy(enemy.id, { conditions: ["prone"] });
  expectState(await roll(hero, enemy, { weapon: "Longsword" }), "advantage", "melee");
  [enemy] = await stage(hero, { apart: 4 });
  kit.setEnemy(enemy.id, { conditions: ["prone"] });
  expectState(await roll(hero, enemy, { weapon: "Longbow" }), "disadvantage", "ranged");
});

await test("unseen: an invisible attacker has advantage, an invisible target gives disadvantage", async () => {
  let [enemy] = await stage();
  world.patch(hero.id, { conditions: ["invisible"] });
  expectState(await roll(hero, enemy, { weapon: "Longsword" }), "advantage", "attacker");
  [enemy] = await stage();
  kit.setEnemy(enemy.id, { conditions: ["invisible"] });
  expectState(await roll(hero, enemy, { weapon: "Longsword" }), "disadvantage", "target");
});

await test("a shot past normal range: disadvantage", async () => {
  // A dagger thrown: 20 feet normal, 60 long.
  let [enemy] = await stage(hero, { apart: 4 });
  expectState(await roll(hero, enemy, { weapon: "Dagger" }), "none", "20 ft");
  [enemy] = await stage(hero, { apart: 5 });
  expectState(await roll(hero, enemy, { weapon: "Dagger" }), "disadvantage", "25 ft");
});

await test("a heavy weapon in Small hands: disadvantage", async () => {
  let [enemy] = await stage(small);
  expectState(await roll(small, enemy, { weapon: "Greatsword" }), "disadvantage", "Small, heavy");
  [enemy] = await stage(small);
  expectState(await roll(small, enemy, { weapon: "Longsword" }), "none", "Small, not heavy");
  [enemy] = await stage(hero);
  expectState(await roll(hero, enemy, { weapon: "Greatsword" }), "none", "Medium, heavy");
});

await test("exhaustion level 3: disadvantage on attacks, and not before", async () => {
  let [enemy] = await stage();
  world.patch(hero.id, { exhaustion: 2 });
  expectState(await roll(hero, enemy, { weapon: "Longsword" }), "none", "level 2");
  [enemy] = await stage();
  world.patch(hero.id, { exhaustion: 3 });
  expectState(await roll(hero, enemy, { weapon: "Longsword" }), "disadvantage", "level 3");
});

await test("what the table declares is one more source", async () => {
  for (const declared of ["advantage", "disadvantage"]) {
    const [enemy] = await stage();
    expectState(await roll(hero, enemy, { weapon: "Longsword", advantage: declared }), declared, declared);
  }
});

await test("advantage never stacks: three sources are still two dice", async () => {
  const [enemy] = await stage();
  kit.setEnemy(enemy.id, { conditions: ["prone", "restrained", "blinded"] });
  world.patch(hero.id, { conditions: ["invisible"] });
  expectState(await roll(hero, enemy, { weapon: "Longsword", advantage: "advantage" }), "advantage", "five sources");
});

await test("any advantage and any disadvantage cancel to a straight roll, however many of each", async () => {
  let [enemy] = await stage();
  // Three sources of disadvantage against one of advantage.
  world.patch(hero.id, { conditions: ["prone", "poisoned", "frightened"] });
  kit.setEnemy(enemy.id, { conditions: ["restrained"] });
  expectState(await roll(hero, enemy, { weapon: "Longsword" }), "none", "3 against 1");
  [enemy] = await stage();
  // Three of advantage against one of disadvantage.
  world.patch(hero.id, { conditions: ["poisoned"] });
  kit.setEnemy(enemy.id, { conditions: ["restrained", "blinded", "prone"] });
  expectState(await roll(hero, enemy, { weapon: "Longsword", advantage: "advantage" }), "none", "1 against 3");
});

await test("cancelled advantage is no Sneak Attack trigger and no automatic critical is lost", async () => {
  const [enemy] = await stage();
  world.patch(hero.id, { conditions: ["poisoned"] });
  kit.setEnemy(enemy.id, { conditions: ["paralyzed"] });
  const swing = await kit.swing(hero.id, enemy.id, [13, 2, 3], { weapon: "Longsword" });
  assert.equal(swing.toHit.advantage, "none");
  assert.equal(swing.result.crit, true);
});

async function enemyRoll(enemy, target, faces = [7, 13, 1]) {
  world.clearDice();
  world.diceLog();
  world.dice(...faces);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const attack = kit.lastRolls(3).find((entry) => entry.kind === "attack");
  return { state: attack.advantage, dice: d20Faces(attack).length, kept: attack.breakdown.natural, out };
}

await test("an enemy's attack reads the same conditions", async () => {
  for (const [mine, theirs, state] of [
    [[], [], "none"],
    [["poisoned"], [], "disadvantage"],
    [["prone"], [], "disadvantage"],
    [[], ["restrained"], "advantage"],
    [[], ["prone"], "advantage"],
    [[], ["dodging"], "disadvantage"],
    [["poisoned"], ["restrained"], "none"],
  ]) {
    const [enemy] = await stage();
    world.patch(hero.id, { ac: 12, acOverride: true, conditions: theirs });
    kit.setEnemy(enemy.id, { conditions: mine });
    expectState(await enemyRoll(enemy, hero), state, `${mine.join()} against ${theirs.join()}`);
  }
  world.patch(hero.id, { conditions: [] });
});

await test("flanking does nothing while the variant is off", async () => {
  const [enemy] = await stage();
  assert.equal(world.campaign().gameSettings.variantRules.flanking, false);
  kit.place(ally.id, 5, 7);
  expectState(await roll(hero, enemy, { weapon: "Longsword" }), "none", "ally opposite");
});

await test("With the Flanking variant on, two allies on opposite sides of a creature have advantage on melee attacks against it.", async () => {
  const table = await openWorld({ gameSettings: { variantRules: { flanking: true } } });
  const tableKit = await combatKit(table);
  const one = table.addHero({ class: "fighter", level: 3, abilities: { str: 16 }, proficiencies: TRAINED, equipment: GEAR });
  const two = table.addHero({ class: "fighter", level: 3, abilities: { str: 16 }, proficiencies: TRAINED, equipment: GEAR });
  await tableKit.fight(1, { heroFaces: { [one.id]: 19, [two.id]: 2 } });
  const [enemy] = table.enemies();
  tableKit.place(one.id, 5, 5);
  tableKit.place(enemy.id, 5, 6);
  tableKit.place(two.id, 5, 7);
  const swing = await tableKit.swing(one.id, enemy.id, [7, 13, 1], { weapon: "Longsword" });
  await tableKit.endFight();
  assert.equal(swing.toHit.advantage, "advantage", "a flanked target was attacked on a straight roll");
});

await test("A ranged attack has disadvantage when a hostile creature that can see the attacker and is not incapacitated is within 5 feet.", async () => {
  const [enemy] = await stage(hero, { apart: 1 });
  const outcome = await roll(hero, enemy, { weapon: "Longbow" });
  assert.equal(outcome.state, "disadvantage", "a longbow shot with an enemy adjacent was a straight roll");
});

await test("An attack against a prone creature has advantage only from within 5 feet; from farther it has disadvantage.", async () => {
  const [enemy] = await stage(hero, { apart: 2 });
  kit.setEnemy(enemy.id, { conditions: ["prone"] });
  const outcome = await roll(hero, enemy, { weapon: "Glaive" });
  assert.equal(outcome.state, "disadvantage", `a glaive at 10 feet rolled with ${outcome.state}`);
});

// Not modelled, and so not a gap here: monster traits such as Pack Tactics
// are text on the stat block. enemy_attack takes its advantage from
// conditions, the weather and what the caller declares.

await test("A lasting effect on attack rolls changes the attack roll (set_effect offers Attack rolls and Damage rolls as fields).", async () => {
  const [enemy] = await stage();
  const set = await world.invoke("set_effect", {
    characterId: hero.id,
    name: "Battle Hymn",
    field: "attack",
    modifiers: [{ field: "attack", mode: "advantage" }],
  });
  assert.equal(set.ok, true, set.error);
  try {
    const outcome = await roll(hero, enemy, { weapon: "Longsword" });
    assert.equal(outcome.state, "advantage", "an effect granting advantage on attacks left the roll straight");
  } finally {
    await world.invoke("clear_effect", { characterId: hero.id, name: "Battle Hymn" });
  }
});

await kit.endFight();
world.close();
finish();
