// What a monster does besides a weapon attack is still an action with the
// numbers its block prints (SRD 5.1, Monsters: Actions, Recharge, Innate and
// regular Spellcasting): one action a round whatever it is, the DC and dice
// of the ability, a recharge that comes back on a d6 at the start of its
// turn, spells from its own list with its own DC and slots. The saves it
// forces are the character's full saves (Evasion, Brave), and the creature's
// own saves carry what is on it (Magic Resistance, Bane, restrained). A
// creature's concentration and the conditions it holds end with it.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { d20Count, monsterKit, ROWS } from "./lib/enforce-monsters.mjs";

const { test, finish } = suite("test-enforce-monster-actions");
const world = await openWorld();
const kit = await combatKit(world);
const mk = await monsterKit(world, kit);
const encounters = await import("../src/lib/db/encounters.ts");
const rolls = await import("../src/lib/db/rolls.ts");
const conditionTick = await import("../src/lib/dm/condition-tick.ts");

const tank = world.addHero({
  name: "Tank", class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED,
  maxHp: 300, ac: 10, acOverride: true,
});
const rogue = world.addHero({
  name: "Rogue", class: "rogue", level: 7, abilities: { dex: 16 }, proficiencies: TRAINED,
  maxHp: 300, ac: 10, acOverride: true,
  features: [{ name: "Evasion", source: "class" }, { name: "Uncanny Dodge", source: "class" }],
});
// A halfling carries its Brave trait on the sheet, as the builder writes it.
const halfling = world.addHero({
  name: "Pip", class: "fighter", level: 5, race: "halfling", proficiencies: TRAINED,
  maxHp: 300, ac: 10, acOverride: true, features: [{ name: "Brave", source: "race" }],
});
const cleric = world.addHero({
  name: "Cleric", class: "cleric", level: 5, abilities: { wis: 16 }, proficiencies: TRAINED,
  maxHp: 300, ac: 10, acOverride: true,
  spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } }, prepared: ["Hold Person"], known: [], cantrips: ["Sacred Flame"] },
});
const heroes = [tank, rogue, halfling, cleric];

