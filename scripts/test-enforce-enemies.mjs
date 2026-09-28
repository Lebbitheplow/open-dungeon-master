// The enemies' side of a fight: an enemy attacks with its stat block's
// numbers against the target's real Armor Class, its hit points stay between
// 0 and its maximum, at 0 it is dead and does nothing more, and when the
// last one falls the fight ends and the party is paid in experience.
//
// The rules, from SRD 5.1:
//   - Experience by challenge rating (the table below), divided evenly among
//     the characters who took part.
//   - Encounter difficulty: each character's XP thresholds by level, summed,
//     against the monsters' XP times a multiplier for their number, one step
//     higher for a party of fewer than three.
//   - A legendary creature takes its legendary actions at the end of other
//     creatures' turns and regains them at the start of its own; a lair acts
//     on initiative count 20, once a round.
//
// ODM's own rules, pinned here as it documents them:
//   - start_encounter refuses a fight whose adjusted XP passes the party's
//     deadly threshold times a factor set by the campaign's difficulty: 1.0
//     easy, 1.25 normal, 1.5 hard, 2.0 deadly (src/lib/srd/encounter-math.ts).
//   - A fight that ends with the enemies fled or in a truce pays half
//     (src/lib/dm/enemy-damage.ts finishEncounter).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-enemies");
const world = await openWorld();
const kit = await combatKit(world);
const { xpForCr } = await import("../src/lib/srd/encounter-math.ts");

// SRD 5.1, Experience Points by Challenge Rating.
const XP_BY_CR = {
  0: 10, 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800,
  6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000,
  14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000,
  21: 33000, 22: 41000, 23: 50000, 24: 62000, 30: 155000,
};

const tank = world.addHero({
  class: "fighter", level: 5, abilities: { str: 16, dex: 14 }, proficiencies: TRAINED,
  equipment: [
    { name: "Chain Mail", qty: 1, equipped: true },
    { name: "Shield", qty: 1, equipped: true },
    { name: "Longsword", qty: 1, equipped: true },
  ],
  acOverride: false,
});
const mage = world.addHero({
  class: "wizard", level: 5, abilities: { dex: 14, int: 16 }, proficiencies: TRAINED,
  acOverride: false,
  spellcasting: {
    ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Shield"], known: [], cantrips: [],
  },
});
const heroes = [tank, mage];

async function stage(count = 1, options = {}) {
  await kit.endFight();
  await kit.fight(count, { heroFaces: { [tank.id]: 19, [mage.id]: 10 }, ...options });
  const enemies = world.enemies();
  kit.place(tank.id, 5, 5);
  kit.place(mage.id, 7, 5);
  enemies.forEach((enemy, index) => kit.place(enemy.id, 5 + index * 2, 6));
  for (const hero of heroes) {
    world.patch(hero.id, { currentHp: 30, xp: 0 });
  }
  return enemies;
}

// One enemy attack with its dice forced.
// An enemy takes one action a round; each strike here is a round of its own.
async function strike(enemy, target, faces, args = {}) {
  kit.freshRound();
  world.clearDice();
  world.diceLog();
  world.dice(...faces);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id, ...args });
  const unused = world.clearDice();
  return { out, ok: out.ok, result: out.result ?? {}, unused };
}

await test("an enemy attacks with its stat block's bonus against the armor actually worn", async () => {
  // Chain mail 16, shield +2.
  assert.equal(world.sheet(tank.id).ac, 18);
  let [enemy] = await stage();
  kit.setEnemy(enemy.id, { stats: { attacks: [{ name: "Maul", toHit: 6, damage: "2d6+4", type: "bludgeoning" }] } });
  let hit = await strike(enemy, tank, [12, 3, 5]);
  assert.equal(hit.result.vsAc, 18);
  assert.equal(hit.result.swings[0].rolled, 12 + 6);
  assert.equal(hit.result.hit, true);
  assert.equal(hit.result.totalDamage, 3 + 5 + 4);
  assert.equal(world.sheet(tank.id).currentHp, 30 - 12);

  [enemy] = await stage();
  kit.setEnemy(enemy.id, { stats: { attacks: [{ name: "Maul", toHit: 6, damage: "2d6+4", type: "bludgeoning" }] } });
  hit = await strike(enemy, tank, [11, 3, 5]);
  assert.equal(hit.result.hit, false);
  assert.equal(hit.unused, 2);
  assert.equal(world.sheet(tank.id).currentHp, 30);
});

