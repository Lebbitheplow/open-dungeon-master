// Battle Master maneuvers riding a player's attack (src/lib/dm/pc-attack.ts,
// the `maneuver` argument), every die forced: a Superiority Die is spent from
// the sheet's counter, rolled, and added to the damage (to the attack roll
// for Precision Attack), and the maneuver's rider is a saving throw the
// target makes against the fighter's maneuver DC.
//
// The rules, from SRD 5.1 (Fighter, Battle Master):
//   - Superiority Dice are d8s, d10s from 10th level and d12s from 18th. A
//     die is expended when it is used.
//   - Maneuver save DC = 8 + proficiency bonus + Strength or Dexterity
//     modifier, the fighter's choice.
//   - Trip Attack, Menacing Attack, Disarming Attack and Goading Attack are
//     declared when the attack HITS: the die is added to the damage and the
//     target saves (Strength for Trip and Disarming, Wisdom for Menacing and
//     Goading). Trip Attack works on a Large or smaller target.
//   - Precision Attack adds the die to the attack roll.
//
// ODM's own rules, pinned here as it documents them:
//   - The maneuver is named with the attack, before the roll, because the
//     engine resolves the whole swing in one call.
//   - A maneuver's condition other than prone lasts one round.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { combatKit, DUMMY, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-maneuvers");
const world = await openWorld();
const kit = await combatKit(world);

const POOL = "sub_superiority_dice";
const PICKS = ["Trip Attack", "Menacing Attack", "Precision Attack"];
const master = world.addHero({
  class: "fighter", subclass: "battle_master", level: 5, abilities: { str: 16, dex: 12 },
  proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
  spellcasting: { ability: "int", slots: {}, prepared: [], known: [], cantrips: ["Fire Bolt"] },
});
const made = world.sheet(master.id);
const FEATURES = [
  ...made.features,
  { name: "Combat Superiority", source: "subclass" },
  ...PICKS.map((name) => ({ name: `Maneuver: ${name}`, source: "choice" })),
];
const DC = 8 + proficiencyBonus(5) + abilityMod(16);

const dice = () => world.sheet(master.id).resources[POOL];

// The Battle Master at the pointer with a full pool of four dice, toe to toe
// with a dummy that will not die.
async function stage(level = 5) {
  await kit.endFight();
  // The level first: a change of level has the sheet's class features
  // granted again, and what the player chose is put back after it.
  world.patch(master.id, { level });
  world.patch(master.id, {
    features: FEATURES,
    resources: { ...made.resources, [POOL]: { max: 4, used: 0 } },
    conditions: [],
  });
  await kit.fight(1, { heroFaces: { [master.id]: 19 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400 });
  kit.place(master.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  return enemy;
}

const swing = (enemy, faces, args) =>
  kit.swing(master.id, enemy.id, faces, { weapon: "Longsword", ...args });
const sidesOf = (roll) => roll.breakdown.terms.filter((term) => term.sides).map((term) => term.sides);

await test("a maneuver spends one Superiority Die and adds it to the damage", async () => {
  const enemy = await stage();
  // d20, the longsword's d8, the Superiority Die, the target's save.
  const out = await swing(enemy, [15, 4, 5, 20], { maneuver: "Trip Attack" });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.unused, 0);
  assert.deepEqual(dice(), { max: 4, used: 1 });
  assert.deepEqual(sidesOf(out.damage), [8, 8]);
  assert.equal(out.damage.total, 4 + 5 + abilityMod(16));
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 12);
  // The attack roll is the plain one.
  assert.equal(out.toHit.total, 15 + abilityMod(16) + proficiencyBonus(5));
});

await test("the Superiority Die is a d8, a d10 from 10th level and a d12 from 18th", async () => {
  for (const [level, sides] of [[3, 8], [9, 8], [10, 10], [17, 10], [18, 12], [20, 12]]) {
    const enemy = await stage(level);
    const out = await swing(enemy, [15, 4, 1, 20], { maneuver: "Trip Attack" });
    assert.equal(out.ok, true, out.error);
    assert.deepEqual(sidesOf(out.damage), [8, sides], `level ${level}`);
  }
});