// A creature whose one special action is a save ability, the shape a
// breath weapon or a spit takes on a block.
const SPITTER = {
  name: "Spitter", size: "Medium", type: "Monstrosity", armor_class: 12, hit_points: 60, cr: 2,
  actions: [
    { name: "Claw", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.", attack_bonus: 4, damage_dice: "1d6", damage_bonus: 2 },
    { name: "Poison Spit", desc: "The spitter spits at one creature it can see within 30 ft. of it. The target must make a DC 13 Constitution saving throw, taking 10 (3d6) poison damage on a failed save, or half as much damage on a successful one." },
  ],
};

// SRD 5.1 Cult Fanatic's spellcasting: its highest slots are 2nd level.
const FANATIC = {
  name: "Cult Fanatic", size: "Medium", type: "Humanoid", armor_class: 13, hit_points: 33, cr: 2,
  wisdom: 13,
  actions: [
    { name: "Dagger", desc: "Melee or Ranged Weapon Attack: +4 to hit, reach 5 ft. or range 20/60 ft., one creature. Hit: 4 (1d4 + 2) piercing damage.", attack_bonus: 4, damage_dice: "1d4", damage_bonus: 2 },
  ],
  special_abilities: [
    { name: "Spellcasting", desc: "The fanatic is a 4th-level spellcaster. Its spellcasting ability is Wisdom (spell save DC 11, +3 to hit with spell attacks). The fanatic has the following cleric spells prepared:\n\n* Cantrips (at will): light, sacred flame, thaumaturgy\n* 1st level (4 slots): command, inflict wounds, shield of faith\n* 2nd level (3 slots): hold person, spiritual weapon" },
  ],
};

const faces = Object.fromEntries(heroes.map((hero, index) => [hero.id, 19 - index]));

async function stage(row, count = 1) {
  await kit.endFight();
  for (const hero of heroes) {
    world.patch(hero.id, { currentHp: 300, conditions: [], conditionMeta: {}, concentratingOn: null });
  }
  await kit.fight(count, { heroFaces: faces });
  const enemies = world.enemies();
  if (row) {
    for (const enemy of enemies) {
      mk.stage(enemy.id, row);
    }
  }
  kit.place(tank.id, 5, 5);
  kit.place(rogue.id, 7, 5);
  kit.place(halfling.id, 9, 5);
  kit.place(cleric.id, 11, 5);
  enemies.forEach((enemy, index) => kit.place(enemy.id, 5 + index * 2, 7));
  return enemies;
}

// Ends turns in initiative order until the round wraps, with `faces` queued
// for the dice the wrap rolls (a recharge d6, a re-save). Returns them.
function nextRound(...faces) {
  const round = world.encounter().round;
  world.clearDice();
  world.diceLog();
  world.dice(...faces);
  for (let guard = 0; guard < 10 && world.encounter().round === round; guard += 1) {
    assert.equal(kit.endTurn(kit.current().userId), true);
  }
  const rolled = world.diceLog();
  world.clearDice();
  return rolled;
}

// The save a creature makes to end a condition as its own turn ends
// (src/lib/dm/condition-tick.ts endTurnSaves), dice forced.
function turnEndSave(enemyId, ...faces) {
  world.clearDice();
  world.diceLog();
  world.dice(...faces);
  conditionTick.endTurnSaves(world.campaign(), world.encounter(), [enemyId]);
  const rolled = world.diceLog();
  world.clearDice();
  return rolled;
}

// listRecentRolls reads the newest rolls back oldest first.
const lastSave = () => rolls.listRecentRolls(world.campaignId, 20).filter((roll) => roll.kind === "saving_throw").at(-1);

// ---- the enemy action guard (N:B9, C:G9) ----

await test("A monster's special action is its action: after an attack it casts nothing more that round, and a stunned or dead creature casts nothing at all.", async () => {
  const [spitter] = await stage(SPITTER);
  kit.freshRound();
  const hit = await mk.forced([15, 1], () => world.invoke("enemy_attack", { enemyId: spitter.id, targetCharacterId: tank.id }));
  assert.equal(hit.ok, true, hit.error);
  const cast = await mk.forced([1, 6, 6, 6], () =>
    world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: spitter.id, ability: "Poison Spit", saveAbility: "con", dc: 13, damage: "3d6" }),
  );
  assert.equal(cast.ok, false, "the spitter attacked and spat in the same round");
  const breath = await mk.forced([1, 6, 6, 6], () =>
    world.invoke("aoe_damage", { characterIds: [tank.id], casterEnemyId: spitter.id, damage: "3d6", saveAbility: "con", dc: 13 }),
  );
  assert.equal(breath.ok, false, "the spitter attacked and breathed in the same round");
  kit.freshRound();
  kit.setEnemy(spitter.id, { conditions: ["stunned"] });
  const stunned = await world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: spitter.id, ability: "Poison Spit", saveAbility: "con", dc: 13, damage: "3d6" });
  assert.equal(stunned.ok, false, "a stunned creature cast");
  kit.setEnemy(spitter.id, { conditions: [], currentHp: 0 });
  encounters.patchEnemyHp(spitter.id, 0, "dead");
  const dead = await world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: spitter.id, ability: "Poison Spit", saveAbility: "con", dc: 13, damage: "3d6" });
  assert.equal(dead.ok, false, "a dead creature cast");
  assert.equal(world.sheet(tank.id).currentHp, 300 - 3);
});

await test("An area ability a monster uses is its action for the round: it attacks no more that round.", async () => {
  const [spitter] = await stage(SPITTER);
  kit.freshRound();
  const spit = await mk.forced([20, 1, 1, 1], () =>
    world.invoke("aoe_damage", { characterIds: [tank.id], casterEnemyId: spitter.id, ability: "Poison Spit", damage: "3d6", saveAbility: "con", dc: 13 }),
  );
  assert.equal(spit.ok, true, spit.error);
  const hit = await mk.forced([15, 1], () => world.invoke("enemy_attack", { enemyId: spitter.id, targetCharacterId: tank.id }));
  assert.equal(hit.ok, false, "the spitter breathed and then attacked");
});

