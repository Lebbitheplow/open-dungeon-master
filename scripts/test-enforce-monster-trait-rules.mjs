// The monster traits the engine now resolves, and the ones it names as the
// DM's (docs/dnd-rules-audit-2026-10-09-extent.md, F18, F21, F22;
// src/lib/dm/monster-traits.ts):
//
//   - Fire Absorption (Iron Golem): fire damage heals it instead.
//   - Immutable Form (the golems): Polymorph has no hold on it.
//   - Limited Magic Immunity (Rakshasa): spells of 6th level or lower do not
//     affect it; an area washes over it.
//   - Martial Advantage (Hobgoblin): 2d6 more on a weapon hit against a
//     creature within 5 feet of one of its allies, once a turn.
//   - Life Drain (Wight): a failed CON save lowers the hit point maximum by
//     the damage taken until a long rest.
//   - Animate Dead: when its 24 hours of control run out the undead stays and
//     turns on the party; a casting can reassert control instead.
//
// Dice forced; every check reads a stored row.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, DUMMY, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-monster-trait-rules");
const world = await openWorld();
const kit = await combatKit(world);
const { manualTraits } = await import("../src/lib/dm/monster-traits.ts");

const tank = world.addHero({ class: "fighter", level: 5, maxHp: 60, abilities: { str: 16, con: 10 }, proficiencies: TRAINED });
const mage = world.addHero({
  class: "wizard", level: 13, maxHp: 60, abilities: { int: 18 }, proficiencies: TRAINED,
  spellcasting: {
    ability: "int",
    slots: { 2: { max: 3, used: 0 }, 3: { max: 3, used: 0 }, 4: { max: 3, used: 0 }, 7: { max: 1, used: 0 } },
    prepared: ["Hold Person", "Fireball", "Polymorph", "Animate Dead"], known: [], cantrips: [],
  },
});

async function stage(traits = [], count = 1, extra = {}) {
  await kit.endFight();
  for (const hero of [tank, mage]) {
    world.patch(hero.id, { currentHp: 60, conditions: [], conditionMeta: {}, deathSaves: null });
  }
  await kit.fight(count, { heroFaces: { [tank.id]: 19, [mage.id]: 18 } });
  const enemies = world.enemies();
  for (const enemy of enemies) {
    kit.setEnemy(enemy.id, { maxHp: 100, stats: { ...DUMMY, traits, ...extra } });
  }
  kit.place(tank.id, 5, 5);
  kit.place(mage.id, 5, 7);
  enemies.forEach((enemy, index) => kit.place(enemy.id, 6 + index, 5));
  return world.enemies();
}

await test("Fire Absorption: an iron golem's fire damage heals it instead.", async () => {
  const [golem] = await stage(["Fire Absorption: Whenever the golem is subjected to fire damage, it takes no damage and instead regains a number of hit points equal to the fire damage dealt."]);
  kit.setEnemy(golem.id, { currentHp: 50 });
  const out = await world.invoke("damage_enemy", { enemyId: golem.id, amount: 12, type: "fire", source: "hazard" });
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.enemy(golem.id).currentHp, 62);
});

await test("Immutable Form: Polymorph is refused before the slot.", async () => {
  const [golem] = await stage(["Immutable Form: The golem is immune to any spell or effect that would alter its form."]);
  kit.giveTurn(mage.id);
  const out = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: golem.id, spell: "Polymorph", saveAbility: "wis", level: 4, variant: "wolf" });
  assert.equal(out.ok, false);
  assert.match(String(out.error), /Immutable Form/);
  assert.equal(world.sheet(mage.id).spellcasting.slots["4"].used, 0);
});

await test("Limited Magic Immunity: Hold Person is refused; from a 7th-level slot it reaches.", async () => {
  const [rakshasa] = await stage(["Limited Magic Immunity: The rakshasa can't be affected or detected by spells of 6th level or lower unless it wishes to be."]);
  kit.giveTurn(mage.id);
  const low = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: rakshasa.id, spell: "Hold Person", saveAbility: "wis", level: 2 });
  assert.equal(low.ok, false);
  assert.match(String(low.error), /Limited Magic Immunity/);
  assert.equal(world.sheet(mage.id).spellcasting.slots["2"].used, 0);
  world.dice(1);
  const high = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: rakshasa.id, spell: "Hold Person", saveAbility: "wis", level: 7 });
  world.clearDice();
  assert.equal(high.ok, true, high.error);
  assert.ok(kit.enemy(rakshasa.id).conditions.includes("paralyzed"));
});

