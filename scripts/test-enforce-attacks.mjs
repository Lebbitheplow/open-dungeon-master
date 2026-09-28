// How a player's attack resolves (src/lib/dm/pc-attack.ts), every die
// forced: the roll to hit is a d20 plus the ability modifier, plus the
// proficiency bonus when the character is trained in the weapon, plus what a
// magic weapon or a fighting style adds. It hits when the total meets the
// Armor Class. A natural 20 always hits and is a critical hit, a natural 1
// always misses. A critical hit rolls the damage DICE twice and adds the
// modifier once.
//
// ODM's own rules, pinned here as it documents them:
//   - Powerful Critical and Critical Damage Modifiers are table variants
//     (src/lib/schemas/game-settings.ts variantRules): the extra critical dice
//     are dealt at their maximum, and the flat modifier doubles with the
//     dice. Both do nothing until the table switches them on.
//   - A magic weapon's bonus is read from its name ("+1 Longsword").
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-attacks");

// One hero at the pointer, toe to toe with one dummy, in a world with the
// given variant rules.
async function duel(variantRules, heroOverrides = {}) {
  const world = await openWorld({ gameSettings: { variantRules } });
  const kit = await combatKit(world);
  const hero = world.addHero({
    class: "fighter", level: 5, abilities: { str: 16, dex: 14 }, proficiencies: TRAINED,
    equipment: [{ name: "Longsword", qty: 1 }],
    ...heroOverrides,
  });
  async function stage() {
    await kit.endFight();
    await kit.fight(1, { heroFaces: { [hero.id]: 19 } });
    const [enemy] = world.enemies();
    kit.setEnemy(enemy.id, { maxHp: 400 });
    kit.place(hero.id, 5, 5);
    kit.place(enemy.id, 5, 6);
    return enemy;
  }
  return { world, kit, hero, stage };
}

const plain = await duel({});
const PB = proficiencyBonus(5);

// SRD 5.1 weapons, written here rather than read from the engine's table:
// the ability that drives each, and its damage die.
const ARMORY = [
  { weapon: "Longsword", ability: "str", die: 8 },
  { weapon: "Greataxe", ability: "str", die: 12 },
  { weapon: "Dagger", ability: "best", die: 4 },
  { weapon: "Rapier", ability: "best", die: 8 },
  { weapon: "Longbow", ability: "dex", die: 8 },
  { weapon: "Light Crossbow", ability: "dex", die: 8 },
  { weapon: "Handaxe", ability: "str", die: 6 },
];

for (const scores of [{ str: 16, dex: 12 }, { str: 8, dex: 18 }, { str: 10, dex: 10 }]) {
  await test(`to hit and damage from the sheet, STR ${scores.str} DEX ${scores.dex}`, async () => {
    const { world, kit, hero, stage } = plain;
    world.patch(hero.id, {
      abilities: { ...hero.abilities, ...scores },
      equipment: ARMORY.map((entry) => ({ name: entry.weapon, qty: 1 })),
    });
    for (const entry of ARMORY) {
      const enemy = await stage();
      kit.place(enemy.id, 5, entry.ability === "dex" ? 9 : 6);
      const str = abilityMod(scores.str);
      const dex = abilityMod(scores.dex);
      const mod = entry.ability === "str" ? str : entry.ability === "dex" ? dex : Math.max(str, dex);
      const swing = await kit.swing(hero.id, enemy.id, [12, 3], { weapon: entry.weapon });
      assert.equal(swing.ok, true, swing.error);
      assert.equal(swing.toHit.total, 12 + mod + PB, `${entry.weapon} to hit`);
      assert.equal(swing.result.hit, true, entry.weapon);
      assert.equal(swing.damage.total, 3 + mod, `${entry.weapon} damage`);
      assert.equal(swing.damage.breakdown.terms[0].sides, entry.die, `${entry.weapon} die`);
      assert.equal(kit.enemy(enemy.id).currentHp, 400 - Math.max(0, 3 + mod), `${entry.weapon} applied`);
    }
    world.patch(hero.id, { abilities: hero.abilities, equipment: hero.equipment });
  });
}

await test("no proficiency bonus with a weapon the character is not trained in", async () => {
  const { world, kit, hero, stage } = plain;
  const enemy = await stage();
  world.patch(hero.id, {
    proficiencies: { ...TRAINED, weapons: ["simple"] },
    equipment: [{ name: "Longsword", qty: 1 }, { name: "Mace", qty: 1 }],
  });
  const martial = await kit.swing(hero.id, enemy.id, [10, 3], { weapon: "Longsword" });
  assert.equal(martial.toHit.total, 10 + abilityMod(16));
  const simple = await kit.swing(hero.id, enemy.id, [10, 3], { weapon: "Mace" });
  assert.equal(simple.toHit.total, 10 + abilityMod(16) + PB);
  world.patch(hero.id, { proficiencies: TRAINED, equipment: hero.equipment });
});