await test("A monster ability's save, DC and dice are the ones its block prints, whatever the call sends.", async () => {
  const [spitter] = await stage(SPITTER);
  kit.freshRound();
  const out = await mk.forced([1, 2, 2, 2], () =>
    world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: spitter.id, ability: "Poison Spit", saveAbility: "dex", dc: 5, damage: "1d4" }),
  );
  assert.equal(out.ok, true, out.error);
  const save = lastSave();
  assert.equal(save.dc, 13);
  assert.match(save.detail, /CON/);
  assert.equal(out.rolled.filter((die) => die.sides === 6).length, 3, "the damage was not the block's 3d6");
  assert.equal(world.sheet(tank.id).currentHp, 300 - 6);
});

await test("A Recharge 5-6 ability is spent when used and comes back only on a 5 or 6 rolled at the start of the creature's turn; its DC and dice are the block's.", async () => {
  const [dragon] = await stage(ROWS.adultRedDragon);
  kit.freshRound();
  const breathe = (dice) =>
    mk.forced(dice, () =>
      world.invoke("aoe_damage", { characterIds: [tank.id], casterEnemyId: dragon.id, ability: "Fire Breath", damage: "1d6", saveAbility: "str", dc: 5 }),
    );
  const first = await breathe([...new Array(18).fill(1), 1]);
  assert.equal(first.ok, true, first.error);
  assert.equal(first.result.dc, 21);
  assert.equal(first.result.saveAbility, "dex");
  assert.equal(first.rolled.filter((die) => die.sides === 6).length, 18);
  kit.freshRound();
  assert.equal((await breathe([...new Array(18).fill(1), 1])).ok, false, "the breath came back without a recharge");
  // Round 2: its turn starts as the order wraps past it; a 4 does not
  // recharge it.
  assert.deepEqual(nextRound(4).map((die) => die.sides), [6]);
  assert.equal(world.encounter().round, 2);
  assert.equal((await breathe([...new Array(18).fill(1), 1])).ok, false, "a 4 recharged Recharge 5-6");
  nextRound(5);
  assert.equal((await breathe([...new Array(18).fill(1), 1])).ok, true, "a 5 did not recharge Recharge 5-6");
});

// ---- enemy spellcasting (C:G32, N:T10) ----

await test("A spellcasting monster casts only the spells its block lists, at its own spell save DC, spending its slots.", async () => {
  const [lich] = await stage(ROWS.lich);
  kit.freshRound();
  const wish = await world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: lich.id, spell: "Wish", saveAbility: "wis", dc: 10, damage: "1d4" });
  assert.equal(wish.ok, false, "a lich cast a spell its block does not list");
  const blight = await mk.forced([1, ...new Array(8).fill(1)], () =>
    world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: lich.id, spell: "Blight", saveAbility: "con", dc: 5, damage: "8d8", halfOnSave: true, damageType: "necrotic" }),
  );
  assert.equal(blight.ok, true, blight.error);
  assert.equal(lastSave().dc, 20);
  // Slots run out: a cult fanatic's three 2nd-level slots hold three Hold
  // Persons, and it has no higher slot to cast a fourth from. (A lich
  // casting a 4th-level spell a fourth time would use a 5th-level slot, as
  // the SRD allows, so the lich is not the one to count on.)
  const [fanatic] = await stage(FANATIC);
  for (let cast = 1; cast <= 3; cast += 1) {
    kit.freshRound();
    const again = await mk.forced([20], () =>
      world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: fanatic.id, spell: "Hold Person", saveAbility: "wis", dc: 11, condition: "paralyzed" }),
    );
    assert.equal(again.ok, true, again.error);
  }
  kit.freshRound();
  const fourth = await world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: fanatic.id, spell: "Hold Person", saveAbility: "wis", dc: 11, condition: "paralyzed" });
  assert.equal(fourth.ok, false, "a fourth 2nd-level spell from three slots");
});