await test("the caller cannot hand an enemy better numbers", async () => {
  const [enemy] = await stage();
  const out = await strike(enemy, mage, [5, 3], { toHit: 20, damage: "10d10", attack: "Club" });
  assert.equal(out.result.swings[0].rolled, 5 + 4);
  assert.equal(out.result.hit, false);
  // A made-up attack name falls back to the block's first attack.
  const invented = await strike(enemy, mage, [15, 3], { attack: "Disintegration Ray" });
  assert.equal(invented.result.attack, "Club");
  assert.equal(invented.result.totalDamage, 3 + 2);
});

await test("a natural 20 from an enemy is a critical hit, a natural 1 a miss", async () => {
  let [enemy] = await stage();
  const crit = await strike(enemy, tank, [20, 3, 5]);
  assert.equal(crit.result.swings[0].crit, true);
  assert.equal(crit.result.totalDamage, 3 + 5 + 2);
  [enemy] = await stage();
  kit.setEnemy(enemy.id, { stats: { attacks: [{ name: "Club", toHit: 30, damage: "1d6+2", type: "bludgeoning" }] } });
  const fumble = await strike(enemy, mage, [1, 3]);
  assert.equal(fumble.result.hit, false);
  assert.equal(world.sheet(mage.id).currentHp, 30);
});

await test("the Shield spell raises the Armor Class an enemy has to meet, and spends the slot and the reaction", async () => {
  const [enemy] = await stage();
  // No armor: 10 + DEX 14.
  const before = await strike(enemy, mage, [8, 3]);
  assert.equal(before.result.vsAc, 10 + 2);
  assert.equal(before.result.hit, true);
  const shield = await world.invoke("use_reaction", { characterId: mage.id, feature: "Shield" });
  assert.equal(shield.ok, true, shield.error);
  assert.equal(world.sheet(mage.id).spellcasting.slots[1].used, 1);
  assert.deepEqual(world.encounter().reactionsUsed, [mage.id]);
  const after = await strike(enemy, mage, [12, 3]);
  assert.equal(after.result.vsAc, 17);
  assert.equal(after.result.hit, false);
  const met = await strike(enemy, mage, [13, 3]);
  assert.equal(met.result.hit, true);
  world.patch(mage.id, { spellcasting: mage.spellcasting, conditions: [], conditionMeta: {} });
});

await test("a lasting effect on a character's Armor Class is what the enemy rolls against", async () => {
  const [enemy] = await stage();
  const set = await world.invoke("set_effect", {
    characterId: mage.id, name: "Shield of Faith", field: "ac",
    modifiers: [{ field: "ac", mode: "add", value: 2 }],
  });
  assert.equal(set.ok, true, set.error);
  const out = await strike(enemy, mage, [9, 3]);
  assert.equal(out.result.vsAc, 14);
  assert.equal(out.result.hit, false);
  await world.invoke("clear_effect", { characterId: mage.id, name: "Shield of Faith" });
});

await test("an enemy's hit points stay between 0 and its maximum", async () => {
  const [enemy] = await stage(2);
  for (const amount of [0, -5, 201, 1.5, "lots"]) {
    const out = await world.invoke("damage_enemy", { enemyId: enemy.id, amount });
    assert.equal(out.ok, false, String(amount));
    assert.equal(kit.enemy(enemy.id).currentHp, 40, String(amount));
  }
  const some = await world.invoke("damage_enemy", { enemyId: enemy.id, amount: 15 });
  assert.equal(some.ok, true, some.error);
  assert.equal(kit.enemy(enemy.id).currentHp, 25);
  assert.equal(kit.enemy(enemy.id).status, "alive");
  const over = await world.invoke("damage_enemy", { enemyId: enemy.id, amount: 200 });
  assert.equal(over.ok, true, over.error);
  assert.equal(kit.enemy(enemy.id).currentHp, 0);
  assert.equal(kit.enemy(enemy.id).status, "dead");
  assert.equal(kit.enemy(enemy.id).maxHp, 40);
  // Dead is dead: no more damage, no action, no condition.
  assert.equal((await world.invoke("damage_enemy", { enemyId: enemy.id, amount: 5 })).ok, false);
  assert.equal((await strike(enemy, tank, [15, 3])).ok, false);
  assert.equal((await world.invoke("set_enemy_condition", { enemyId: enemy.id, condition: "prone" })).ok, false);
  assert.equal(kit.token(enemy.id), null);
});