await test("a +1, +2 or +3 weapon adds its bonus to the attack roll and the damage", async () => {
  const { world, kit, hero, stage } = plain;
  for (const bonus of [1, 2, 3]) {
    const enemy = await stage();
    world.patch(hero.id, { equipment: [{ name: `+${bonus} Longsword`, qty: 1 }] });
    const swing = await kit.swing(hero.id, enemy.id, [10, 4]);
    assert.equal(swing.toHit.total, 10 + abilityMod(16) + PB + bonus);
    assert.equal(swing.damage.total, 4 + abilityMod(16) + bonus);
  }
  world.patch(hero.id, { equipment: hero.equipment });
});

await test("the attack hits when the total meets the Armor Class, and misses one short", async () => {
  const { kit, hero, stage } = plain;
  const total = 9 + abilityMod(16) + PB;
  let enemy = await stage();
  kit.setEnemy(enemy.id, { ac: total });
  const met = await kit.swing(hero.id, enemy.id, [9, 5]);
  assert.equal(met.result.vsAc, total);
  assert.equal(met.result.hit, true);
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 5 - abilityMod(16));

  enemy = await stage();
  kit.setEnemy(enemy.id, { ac: total + 1 });
  const short = await kit.swing(hero.id, enemy.id, [9, 5]);
  assert.equal(short.result.hit, false);
  assert.equal(short.unused, 1);
  assert.equal(short.damage, null);
  assert.equal(kit.enemy(enemy.id).currentHp, 400);
});

await test("a natural 20 hits an Armor Class no total could reach, as a critical hit", async () => {
  const { kit, hero, stage } = plain;
  const enemy = await stage();
  kit.setEnemy(enemy.id, { ac: 40 });
  const swing = await kit.swing(hero.id, enemy.id, [20, 5, 6]);
  assert.equal(swing.result.hit, true);
  assert.equal(swing.result.crit, true);
  assert.equal(swing.unused, 0);
  // 1d8 rolled twice, the +3 once.
  assert.equal(swing.damage.total, 5 + 6 + abilityMod(16));
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 14);
});

await test("a natural 1 misses whatever the bonus", async () => {
  const { world, kit, hero, stage } = plain;
  const enemy = await stage();
  kit.setEnemy(enemy.id, { ac: 1 });
  world.patch(hero.id, { abilities: { ...hero.abilities, str: 30 }, equipment: [{ name: "+3 Longsword", qty: 1 }] });
  const swing = await kit.swing(hero.id, enemy.id, [1, 5]);
  assert.ok(swing.toHit.total > 1);
  assert.equal(swing.result.hit, false);
  assert.equal(swing.damage, null);
  assert.equal(kit.enemy(enemy.id).currentHp, 400);
  world.patch(hero.id, { abilities: hero.abilities, equipment: hero.equipment });
});

await test("a 19 is not a critical hit without a feature that says so", async () => {
  const { kit, hero, stage } = plain;
  const enemy = await stage();
  const swing = await kit.swing(hero.id, enemy.id, [19, 5, 6]);
  assert.equal(swing.result.hit, true);
  assert.notEqual(swing.result.crit, true);
  assert.equal(swing.unused, 1);
  assert.equal(swing.damage.total, 5 + abilityMod(16));
});

await test("versatile: the bigger die in two hands", async () => {
  const { kit, hero, stage } = plain;
  const enemy = await stage();
  const one = await kit.swing(hero.id, enemy.id, [10, 4]);
  assert.equal(one.damage.breakdown.terms[0].sides, 8);
  const two = await kit.swing(hero.id, enemy.id, [10, 4], { twoHanded: true });
  assert.equal(two.damage.breakdown.terms[0].sides, 10);
});

await test("the variant critical rules are inert while switched off", async () => {
  const settings = plain.world.campaign().gameSettings.variantRules;
  assert.equal(settings.powerfulCritical, false);
  assert.equal(settings.criticalDamageMods, false);
  assert.equal(settings.criticalFumbles, false);
  assert.equal(settings.flanking, false);
  const enemy = await plain.stage();
  const swing = await plain.kit.swing(plain.hero.id, enemy.id, [20, 2, 7]);
  assert.equal(swing.damage.expression.replace(/\s+/g, ""), "1d8+1d8+3");
  assert.equal(swing.damage.total, 2 + 7 + 3);
});

await test("Powerful Critical, switched on: the extra dice are dealt at their maximum", async () => {
  const table = await duel({ powerfulCritical: true });
  const enemy = await table.stage();
  const swing = await table.kit.swing(table.hero.id, enemy.id, [20, 2]);
  assert.equal(swing.unused, 0);
  assert.equal(swing.damage.total, 2 + 8 + 3);
  // An ordinary hit is untouched.
  const hit = await table.kit.swing(table.hero.id, enemy.id, [15, 2]);
  assert.equal(hit.damage.total, 2 + 3);
  await table.kit.endFight();
});