await test("A spell a monster casts at a character resolves as the spell does: its save, its damage, half on a save when the spell says so.", async () => {
  if (!world.hasPack) {
    return;
  }
  const [lich] = await stage(ROWS.lich);
  kit.freshRound();
  const out = await mk.forced([1, ...new Array(8).fill(2)], () =>
    world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: lich.id, spell: "Blight", saveAbility: "dex", dc: 5, damage: "1d4" }),
  );
  assert.equal(out.ok, true, out.error);
  assert.match(lastSave().detail, /CON/);
  assert.equal(out.rolled.filter((die) => die.sides === 8).length, 8);
  assert.equal(world.sheet(tank.id).currentHp, 300 - 16);
});

// ---- the character's full save (F:H4, F:M4) ----

await test("Evasion: a Dexterity save for half takes nothing on a success and half on a failure, from cast_at_player too.", async () => {
  await stage();
  const made = await mk.forced([20, 6, 6, 6, 6], () =>
    world.invoke("cast_at_player", { characterId: rogue.id, saveAbility: "dex", dc: 15, damage: "4d6", halfOnSave: true, damageType: "fire" }),
  );
  assert.equal(made.ok, true, made.error);
  assert.equal(world.sheet(rogue.id).currentHp, 300, "Evasion took damage on a made save");
  const failed = await mk.forced([1, 6, 6, 6, 6], () =>
    world.invoke("cast_at_player", { characterId: rogue.id, saveAbility: "dex", dc: 15, damage: "4d6", halfOnSave: true, damageType: "fire" }),
  );
  assert.equal(failed.ok, true, failed.error);
  assert.equal(world.sheet(rogue.id).currentHp, 300 - 12);
});

await test("Brave: a halfling rolls with advantage against being frightened when a monster forces the save.", async () => {
  await stage();
  const out = await mk.forced([1, 20], () =>
    world.invoke("cast_at_player", { characterId: halfling.id, saveAbility: "wis", dc: 15, condition: "frightened", rounds: 2 }),
  );
  assert.equal(out.ok, true, out.error);
  assert.equal(d20Count(out.rolled), 2);
  assert.ok(!world.sheet(halfling.id).conditions.includes("frightened"));
});

// ---- the creature's own saves (C:G31, S:M19) ----

await test("Magic Resistance: advantage on saving throws against spells and other magical effects.", async () => {
  const [enemy] = await stage();
  kit.setEnemy(enemy.id, { stats: { traits: ["Magic Resistance: The creature has advantage on saving throws against spells and other magical effects."] } });
  kit.giveTurn(cleric.id);
  kit.place(cleric.id, 5, 6);
  const out = await mk.forced([1, 20, 4, 4], () =>
    world.invoke("cast_at_enemy", { characterId: cleric.id, targetEnemyId: enemy.id, spell: "Sacred Flame", saveAbility: "dex", damage: "2d8", damageType: "radiant" }),
  );
  assert.equal(out.ok, true, out.error);
  assert.equal(d20Count(out.rolled), 2, "Magic Resistance gave no advantage");
});

await test("An enemy's save to end a condition is its full save: Bane's d4 comes off it and restrained puts a Dexterity save at disadvantage.", async () => {
  const [enemy] = await stage();
  kit.setEnemy(enemy.id, {
    conditions: ["paralyzed", "baned"],
    conditionMeta: { paralyzed: { saveEnds: { ability: "wis", dc: 10 } }, baned: { rounds: 5 } },
  });
  const rolled = turnEndSave(enemy.id, 12, 4);
  assert.ok(rolled.some((die) => die.sides === 4), "Bane's d4 was not rolled on the re-save");
  assert.ok(kit.enemy(enemy.id).conditions.includes("paralyzed"), "12 - 4 made a DC 10 save");
  kit.setEnemy(enemy.id, {
    conditions: ["restrained"],
    conditionMeta: { restrained: { saveEnds: { ability: "dex", dc: 10 } } },
  });
  const second = turnEndSave(enemy.id, 15, 2);
  assert.equal(d20Count(second), 2, "a restrained creature's Dexterity re-save was a straight roll");
  assert.ok(kit.enemy(enemy.id).conditions.includes("restrained"));
});

// ---- conditions that belong to a creature (C:G28, G29, G30) ----