await test("an incapacitated enemy does not attack", async () => {
  const [enemy] = await stage();
  for (const condition of ["stunned", "paralyzed", "unconscious", "incapacitated", "petrified"]) {
    kit.setEnemy(enemy.id, { conditions: [condition] });
    const out = await strike(enemy, tank, [15, 3]);
    assert.equal(out.ok, false, condition);
    assert.equal(out.unused, 2, condition);
  }
  assert.equal(world.sheet(tank.id).currentHp, 30);
});

await test("experience by challenge rating matches the SRD table", () => {
  for (const [cr, xp] of Object.entries(XP_BY_CR)) {
    assert.equal(xpForCr(Number(cr)), xp, `CR ${cr}`);
  }
});

await test("a spawned enemy carries the XP of its challenge rating", async () => {
  await kit.endFight();
  await world.beginFight([{ monster: "goblin", count: 1 }]);
  const [goblin] = world.enemies();
  assert.equal(goblin.xp, XP_BY_CR[goblin.cr]);
  if (world.hasPack) {
    assert.equal(goblin.cr, 0.25);
    assert.equal(goblin.ac, 15);
    assert.equal(goblin.maxHp, 7);
  }
  assert.equal(goblin.currentHp, goblin.maxHp);
});

await test("the last enemy falling ends the fight and pays its XP, split evenly", async () => {
  for (const [cr, count] of [[0.25, 2], [1, 3], [5, 1], [0.125, 3]]) {
    const enemies = await stage(count);
    for (const enemy of enemies) {
      kit.setEnemy(enemy.id, { stats: { cr, xp: XP_BY_CR[cr] } });
    }
    for (const enemy of enemies.slice(0, -1)) {
      assert.equal((await world.invoke("damage_enemy", { enemyId: enemy.id, amount: 100 })).ok, true);
      assert.notEqual(world.encounter(), null);
      assert.equal(world.sheet(tank.id).xp, 0);
    }
    const last = await world.invoke("damage_enemy", { enemyId: enemies.at(-1).id, amount: 100 });
    assert.equal(last.ok, true, last.error);
    assert.equal(last.result.encounterOver, true);
    assert.equal(last.result.outcome, "victory");
    assert.equal(world.encounter(), null);
    const each = Math.floor((XP_BY_CR[cr] * count) / heroes.length);
    for (const hero of heroes) {
      assert.equal(world.sheet(hero.id).xp, each, `CR ${cr} x${count}`);
    }
  }
});

await test("a player's killing blow ends the fight the same way", async () => {
  const [enemy] = await stage();
  kit.setEnemy(enemy.id, { currentHp: 3 });
  const swing = await kit.swing(tank.id, enemy.id, [15, 4]);
  assert.equal(swing.result.dead, true);
  assert.equal(swing.result.encounterOver, true);
  assert.equal(world.encounter(), null);
  assert.equal(world.sheet(tank.id).xp, 25);
});

await test("enemies that flee or make terms pay half, a rout of the party nothing (ODM's rule)", async () => {
  for (const [outcome, share] of [["enemies_fled", 0.5], ["truce", 0.5], ["party_fled", 0], ["party_defeated", 0], ["victory", 1]]) {
    await stage(2);
    const out = await world.invoke("end_encounter", { outcome });
    assert.equal(out.ok, true, out.error);
    assert.equal(world.encounter(), null);
    assert.equal(world.sheet(tank.id).xp, Math.floor((100 * share) / 2), outcome);
  }
});