await test("Trip Attack: a Strength save against 8 + proficiency + Strength, prone on a failure", async () => {
  // The dummy saves at +1: a 12 comes to 13, one short of DC 14.
  let enemy = await stage();
  const failed = await swing(enemy, [15, 4, 5, DC - DUMMY.saveMods.str - 1], { maneuver: "Trip Attack" });
  assert.equal(failed.ok, true, failed.error);
  assert.deepEqual(kit.enemy(enemy.id).conditions, ["prone"]);
  const save = kit.lastRolls(1)[0];
  assert.equal(save.kind, "saving_throw");
  assert.equal(save.dc, DC);
  assert.equal(save.total, DC - 1);

  enemy = await stage();
  const held = await swing(enemy, [15, 4, 5, DC - DUMMY.saveMods.str], { maneuver: "Trip Attack" });
  assert.equal(held.ok, true, held.error);
  assert.equal(kit.lastRolls(1)[0].total, DC);
  assert.deepEqual(kit.enemy(enemy.id).conditions, []);
  // The die is spent and its damage dealt whether the save is made or not.
  assert.deepEqual(dice(), { max: 4, used: 1 });
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 12);
});

await test("Menacing Attack: a Wisdom save, frightened for a round on a failure", async () => {
  const enemy = await stage();
  const out = await swing(enemy, [15, 4, 5, 2], { maneuver: "Menacing Attack" });
  assert.equal(out.ok, true, out.error);
  const save = kit.lastRolls(1)[0];
  assert.equal(save.total, 2 + DUMMY.saveMods.wis);
  assert.equal(save.dc, DC);
  assert.deepEqual(kit.enemy(enemy.id).conditions, ["frightened"]);
  assert.equal(kit.enemy(enemy.id).conditionMeta.frightened.rounds, 1);
});

await test("Precision Attack: the die goes on the attack roll and not on the damage", async () => {
  const enemy = await stage();
  const total = 10 + abilityMod(16) + proficiencyBonus(5);
  kit.setEnemy(enemy.id, { ac: total + 6 });
  // d20, the Superiority Die, then the damage.
  const out = await swing(enemy, [10, 6, 4], { maneuver: "Precision Attack" });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.unused, 0);
  assert.equal(out.toHit.total, total + 6);
  assert.equal(out.result.hit, true);
  assert.deepEqual(sidesOf(out.damage), [8]);
  assert.equal(out.damage.total, 4 + abilityMod(16));
  assert.deepEqual(dice(), { max: 4, used: 1 });
  // No rider: nothing is saved against and nothing lands.
  assert.deepEqual(kit.enemy(enemy.id).conditions, []);
});

await test("a critical hit rolls the Superiority Die twice with the weapon's", async () => {
  const enemy = await stage();
  const out = await swing(enemy, [20, 1, 2, 3, 4, 20], { maneuver: "Trip Attack" });
  assert.equal(out.result.crit, true);
  assert.equal(out.unused, 0);
  assert.equal(out.damage.total, 1 + 2 + 3 + 4 + abilityMod(16));
  // One die spent, however many times it was rolled.
  assert.deepEqual(dice(), { max: 4, used: 1 });
});

await test("a maneuver the character never learned is refused and costs nothing", async () => {
  const enemy = await stage();
  for (const maneuver of ["Riposte", "Parry", "Commander's Strike"]) {
    const out = await swing(enemy, [15, 4, 5, 2], { maneuver });
    assert.equal(out.ok, false, maneuver);
    assert.equal(out.unused, 4, maneuver);
  }
  assert.deepEqual(dice(), { max: 4, used: 0 });
  assert.equal(kit.enemy(enemy.id).currentHp, 400);
  assert.equal(world.encounter().turnBudget, null);
});

await test("a fighter with no maneuvers has none to use", async () => {
  const enemy = await stage();
  // Without the feature the sheet drops the counter with it.
  world.patch(master.id, { features: made.features });
  assert.equal(dice(), undefined);
  const out = await swing(enemy, [15, 4, 5, 2], { maneuver: "Trip Attack" });
  assert.equal(out.ok, false);
  assert.equal(out.unused, 4);
  assert.equal(kit.enemy(enemy.id).currentHp, 400);
});