await test("An incapacitated creature loses its concentration, and the spell's hold on its targets ends.", async () => {
  const [enemy] = await stage();
  encounters.setEnemyConcentration(enemy.id, "Hold Person");
  // How a spell's hold is stored: the spell and its caster on the condition.
  world.patch(tank.id, { conditions: ["paralyzed"], conditionMeta: { paralyzed: { source: enemy.id, spell: "Hold Person" } } });
  const out = await world.invoke("set_enemy_condition", { enemyId: enemy.id, condition: "stunned", rounds: 1 });
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.enemy(enemy.id).concentration, null);
  if (world.hasPack) {
    assert.ok(!world.sheet(tank.id).conditions.includes("paralyzed"));
  }
});

await test("A grapple, charm or fear a creature holds ends when the creature dies.", async () => {
  const [enemy] = await stage(null, 2);
  for (const condition of ["grappled", "frightened"]) {
    const set = await world.invoke("set_condition", { characterId: tank.id, condition, sourceEnemyId: enemy.id });
    assert.equal(set.ok, true, set.error);
  }
  const killed = await world.invoke("damage_enemy", { enemyId: enemy.id, amount: 100 });
  assert.equal(killed.ok, true, killed.error);
  const left = world.sheet(tank.id).conditions;
  assert.ok(!left.includes("grappled"), "still grappled by a dead creature");
  assert.ok(!left.includes("frightened"), "still frightened of a dead creature");
});

await test("A charmed creature cannot attack its charmer or target it with harmful magic.", async () => {
  // A humanoid, so Hold Person is a spell that could land on it.
  const [enemy] = await stage({ ...SPITTER, type: "Humanoid" });
  const set = await world.invoke("set_enemy_condition", { enemyId: enemy.id, condition: "charmed", sourceCharacterId: tank.id });
  assert.equal(set.ok, true, set.error);
  kit.freshRound();
  const hit = await mk.forced([15, 1], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: tank.id }));
  assert.equal(hit.ok, false, "a charmed creature attacked its charmer");
  const spit = await world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: enemy.id, ability: "Poison Spit", saveAbility: "con", dc: 13 });
  assert.equal(spit.ok, false, "a charmed creature spat at its charmer");
  // The other way round: a charmed cleric cannot cast at the charmer, and
  // the refusal spends nothing.
  await world.invoke("clear_enemy_condition", { enemyId: enemy.id, condition: "charmed" });
  world.patch(cleric.id, { conditions: ["charmed"], conditionMeta: { charmed: { source: enemy.id } } });
  kit.giveTurn(cleric.id);
  kit.place(cleric.id, 5, 6);
  const before = world.sheet(cleric.id).spellcasting.slots[2].used;
  const held = await world.invoke("cast_at_enemy", { characterId: cleric.id, targetEnemyId: enemy.id, spell: "Hold Person", saveAbility: "wis", level: 2, condition: "paralyzed" });
  assert.equal(held.ok, false, "a charmed cleric cast at the charmer");
  assert.equal(world.sheet(cleric.id).spellcasting.slots[2].used, before);
  // Free of the charm, the same cast lands: the refusal was the charm's.
  world.patch(cleric.id, { conditions: [], conditionMeta: {} });
  const free = await mk.forced([1], () =>
    world.invoke("cast_at_enemy", { characterId: cleric.id, targetEnemyId: enemy.id, spell: "Hold Person", saveAbility: "wis", level: 2, condition: "paralyzed" }),
  );
  assert.equal(free.ok, true, free.error);
  world.patch(cleric.id, { spellcasting: cleric.spellcasting, concentratingOn: null });
});

await test("An ability a monster does not have is not improvised", async () => {
  const [spitter] = await stage(SPITTER);
  kit.freshRound();
  const out = await world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: spitter.id, ability: "Disintegration Ray", saveAbility: "dex", dc: 25, damage: "10d6" });
  assert.equal(out.ok, false, "an ability the block does not list resolved");
  assert.equal(world.sheet(tank.id).currentHp, 300);
  // Nor is its action spent by the refusal: it can still attack.
  const hit = await mk.forced([15, 1], () => world.invoke("enemy_attack", { enemyId: spitter.id, targetCharacterId: tank.id }));
  assert.equal(hit.ok, true, hit.error);
});

await kit.endFight();
world.close();
finish();