await test("Martial Advantage: 2d6 more when an ally stands beside the target, none alone.", async () => {
  const MARTIAL = ["Martial Advantage: Once per turn, the hobgoblin can deal an extra 7 (2d6) damage to a creature it hits with a weapon attack if that creature is within 5 feet of an ally of the hobgoblin that isn't incapacitated."];
  const [hob, ally] = await stage(MARTIAL, 2);
  kit.place(ally.id, 4, 5);
  kit.freshRound();
  world.dice(18, 3, 4, 4);
  const out = await world.invoke("enemy_attack", { enemyId: hob.id, targetCharacterId: tank.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  // Club 1d6+2 (3+2) and Martial Advantage 2d6 (4+4).
  assert.equal(world.sheet(tank.id).currentHp, 60 - 13);
  kit.place(ally.id, 15, 15);
  world.patch(tank.id, { currentHp: 60 });
  kit.freshRound();
  world.dice(18, 3, 4, 4);
  await world.invoke("enemy_attack", { enemyId: hob.id, targetCharacterId: tank.id });
  world.clearDice();
  assert.equal(world.sheet(tank.id).currentHp, 60 - 5, "no ally beside the target, no extra dice");
});

await test("Life Drain: a failed CON save lowers the maximum by the damage until a long rest.", async () => {
  const drain = { name: "Life Drain", toHit: 4, damage: "1d6+2", type: "necrotic", onHit: { save: "con", dc: 13, drainMaxHp: "all" } };
  const [wight] = await stage([], 1, { attacks: [drain] });
  const before = world.sheet(tank.id).maxHp;
  kit.freshRound();
  world.dice(18, 4, 2);
  const out = await world.invoke("enemy_attack", { enemyId: wight.id, targetCharacterId: tank.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(tank.id).maxHp, before - 6, "the 6 necrotic came off the maximum");
  assert.ok(world.sheet(tank.id).conditions.some((name) => /^max hp reduced \(-6\)$/.test(name)));
  await kit.endFight();
  const rest = await world.invoke("take_rest", { characterIds: [tank.id], kind: "long" });
  assert.equal(rest.ok, true, rest.error);
  assert.equal(world.sheet(tank.id).maxHp, before, "a long rest restored the maximum");
});

test("The traits the engine does not resolve are named as the DM's", () => {
  const manual = manualTraits({ traits: ["Pack Tactics: advantage...", "Rampage: When the gnoll reduces a creature to 0 hit points...", "Martial Advantage: Once per turn..."] });
  assert.deepEqual(manual, ["Rampage"]);
});

await test("Animate Dead: when control runs out the undead turns hostile; a casting reasserts it instead.", async () => {
  // A minute's casting: out of a fight.
  await kit.endFight();
  const made = await world.invoke("cast_buff", { characterId: mage.id, spell: "Animate Dead", level: 3, variant: "skeleton" });
  assert.equal(made.ok, true, made.error);
  const skeleton = world.sheets().find((sheet) => sheet.summon?.spell === "Animate Dead");
  assert.ok(skeleton, "no skeleton");
  const renewed = await world.invoke("cast_buff", { characterId: mage.id, spell: "Animate Dead", level: 3, variant: "reassert" });
  assert.equal(renewed.ok, true, renewed.error);
  assert.deepEqual(renewed.result.reasserted, [skeleton.name]);
  // The hold runs out in a fight: the skeleton stands and turns on the party.
  await kit.fight(1);
  const { sweepSummons } = await import("../src/lib/dm/summon-store.ts");
  world.patch(skeleton.id, { conditions: [], conditionMeta: {} });
  const lines = sweepSummons(world.campaign());
  assert.match(lines.join(" "), /turns on the party/);
  assert.ok(world.enemies().some((enemy) => /skeleton/i.test(enemy.displayName)), "the skeleton is not a foe");
});

world.close();
finish();
