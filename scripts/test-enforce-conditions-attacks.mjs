// What each SRD 5.1 condition does to an attack roll, proved in the dice the
// engine rolls and never in a label. The table below is the rulebook's
// (SRD 5.1, Appendix PH-A, Conditions); the engine is driven through
// pc_attack and enemy_attack with forced dice and the advantage state is read
// from how many d20s were rolled and which face was kept.
//
//   own attack rolls      blinded, poisoned, prone, restrained, frightened:
//                         disadvantage. invisible: advantage. charmed,
//                         deafened, grappled: nothing.
//   attack rolls against  blinded, restrained, stunned, paralyzed,
//                         unconscious, petrified: advantage. invisible:
//                         disadvantage. prone: advantage from within 5 ft,
//                         disadvantage from further. paralyzed and
//                         unconscious: any hit from within 5 ft is a critical.
//                         incapacitated on its own: nothing.
//   Any number of advantages and disadvantages together make a straight roll.
//
// ODM's own rules, pinned here as the code documents them:
//   - A melee attack counts as "within 5 ft" and a ranged one as "further"
//     (src/lib/dm/pc-attack.ts passes adjacent: !ranged). The board's real
//     distance is not consulted for prone or for the automatic critical.
//   - Frightened costs the attack roll wherever the source of the fear is;
//     the engine does not track a source or its line of sight.
//   - Dodging is a condition ("dodging") the Dodge action writes.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite, abilityMod, proficiencyBonus } from "./lib/enforce-harness.mjs";
import { kit as conditionsKit, FIGHTER, stateFrom } from "./lib/enforce-conditions.mjs";

const { test, finish } = suite("test-enforce-conditions-attacks");
const world = await openWorld();
const kit = conditionsKit(world);

const hero = world.addHero(FIGHTER);
await world.beginFight([{ monster: "goblin", count: 2 }], { heroFaces: { [hero.id]: 20 } });
kit.offBoard();
const [goblin, other] = world.enemies();

const SWORD = abilityMod(16) + proficiencyBonus(5);
const BOW = abilityMod(14) + proficiencyBonus(5);

// SRD 5.1: the attacker's own conditions.
const OWN_ATTACKS = {
  blinded: "disadvantage",
  poisoned: "disadvantage",
  prone: "disadvantage",
  restrained: "disadvantage",
  frightened: "disadvantage",
  invisible: "advantage",
  charmed: "none",
  deafened: "none",
  grappled: "none",
};

// SRD 5.1: the target's conditions, from within 5 ft and from further away.
const ATTACKS_AGAINST = {
  blinded: { near: "advantage", far: "advantage", crit: false },
  restrained: { near: "advantage", far: "advantage", crit: false },
  stunned: { near: "advantage", far: "advantage", crit: false },
  paralyzed: { near: "advantage", far: "advantage", crit: true },
  petrified: { near: "advantage", far: "advantage", crit: false },
  prone: { near: "advantage", far: "disadvantage", crit: false },
  invisible: { near: "disadvantage", far: "disadvantage", crit: false },
  grappled: { near: "none", far: "none", crit: false },
  poisoned: { near: "none", far: "none", crit: false },
  frightened: { near: "none", far: "none", crit: false },
  charmed: { near: "none", far: "none", crit: false },
  deafened: { near: "none", far: "none", crit: false },
};

async function heroSwing(weapon, heroConditions, enemyConditions, extra = {}) {
  kit.reset(hero.id, { conditions: heroConditions });
  kit.resetEnemy(goblin.id, enemyConditions);
  const out = await kit.swing([3, 17, 4, 4, 4], hero.id, goblin.id, { weapon, ...extra });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  return {
    ...out,
    state: stateFrom(out.dice, out.result.rolled, weapon === "Longbow" ? BOW : SWORD),
    crit: out.result.crit === true,
    damageDice: out.dice.filter((die) => !die.startsWith("d20:")).length,
  };
}

// The goblin's own to-hit bonus is learned from a straight roll, so the
// table is compared to the dice and not to the stat block.
async function goblinSwing(heroConditions, goblinConditions = [], faces = [3, 17, 4, 4, 4]) {
  kit.reset(hero.id, { conditions: heroConditions });
  kit.resetEnemy(goblin.id, goblinConditions);
  const out = await kit.withDice(faces, "enemy_attack", {
    enemyId: goblin.id,
    targetCharacterId: hero.id,
  });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  return out;
}
const calibration = await goblinSwing([], [], [10, 1]);
const GOBLIN = calibration.result.swings[0].rolled - 10;
const goblinState = (out) => stateFrom(out.dice, out.result.swings[0].rolled, GOBLIN);

await test("the fighter's attack bonus is ability modifier plus proficiency", async () => {
  const sword = await heroSwing("Longsword", [], []);
  assert.deepEqual(sword.dice.slice(0, 1), ["d20:3"]);
  assert.equal(sword.result.rolled, 3 + SWORD);
  assert.equal(sword.state, "none");
  const bow = await heroSwing("Longbow", [], []);
  assert.equal(bow.result.rolled, 3 + BOW);
});

for (const [condition, expected] of Object.entries(OWN_ATTACKS)) {
  await test(`${condition}: a character's own attack rolls at ${expected}`, async () => {
    const out = await heroSwing("Longsword", [condition], []);
    assert.equal(out.state, expected);
    assert.equal(out.result.hit, expected === "advantage");
  });
  await test(`${condition}: an enemy's own attack rolls at ${expected}`, async () => {
    const out = await goblinSwing([], [condition]);
    assert.equal(goblinState(out), expected);
  });
}