await test("the last enemy fleeing ends the fight", async () => {
  const [one, two] = await stage(2);
  assert.equal((await world.invoke("enemy_flees", { enemyId: one.id })).ok, true);
  assert.notEqual(world.encounter(), null);
  const out = await world.invoke("enemy_flees", { enemyId: two.id });
  assert.equal(out.result.encounterOver, true);
  assert.equal(world.encounter(), null);
});

await test("reinforcements roll initiative and take a place in the order", async () => {
  await stage(1);
  const before = world.encounter().order.length;
  world.dice(11);
  const out = await world.invoke("add_enemies", { enemies: [{ monster: "goblin", count: 1 }] });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const encounter = world.encounter();
  assert.equal(encounter.order.length, before + 1);
  const added = world.enemies().at(-1);
  const entry = encounter.order.find((slot) => slot.enemyId === added.id);
  assert.equal(entry.initiative, 11 + added.stats.dexMod);
  assert.equal(kit.current().characterId, tank.id);
  const counts = encounter.order.map((slot) => slot.initiative);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
});

await test("a fight past the party's deadly ceiling is refused and nothing is created", async () => {
  await kit.endFight();
  // One level 1 character: deadly at 100 XP, the normal ceiling 125.
  const solo = await openWorld();
  const hero = solo.addHero({ class: "fighter", level: 1 });
  // Two goblins: 100 XP, doubled for a pair against a party under three.
  const two = await solo.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 2 }] });
  assert.equal(two.ok, false);
  assert.equal(solo.encounter(), null);
  // One: 50 XP at x1.5.
  const one = await solo.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 1 }] });
  assert.equal(one.ok, true, one.error);
  assert.equal(solo.enemies().length, 1);
  // And no second fight on top of the first.
  const again = await solo.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 1 }] });
  assert.equal(again.ok, false);
  assert.equal(solo.enemies().length, 1);
  assert.ok(hero);

  const deadly = await openWorld({ campaign: { difficulty: "deadly" } });
  deadly.addHero({ class: "fighter", level: 1 });
  // The same pair is 200 adjusted XP against a ceiling of 200.
  const met = await deadly.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 2 }] });
  assert.equal(met.ok, true, met.error);
});

const DRAGON = [
  "Legendary Resistance (3/Day). If the dragon fails a saving throw, it can choose to succeed instead.",
  "Legendary action: Detect. The dragon makes a Wisdom (Perception) check.",
  "Legendary action: Tail Attack. The dragon makes a tail attack.",
  "Legendary action: Wing Attack (Costs 2 Actions). The dragon beats its wings.",
];

async function dragon(options = {}) {
  const [enemy] = await stage(1, options);
  kit.setEnemy(enemy.id, { stats: { traits: DRAGON } });
  const encounter = world.encounter();
  encounter.legendary.pools[enemy.id] = { actions: 3, resistances: 3 };
  kit.saveEncounter(encounter);
  return enemy;
}

const pool = (enemy) => world.encounter().legendary.pools[enemy.id];

await test("legendary actions: three a round, each at its cost, refused when the pool is short", async () => {
  const enemy = await dragon();
  const wing = await world.invoke("legendary_action", { enemyId: enemy.id, action: "Wing Attack" });
  assert.equal(wing.ok, true, wing.error);
  assert.equal(pool(enemy).actions, 1);
  const second = await world.invoke("legendary_action", { enemyId: enemy.id, action: "Wing Attack" });
  assert.equal(second.ok, false);
  assert.equal(pool(enemy).actions, 1);
  assert.equal((await world.invoke("legendary_action", { enemyId: enemy.id, action: "Detect" })).ok, true);
  assert.equal(pool(enemy).actions, 0);
  assert.equal((await world.invoke("legendary_action", { enemyId: enemy.id, action: "Detect" })).ok, false);
  assert.equal(pool(enemy).actions, 0);
  // An action the block does not list is not improvised.
  assert.equal((await world.invoke("legendary_action", { enemyId: enemy.id, action: "Meteor Swarm" })).ok, false);
});

await test("legendary actions belong to legendary creatures", async () => {
  const [enemy] = await stage();
  const out = await world.invoke("legendary_action", { enemyId: enemy.id, action: "Tail Attack" });
  assert.equal(out.ok, false);
  assert.equal((await world.invoke("legendary_resist", { enemyId: enemy.id })).ok, false);
});