await test("Critical Damage Modifiers, switched on: the modifier doubles with the dice", async () => {
  const table = await duel({ criticalDamageMods: true });
  const enemy = await table.stage();
  const swing = await table.kit.swing(table.hero.id, enemy.id, [20, 2, 7]);
  assert.equal(swing.damage.total, 2 + 7 + 3 + 3);
  const hit = await table.kit.swing(table.hero.id, enemy.id, [15, 2]);
  assert.equal(hit.damage.total, 2 + 3);
  await table.kit.endFight();
});

await test("an enemy's critical hit follows the same variants", async () => {
  const off = await plain.stage();
  plain.world.patch(plain.hero.id, { currentHp: 30, ac: 12, acOverride: true });
  plain.world.dice(20, 2, 5);
  const normal = await plain.world.invoke("enemy_attack", { enemyId: off.id, targetCharacterId: plain.hero.id });
  assert.equal(plain.world.clearDice(), 0);
  // 1d6+2, the die twice.
  assert.equal(normal.result.swings[0].damage, 2 + 5 + 2);

  const table = await duel({ powerfulCritical: true, criticalDamageMods: true });
  const enemy = await table.stage();
  table.world.dice(20, 2);
  const out = await table.world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: table.hero.id });
  assert.equal(table.world.clearDice(), 0);
  assert.equal(out.result.swings[0].crit, true);
  assert.equal(out.result.swings[0].damage, 2 + 6 + 2 + 2);
  await table.kit.endFight();
});

await test("a character at 0 hit points, or incapacitated, cannot attack", async () => {
  const { world, kit, hero, stage } = plain;
  const enemy = await stage();
  world.patch(hero.id, { currentHp: 0 });
  assert.equal((await kit.swing(hero.id, enemy.id, [15, 4])).ok, false);
  world.patch(hero.id, { currentHp: 30 });
  for (const condition of ["incapacitated", "paralyzed", "stunned", "unconscious", "petrified"]) {
    world.patch(hero.id, { conditions: [condition] });
    const swing = await kit.swing(hero.id, enemy.id, [15, 4]);
    assert.equal(swing.ok, false, condition);
    assert.equal(swing.unused, 2, condition);
  }
  world.patch(hero.id, { conditions: [] });
  assert.equal(kit.enemy(enemy.id).currentHp, 400);
});

await test("a dead enemy cannot be attacked again", async () => {
  const { kit, hero } = plain;
  await kit.endFight();
  await kit.fight(2, { heroFaces: { [hero.id]: 19 } });
  const [enemy, other] = plain.world.enemies();
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.place(other.id, 9, 9);
  kit.setEnemy(enemy.id, { currentHp: 3 });
  const kill = await kit.swing(hero.id, enemy.id, [15, 4]);
  assert.equal(kill.result.dead, true);
  assert.equal(kit.enemy(enemy.id).currentHp, 0);
  assert.equal(kit.enemy(enemy.id).status, "dead");
  const again = await kit.swing(hero.id, enemy.id, [15, 4]);
  assert.equal(again.ok, false);
});

await test("A penalty can bring a hit's damage to 0, never below.", async () => {
  const { world, kit, hero, stage } = plain;
  const enemy = await stage();
  world.patch(hero.id, { abilities: { ...hero.abilities, str: 6, dex: 6 }, equipment: [{ name: "Dagger", qty: 1 }] });
  try {
    // 1d4 on a 1, with -2.
    const swing = await kit.swing(hero.id, enemy.id, [19, 1]);
    assert.equal(swing.result.hit, true);
    assert.equal(kit.enemy(enemy.id).currentHp, 400, `a hit for ${swing.damage.total} took ${400 - kit.enemy(enemy.id).currentHp}`);
  } finally {
    world.patch(hero.id, { abilities: hero.abilities, equipment: hero.equipment });
  }
});

await test("A lasting effect on Armor Class changes the number an attack has to meet (docs/rules-coverage.md: effects applied to AC).", async () => {
  const { world, kit, hero, stage } = plain;
  const enemy = await stage();
  const set = await world.invoke("set_effect", {
    enemyId: enemy.id,
    name: "Shield of Faith",
    field: "ac",
    modifiers: [{ field: "ac", mode: "add", value: 2 }],
  });
  assert.equal(set.ok, true, set.error);
  // 13 + 2: a total of 14 misses.
  const swing = await kit.swing(hero.id, enemy.id, [14 - abilityMod(16) - PB, 4]);
  assert.equal(swing.result.vsAc, 15, `the attack was rolled against AC ${swing.result.vsAc}`);
});

await plain.kit.endFight();
plain.world.close();
finish();