await test("the pool is what it is: with no dice left the attack is refused", async () => {
  const enemy = await stage();
  world.patch(master.id, { resources: { ...made.resources, [POOL]: { max: 4, used: 4 } } });
  const out = await swing(enemy, [15, 4, 5, 2], { maneuver: "Trip Attack" });
  assert.equal(out.ok, false);
  assert.equal(out.unused, 4);
  assert.deepEqual(dice(), { max: 4, used: 4 });
  assert.equal(kit.enemy(enemy.id).currentHp, 400);
  // The same swing without the maneuver is an ordinary attack.
  const plain = await swing(enemy, [15, 4]);
  assert.equal(plain.ok, true, plain.error);
  assert.deepEqual(dice(), { max: 4, used: 4 });
});

await test("the counter never leaves 0 to its maximum", async () => {
  const enemy = await stage();
  world.patch(master.id, { conditions: ["hasted"] });
  // Three attacks a turn (Extra Attack and Haste) for two rounds: six asked
  // for, four paid for.
  let landed = 0;
  for (let round = 0; round < 2; round += 1) {
    for (let index = 0; index < 3; index += 1) {
      const out = await swing(enemy, [15, 4, 5, 20], { maneuver: "Trip Attack" });
      landed += out.ok ? 1 : 0;
      const pool = dice();
      assert.ok(pool.used >= 0 && pool.used <= pool.max, JSON.stringify(pool));
    }
    assert.equal(kit.endTurn(master.userId), true);
  }
  assert.equal(landed, 4);
  assert.deepEqual(dice(), { max: 4, used: 4 });
});

await test("a maneuver rides a weapon attack and never a spell", async () => {
  const enemy = await stage();
  const out = await kit.swing(master.id, enemy.id, [15, 4, 5, 2], {
    spell: "Fire Bolt", damage: "1d10", maneuver: "Trip Attack",
  });
  assert.equal(out.ok, false);
  assert.equal(out.unused, 4);
  assert.deepEqual(dice(), { max: 4, used: 0 });
});

await test("an attack refused for reach costs no die", async () => {
  const enemy = await stage();
  kit.place(enemy.id, 5, 9);
  const out = await swing(enemy, [15, 4, 5, 2], { maneuver: "Trip Attack" });
  assert.equal(out.ok, false);
  assert.deepEqual(dice(), { max: 4, used: 0 });
});

await test("Trip, Menacing, Disarming and Goading Attack are used when the attack hits; a miss expends no Superiority Die.", async () => {
  const enemy = await stage();
  const out = await swing(enemy, [2, 4, 5, 2], { maneuver: "Trip Attack" });
  assert.equal(out.result.hit, false);
  assert.deepEqual(dice(), { max: 4, used: 0 }, `the miss left ${4 - dice().used} of 4 dice`);
});

await test("A refused attack never happened: it expends no Superiority Die (src/lib/dm/engine-boundary.ts: a tool that errors means the attempt failed).", async () => {
  const enemy = await stage();
  assert.equal((await swing(enemy, [15, 4])).ok, true);
  assert.equal((await swing(enemy, [15, 4])).ok, true);
  const third = await swing(enemy, [15, 4, 5, 2], { maneuver: "Trip Attack" });
  assert.equal(third.ok, false);
  assert.deepEqual(dice(), { max: 4, used: 0 }, `the refused attack left ${4 - dice().used} of 4 dice`);
});

await test("Trip Attack knocks prone a target that is Large or smaller.", async () => {
  const enemy = await stage();
  kit.setEnemy(enemy.id, { stats: { size: "Gargantuan" } });
  const out = await swing(enemy, [15, 4, 5, 2], { maneuver: "Trip Attack" });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(kit.enemy(enemy.id).conditions, [], "a Gargantuan creature was tripped");
});

await test("A creature immune to a condition cannot be given it.", async () => {
  const enemy = await stage();
  kit.setEnemy(enemy.id, { stats: { conditionImmune: "frightened, prone" } });
  const out = await swing(enemy, [15, 4, 5, 2], { maneuver: "Menacing Attack" });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(kit.enemy(enemy.id).conditions, [], "a creature immune to frightened was frightened");
});

await kit.endFight();
world.close();
finish();
