// A stat block striking another keeps its own riders (issue 503, Phase 6;
// src/lib/dm/enemy-strike.ts), and "an ally" in a trait is an ally of the
// attacker's side (src/lib/dm/side-allies.ts):
//
//   - Pack Tactics: a wolf the party dominates has advantage on a goblin
//     with a party member beside it;
//   - its bite's rider lands on the goblin: a failed DC 11 Strength save
//     knocks it prone;
//   - Martial Advantage: a hobgoblin the party dominates adds 2d6 beside a
//     party member, and not beside the goblin's own kin;
//   - the other way round, a goblin-side hobgoblin's Martial Advantage on a
//     character counts a turncoat beside the target as its ally, and not a
//     creature the party dominates.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, DUMMY, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-combat-sides-strikes");
const world = await openWorld();
const kit = await combatKit(world);
const encounters = await import("../src/lib/db/encounters.ts");
const { moveToSide } = await import("../src/lib/dm/combat-sides.ts");
const { sideOf } = await import("../src/lib/dm/combatant.ts");

const hero = world.addHero({ name: "Mira", class: "fighter", level: 5, maxHp: 60, abilities: { str: 16 }, proficiencies: TRAINED, ac: 12, acOverride: true });
const ally = world.addHero({ name: "Bram", class: "fighter", level: 5, maxHp: 60, abilities: { str: 16 }, proficiencies: TRAINED, ac: 12, acOverride: true });

// The SRD 5.1 blocks' lines, written out so the suite reads the same with
// and without the content pack.
const WOLF = {
  ...DUMMY,
  traits: ["Pack Tactics: The wolf has advantage on an attack roll against a creature if at least one of the wolf's allies is within 5 feet of the creature and the ally isn't incapacitated."],
  attacks: [{ name: "Bite", toHit: 4, damage: "2d4+2", type: "piercing", mode: "melee", onHit: { save: "str", dc: 11, condition: "prone" } }],
};
const HOBGOBLIN = {
  ...DUMMY,
  traits: ["Martial Advantage: Once per turn, the hobgoblin can deal an extra 7 (2d6) damage to a creature it hits with a weapon attack if that creature is within 5 feet of an ally of the hobgoblin that isn't incapacitated."],
  attacks: [{ name: "Longsword", toHit: 3, damage: "1d8+1", type: "slashing", mode: "melee" }],
};
const dominate = (enemy) => encounters.patchEnemyConditions(enemy.id, ["charmed"], { charmed: { spell: "Dominate Person", source: hero.id } });
const facesOf = (sides) => world.diceLog().filter((die) => die.sides === sides).length;

async function stage() {
  await kit.endFight();
  for (const sheet of [hero, ally]) {
    world.patch(sheet.id, { currentHp: 60, conditions: [], conditionMeta: {} });
  }
  await kit.fight(4, { heroFaces: { [hero.id]: 20, [ally.id]: 19 } });
  const [wolf, hob, goblinA, goblinB] = world.enemies();
  for (const enemy of world.enemies()) {
    kit.setEnemy(enemy.id, { maxHp: 200, currentHp: 200 });
  }
  kit.setEnemy(wolf.id, { stats: WOLF });
  kit.setEnemy(hob.id, { stats: HOBGOBLIN });
  kit.place(hero.id, 2, 2);
  kit.place(ally.id, 2, 8);
  kit.place(wolf.id, 10, 2);
  kit.place(hob.id, 10, 8);
  kit.place(goblinA.id, 11, 2);
  kit.place(goblinB.id, 16, 16);
  return { wolf, hob, goblinA, goblinB };
}

await test("A dominated wolf has Pack Tactics' advantage on a goblin with a party member beside it, and its bite knocks the goblin prone on a failed save", async () => {
  const { wolf, goblinA } = await stage();
  dominate(wolf);
  assert.equal(sideOf(world.encounter(), "enemy", wolf.id), "party");
  kit.place(hero.id, 12, 2);
  world.diceLog();
  // Two d20s for the advantage, the bite's 2d4, the goblin's STR save of 1.
  world.dice(15, 14, 2, 2, 1);
  const bite = await world.invoke("enemy_attack", { enemyId: wolf.id, targetCharacterId: goblinA.id });
  world.clearDice();
  assert.equal(bite.ok, true, bite.error);
  assert.equal(bite.result.hit, true, JSON.stringify(bite.result));
  assert.equal(facesOf(20), 3, "two d20s for the attack (advantage) and one for the save");
  assert.ok((bite.result.conditionEffects ?? []).some((note) => /Pack Tactics/.test(note)), JSON.stringify(bite.result.conditionEffects));
  assert.ok(kit.enemy(goblinA.id).conditions.includes("prone"), "the rider knocked it prone");
  assert.equal(kit.enemy(goblinA.id).conditionMeta.prone?.source, wolf.id);
});

await test("A dominated hobgoblin adds Martial Advantage's 2d6 beside a party member, and not beside the goblin's own kin", async () => {
  const { hob, goblinA, goblinB } = await stage();
  dominate(hob);
  kit.place(hob.id, 10, 2);
  // Only the goblin's kin beside it: no ally of the hobgoblin's.
  kit.place(goblinB.id, 12, 2);
  world.diceLog();
  world.dice(18, 4);
  const plain = await world.invoke("enemy_attack", { enemyId: hob.id, targetCharacterId: goblinA.id, attack: "Longsword" });
  world.clearDice();
  assert.equal(plain.ok, true, plain.error);
  assert.equal(facesOf(6), 0, "no Martial Advantage dice");
  // Mira steps up beside the goblin: an ally of the hobgoblin's side.
  kit.freshRound();
  kit.place(goblinB.id, 16, 16);
  kit.place(hero.id, 11, 3);
  world.diceLog();
  world.dice(18, 4, 3, 3);
  const martial = await world.invoke("enemy_attack", { enemyId: hob.id, targetCharacterId: goblinA.id, attack: "Longsword" });
  world.clearDice();
  assert.equal(martial.ok, true, martial.error);
  assert.equal(facesOf(6), 2, "Martial Advantage's 2d6");
  assert.equal(martial.result.swings[0].martialAdvantage, true);
});

await test("A foe hobgoblin's Martial Advantage on a character counts a turncoat beside the target, and not a creature the party dominates", async () => {
  const { wolf, hob } = await stage();
  kit.place(hob.id, 3, 2);
  // A dominated wolf beside Mira is no ally of the hobgoblin's.
  dominate(wolf);
  kit.place(wolf.id, 2, 3);
  world.diceLog();
  world.dice(18, 4);
  const plain = await world.invoke("enemy_attack", { enemyId: hob.id, targetCharacterId: hero.id, attack: "Longsword" });
  world.clearDice();
  assert.equal(plain.ok, true, plain.error);
  assert.equal(facesOf(6), 0, "the dominated wolf is no ally of the hobgoblin's");
  // Bram turns on the party and stands beside Mira: the hobgoblin's ally.
  kit.freshRound();
  kit.place(wolf.id, 16, 10);
  moveToSide(world.campaign(), ally.id, "foe", { quiet: true });
  kit.place(ally.id, 1, 2);
  world.diceLog();
  world.dice(18, 4, 3, 3);
  const martial = await world.invoke("enemy_attack", { enemyId: hob.id, targetCharacterId: hero.id, attack: "Longsword" });
  world.clearDice();
  assert.equal(martial.ok, true, martial.error);
  assert.equal(facesOf(6), 2, "Martial Advantage beside the turncoat");
  moveToSide(world.campaign(), ally.id, "party", { quiet: true });
});

await kit.endFight();
finish();