for (const [condition, expected] of Object.entries(ATTACKS_AGAINST)) {
  await test(`${condition} enemy: a melee attack against it rolls at ${expected.near}`, async () => {
    const out = await heroSwing("Longsword", [], [condition]);
    assert.equal(out.state, expected.near);
    assert.equal(out.crit, expected.crit && out.result.hit);
    // A critical hit rolls the weapon's die twice.
    assert.equal(out.damageDice, out.result.hit ? (expected.crit ? 2 : 1) : 0);
  });
  await test(`${condition} enemy: a ranged attack against it rolls at ${expected.far}`, async () => {
    const out = await heroSwing("Longbow", [], [condition]);
    assert.equal(out.state, expected.far);
    // ODM's rule: a ranged attack is never the automatic critical.
    assert.equal(out.crit, false);
  });
  await test(`${condition} character: an enemy's melee attack rolls at ${expected.near}`, async () => {
    const out = await goblinSwing([condition]);
    assert.equal(goblinState(out), expected.near);
    const swing = out.result.swings[0];
    assert.equal(swing.crit === true, expected.crit && swing.hit);
  });
}

await test("unconscious: attacks from within 5 ft have advantage and any hit is a critical", async () => {
  const mine = await heroSwing("Longsword", [], ["unconscious"]);
  assert.equal(mine.state, "advantage");
  assert.equal(mine.crit, true);
  assert.equal(mine.damageDice, 2);
  const theirs = await goblinSwing(["unconscious"]);
  assert.equal(goblinState(theirs), "advantage");
  assert.equal(theirs.result.swings[0].crit, true);
});

await test("the automatic critical doubles the dice, not the modifier", async () => {
  const plain = await heroSwing("Longsword", [], []);
  assert.equal(plain.result.hit, false);
  const crit = await heroSwing("Longsword", [], ["paralyzed"]);
  // 1d8+3 becomes 2d8+3 with two fours rolled.
  assert.equal(crit.result.damage, 4 + 4 + abilityMod(16));
});

await test("dodging: attacks against the dodger roll at disadvantage", async () => {
  const out = await goblinSwing(["dodging"]);
  assert.equal(goblinState(out), "disadvantage");
  assert.equal(out.result.hit, false);
});

await test("an incapacitated dodger gets nothing from the Dodge", async () => {
  // SRD, Dodge: "You lose this benefit if you are incapacitated".
  const out = await goblinSwing(["dodging", "stunned"]);
  assert.equal(goblinState(out), "advantage");
});

await test("advantage and disadvantage cancel to one d20, however many of each", async () => {
  const one = await heroSwing("Longsword", ["poisoned"], ["restrained"]);
  assert.equal(one.state, "none");
  assert.equal(kit.d20s(one.dice), 1);
  const many = await heroSwing("Longsword", ["poisoned", "blinded", "prone"], ["stunned"]);
  assert.equal(many.state, "none");
  const claimed = await heroSwing("Longsword", ["poisoned"], [], { advantage: "advantage" });
  assert.equal(claimed.state, "none");
});

await test("two sources of disadvantage roll two d20s, never three", async () => {
  const out = await heroSwing("Longsword", ["poisoned", "restrained"], ["invisible"]);
  assert.equal(kit.d20s(out.dice), 2);
  assert.equal(out.state, "disadvantage");
});

await test("a condition is read whatever its letter case", async () => {
  const out = await heroSwing("Longsword", ["Poisoned"], []);
  assert.equal(out.state, "disadvantage");
});

await test("a condition on one enemy does not leak to the enemy beside it", async () => {
  kit.resetEnemy(other.id, []);
  kit.resetEnemy(goblin.id, ["paralyzed"]);
  kit.reset(hero.id);
  const out = await kit.swing([3, 17, 4], hero.id, other.id, { weapon: "Longsword" });
  assert.equal(kit.d20s(out.dice), 1);
});

await test("Incapacitated on its own only takes away actions and reactions; attack rolls against the creature are straight (SRD 5.1, Conditions).", async () => {
  const mine = await heroSwing("Longsword", [], ["incapacitated"]);
  assert.equal(mine.state, "none", `attack on an incapacitated enemy rolled at ${mine.state}`);
  const theirs = await goblinSwing(["incapacitated"]);
  assert.equal(goblinState(theirs), "none");
});

await test("An unconscious creature falls prone, so a ranged attack from beyond 5 ft has advantage (unconscious) and disadvantage (prone) and is rolled straight (SRD 5.1, Conditions).", async () => {
  const out = await heroSwing("Longbow", [], ["unconscious"]);
  assert.equal(out.state, "none", `ranged attack on an unconscious enemy rolled at ${out.state}`);
});

await test("A charmed creature cannot attack the charmer or target the charmer with harmful abilities or magical effects (SRD 5.1, Conditions).", async () => {
  kit.reset(hero.id);
  kit.resetEnemy(goblin.id, []);
  const set = await world.invoke("set_condition", {
    characterId: hero.id,
    condition: "charmed",
    sourceEnemyId: goblin.id,
    reason: `charmed by ${goblin.displayName}`,
  });
  assert.equal(set.ok, true, set.error);
  const out = await kit.swing([17, 4], hero.id, goblin.id, { weapon: "Longsword" });
  assert.equal(out.outcome.ok, false, "a charmed character attacked the one who charmed them");
});

world.close();
finish();