await test("legendary resistance: three for the fight, never refilled", async () => {
  const enemy = await dragon();
  for (let left = 2; left >= 0; left -= 1) {
    const out = await world.invoke("legendary_resist", { enemyId: enemy.id });
    assert.equal(out.ok, true, out.error);
    assert.equal(pool(enemy).resistances, left);
  }
  assert.equal((await world.invoke("legendary_resist", { enemyId: enemy.id })).ok, false);
  assert.equal(kit.endTurn(tank.userId), true);
  assert.equal(kit.endTurn(mage.userId), true);
  assert.equal(world.encounter().round, 2);
  assert.equal(pool(enemy).resistances, 0);
  assert.equal((await world.invoke("legendary_resist", { enemyId: enemy.id })).ok, false);
});

await test("a lair acts once a round, and only in a lair", async () => {
  await stage(1, { lair: true });
  assert.equal(world.encounter().legendary.lair, true);
  assert.equal((await world.invoke("lair_action", { action: "The floor tilts" })).ok, true);
  assert.equal((await world.invoke("lair_action", { action: "The floor tilts again" })).ok, false);
  assert.equal(kit.endTurn(tank.userId), true);
  assert.equal(kit.endTurn(mage.userId), true);
  assert.equal(world.encounter().round, 2);
  assert.equal((await world.invoke("lair_action", { action: "Stalactites fall" })).ok, true);
  await stage(1);
  assert.equal(world.encounter().legendary.lair, false);
  assert.equal((await world.invoke("lair_action", { action: "The floor tilts" })).ok, false);
});

await test("A legendary creature regains its spent legendary actions at the start of its turn.", async () => {
  const enemy = await dragon();
  for (const action of ["Detect", "Detect", "Tail Attack"]) {
    assert.equal((await world.invoke("legendary_action", { enemyId: enemy.id, action })).ok, true);
  }
  assert.equal(pool(enemy).actions, 0);
  assert.equal(kit.endTurn(tank.userId), true);
  assert.equal(kit.endTurn(mage.userId), true);
  assert.equal(world.encounter().round, 2);
  assert.equal(pool(enemy).actions, 3, `round 2 began with ${pool(enemy).actions} legendary actions`);
});

await test(
  "Shield gives +5 AC until the start of the caster's next turn, whatever their Armor Class was.",
  async () => {
    const [enemy] = await stage();
    world.patch(mage.id, { ac: 12, acOverride: true });
    try {
      const shield = await world.invoke("use_reaction", { characterId: mage.id, feature: "Shield" });
      assert.equal(shield.ok, true, shield.error);
      assert.equal(world.sheet(mage.id).spellcasting.slots[1].used, 1);
      const out = await strike(enemy, mage, [12, 3]);
      assert.equal(out.result.vsAc, 17, `the shielded caster was attacked against AC ${out.result.vsAc}`);
    } finally {
      world.patch(mage.id, { acOverride: false, spellcasting: mage.spellcasting, conditions: [], conditionMeta: {} });
    }
  },
);

await test("A lasting effect on a character's Armor Class counts against every attack on them.", async () => {
  const [enemy] = await stage();
  kit.place(mage.id, 10, 10);
  kit.place(enemy.id, 10, 11);
  assert.equal(kit.endTurn(tank.userId), true);
  await world.invoke("set_effect", {
    characterId: mage.id, name: "Shield of Faith", field: "ac",
    modifiers: [{ field: "ac", mode: "add", value: 2 }],
  });
  try {
    const route = await world.route("campaigns/[campaignId]/battle-map/move");
    world.signIn({ id: mage.userId });
    world.dice(9, 3);
    const response = await route.POST(
      new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x: 10, y: 8 }) }),
      { params: Promise.resolve({ campaignId: world.campaignId }) },
    );
    world.clearDice();
    assert.equal(response.status, 200);
    // 9 + 4 against 12 + 2.
    assert.equal(world.sheet(mage.id).currentHp, 30, "a 13 hit a character whose Armor Class is 14");
  } finally {
    await world.invoke("clear_effect", { characterId: mage.id, name: "Shield of Faith" });
  }
});

await kit.endFight();
world.close();
finish();
