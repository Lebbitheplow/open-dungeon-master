// Spells that last: what Bless, Bane, Haste, Shield and Mage Armor do while
// they hold, and when they stop.
//
// The rules (SRD 5.1): Bless adds a d4 to the attack rolls and saving throws
// of up to three creatures for a minute, and Bane takes a d4 from those of
// creatures that fail a Charisma save; Haste gives +2 AC, advantage on
// Dexterity saves, doubled speed and one more action, and when it ends the
// target cannot move or act until after its next turn; Shield is +5 AC until
// the start of the caster's next turn; Mage Armor makes an unarmored
// creature's AC 13 + its Dexterity modifier for eight hours, and does nothing
// for one in armor. A duration is a duration whether it runs out in rounds
// of combat or in minutes on the road.
//
// Durations counted in rounds tick once a round for everybody, when the
// initiative order wraps (src/lib/dm/condition-tick.ts;
// scripts/test-enforce-conditions-duration.mjs pins the counting). "Until the
// start of your next turn" is not counted: the caster's turn starting ends it.
//
// The effects come from the authored rows in src/lib/srd/spell-mechanics.ts
// and src/lib/srd/condition-effects.ts, so every check here stands without
// the content pack. Every die is forced.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { cleric, fightDummies, wizard, castOnOwnTurn } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-spell-effects");
const { skipCurrentTurn } = await import("../src/lib/dm/encounter-tools.ts");
const worlds = [];

const FIGHTER = {
  class: "fighter",
  level: 5,
  abilities: { str: 16, dex: 14 },
  acOverride: false,
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
  proficiencies: {
    saves: ["str", "con"], skills: [], expertise: [], languages: ["Common"], tools: [],
    armor: ["light", "medium", "heavy", "shields"], weapons: ["simple", "martial"],
  },
};
const TO_HIT = proficiencyBonus(5) + abilityMod(16);

async function party(...heroes) {
  const world = castOnOwnTurn(await openWorld());
  worlds.push(world);
  return { world, sheets: heroes.map((hero) => world.addHero(hero)) };
}

// Skips turns until the round number moves: one tick of every duration.
function nextRound(world) {
  const round = world.encounter().round;
  for (let turn = 0; turn < 12 && world.encounter().round === round; turn += 1) {
    assert.equal(skipCurrentTurn(world.campaignId), true);
  }
  assert.equal(world.encounter().round, round + 1);
}

async function swing(world, hero, enemy, faces) {
  world.diceLog();
  world.dice(...faces);
  const out = await world.invoke("pc_attack", {
    characterId: hero.id, enemyId: enemy.id, targetEnemyId: enemy.id, weapon: "Longsword",
  });
  const log = world.diceLog();
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  return { rolled: out.result.rolled, d4: log.filter((die) => die.sides === 4).length };
}

async function save(world, hero, ability, faces) {
  world.diceLog();
  world.dice(...faces);
  const out = await world.invoke("request_roll", {
    characterId: hero.id, kind: "saving_throw", ability, dc: 10, reason: "a test of nerve",
  });
  const log = world.diceLog();
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  return { total: out.result.total, d4: log.filter((die) => die.sides === 4).length, d20: log.filter((die) => die.sides === 20).length };
}

const held = (world, hero) => world.sheet(hero.id).conditions;
const meta = (world, hero) => world.sheet(hero.id).conditionMeta;

// ---- Bless and Bane ----

await test("Bless adds a d4 to attack rolls and saving throws, for the blessed and nobody else", async () => {
  const { world, sheets: [priest, friend, other] } = await party(cleric(5), FIGHTER, FIGHTER);
  const [enemy] = await fightDummies(world, 1, { heroFaces: { [priest.id]: 20, [friend.id]: 18, [other.id]: 16 } });
  const cast = await world.invoke("cast_buff", { characterId: priest.id, spell: "Bless", level: 1, targetCharacterIds: [priest.id, friend.id] });
  assert.equal(cast.ok, true, cast.error);
  assert.deepEqual(world.sheet(priest.id).spellcasting.slots["1"], { max: 4, used: 1 });
  assert.deepEqual(held(world, friend), ["blessed"]);
  assert.deepEqual(meta(world, friend), { blessed: { rounds: 10 } }, "a minute is ten rounds");
  assert.deepEqual(held(world, other), []);

  skipCurrentTurn(world.campaignId);
  assert.deepEqual(await swing(world, friend, enemy, [10, 3, 5]), { rolled: 10 + TO_HIT + 3, d4: 1 });
  skipCurrentTurn(world.campaignId);
  assert.deepEqual(await swing(world, other, enemy, [10, 5]), { rolled: 10 + TO_HIT, d4: 0 });
  // Wisdom 10 and no proficiency: the die and the d4 are the total.
  assert.deepEqual(await save(world, friend, "wis", [9, 4]), { total: 13, d4: 1, d20: 1 });
  assert.deepEqual(await save(world, other, "wis", [9]), { total: 9, d4: 0, d20: 1 });
});

await test("Bless runs out after ten rounds of a fight", async () => {
  const { world, sheets: [priest, friend] } = await party(cleric(5), FIGHTER);
  await fightDummies(world, 1);
  await world.invoke("cast_buff", { characterId: priest.id, spell: "Bless", level: 1, targetCharacterIds: [priest.id, friend.id] });
  for (let left = 9; left >= 1; left -= 1) {
    nextRound(world);
    assert.deepEqual(meta(world, friend), { blessed: { rounds: left } }, `${left} rounds left`);
  }
  nextRound(world);
  assert.deepEqual(held(world, friend), []);
  assert.deepEqual(held(world, priest), []);
});

await test("Bless runs out after a minute on the road", async () => {
  const { world, sheets: [priest, friend] } = await party(cleric(5), FIGHTER);
  await world.invoke("cast_buff", { characterId: priest.id, spell: "Bless", level: 1, targetCharacterIds: [friend.id] });
  assert.deepEqual(held(world, friend), ["blessed"]);
  const passed = await world.invoke("pass_time", { amount: 1, unit: "minutes" });
  assert.equal(passed.ok, true, passed.error);
  assert.deepEqual(held(world, friend), []);
});

await test("Bane lands on a failed Charisma save and not on a made one, for a minute", async () => {
  const { world, sheets: [priest] } = await party(cleric(5));
  const [first, second] = await fightDummies(world, 2);
  const dc = 8 + proficiencyBonus(5) + abilityMod(18);
  const bane = (enemy, face) => {
    world.dice(face);
    return world.invoke("cast_at_enemy", {
      characterId: priest.id, targetEnemyId: enemy.id, spell: "Bane", saveAbility: "wis", level: 1, condition: "stunned",
    });
  };
  const failed = await bane(first, dc - 1);
  assert.equal(world.clearDice(), 0);
  assert.equal(failed.ok, true, failed.error);
  assert.deepEqual([failed.result.dc, failed.result.saved], [dc, false]);
  const made = await bane(second, dc);
  assert.equal(made.result.saved, true);
  const [one, two] = world.enemies().sort((a, b) => a.displayName.localeCompare(b.displayName));
  assert.deepEqual([one.conditions, one.conditionMeta], [["baned"], { baned: { rounds: 10 } }]);
  assert.deepEqual(two.conditions, []);
  assert.equal(world.sheet(priest.id).spellcasting.slots["1"].used, 2);
});

await test("a baned character takes a d4 off attack rolls and saving throws", async () => {
  const { world, sheets: [friend] } = await party(FIGHTER);
  const [enemy] = await fightDummies(world, 1);
  world.dice(1);
  const cast = await world.invoke("cast_at_player", {
    characterId: friend.id, characterIds: [friend.id], spell: "Bane", saveAbility: "cha", dc: 13, condition: "baned", rounds: 10,
  });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.deepEqual(held(world, friend), ["baned"]);
  assert.deepEqual(await swing(world, friend, enemy, [10, 3, 5]), { rolled: 10 + TO_HIT - 3, d4: 1 });
  assert.deepEqual(await save(world, friend, "wis", [9, 4]), { total: 5, d4: 1, d20: 1 });
});

await test(
  "a creature under Bane subtracts a d4 from its attack rolls and saving throws",
  async () => {
    const { world, sheets: [priest, friend] } = await party(cleric(5), FIGHTER);
    const [enemy] = await fightDummies(world, 1);
    world.dice(1);
    await world.invoke("cast_at_enemy", { characterId: priest.id, targetEnemyId: enemy.id, spell: "Bane", saveAbility: "cha", level: 1 });
    world.clearDice();
    assert.deepEqual(world.enemies()[0].conditions, ["baned"]);
    world.diceLog();
    world.dice(10, 4, 4, 4);
    const attack = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: friend.id });
    const attackDice = world.diceLog();
    world.clearDice();
    assert.equal(attack.ok, true, attack.error);
    world.dice(10, 4, 4, 4);
    const flame = await world.invoke("cast_at_enemy", { characterId: priest.id, targetEnemyId: enemy.id, spell: "Sacred Flame", saveAbility: "dex", damage: "2d8" });
    const saveDice = world.diceLog();
    world.clearDice();
    assert.equal(flame.ok, true, flame.error);
    assert.deepEqual(
      { attack: attackDice.filter((die) => die.sides === 4).length, save: saveDice.filter((die) => die.sides === 4).length },
      { attack: 1, save: 1 },
      `the baned enemy attacked for ${attack.result.swings?.[0]?.rolled} and saved for ${flame.result.save} with no d4 rolled`,
    );
  },
);

// ---- Haste ----

await test("Haste: +2 AC, advantage on Dexterity saves, for a minute", async () => {
  const { world, sheets: [mage, friend] } = await party(wizard(5), FIGHTER);
  const ac = world.sheet(friend.id).ac;
  assert.equal(ac, 10 + abilityMod(14), "unarmored");
  const cast = await world.invoke("cast_buff", { characterId: mage.id, spell: "Haste", level: 3, targetCharacterIds: [friend.id] });
  assert.equal(cast.ok, true, cast.error);
  assert.deepEqual(meta(world, friend), { hasted: { rounds: 10 } });
  assert.equal(world.sheet(friend.id).ac, ac + 2);
  assert.equal(world.sheet(mage.id).spellcasting.slots["3"].used, 1);
  const dex = await save(world, friend, "dex", [4, 15]);
  assert.deepEqual([dex.d20, dex.total], [2, 15 + abilityMod(14)], "two d20, the higher kept");
  const wis = await save(world, friend, "wis", [4]);
  assert.deepEqual([wis.d20, wis.total], [1, 4]);
  // Exactly a minute: Haste is over and its lethargy holds for the next six
  // seconds; a little more time and that is over too.
  await world.invoke("pass_time", { amount: 1, unit: "minutes" });
  assert.deepEqual(held(world, friend), ["incapacitated"]);
  assert.deepEqual(meta(world, friend), { incapacitated: { rounds: 1, source: "haste" } });
  assert.equal(world.sheet(friend.id).ac, ac);
  await world.invoke("pass_time", { amount: 1, unit: "minutes" });
  assert.deepEqual(held(world, friend), []);
});

await test("when Haste runs out by its duration the target loses its next turn to lethargy", async () => {
  const { world, sheets: [friend, mage] } = await party(FIGHTER, wizard(5));
  const [enemy] = await fightDummies(world, 1, { heroFaces: { [friend.id]: 20, [mage.id]: 10 } });
  const cast = await world.invoke("cast_buff", { characterId: mage.id, spell: "Haste", level: 3, targetCharacterIds: [friend.id] });
  assert.equal(cast.ok, true, cast.error);
  for (let round = 0; round < 10; round += 1) {
    nextRound(world);
  }
  assert.equal(held(world, friend).includes("hasted"), false, "the spell ran out");
  assert.deepEqual(meta(world, friend).incapacitated, { rounds: 1, source: "haste" }, "no lethargy when Haste ran out");
  assert.equal(world.encounter().order[world.encounter().turnIndex].characterId, friend.id);
  world.dice(10, 5);
  const out = await world.invoke("pc_attack", { characterId: friend.id, enemyId: enemy.id, targetEnemyId: enemy.id, weapon: "Longsword" });
  world.clearDice();
  assert.equal(out.ok, false, "the fighter attacked on the turn the lethargy should cost them");
  nextRound(world);
  assert.equal(held(world, friend).includes("incapacitated"), false, "the lethargy lasts one turn");
});

await test("when Haste ends the target loses its next turn to lethargy", async () => {
  const { world, sheets: [friend, mage] } = await party(FIGHTER, wizard(5, { abilities: { int: 16, con: 10 } }));
  const [enemy] = await fightDummies(world, 1, { heroFaces: { [friend.id]: 20, [mage.id]: 10 } });
  await world.invoke("cast_buff", { characterId: mage.id, spell: "Haste", level: 3, targetCharacterIds: [friend.id] });
  world.patch(mage.id, { concentratingOn: "Haste" });
  world.dice(1);
  await world.invoke("apply_damage", { characterId: mage.id, amount: 6 });
  world.clearDice();
  assert.equal(held(world, friend).includes("hasted"), false, "the spell ended");
  world.dice(10, 5);
  const out = await world.invoke("pc_attack", { characterId: friend.id, enemyId: enemy.id, targetEnemyId: enemy.id, weapon: "Longsword" });
  world.clearDice();
  assert.equal(out.ok, false, "the fighter attacked on the turn the lethargy should cost them");
});

// Haste on an enemy: an allied NPC, a charmed creature or a monster hasted by
// its own side's mage. set_enemy_condition places it with its minute; the
// enemy's lethargy is counted on its own order entry.
const foe = (world, enemy) => world.enemies().find((row) => row.id === enemy.id);

async function enemySwing(world, enemy, target) {
  world.dice(10, 4, 4, 4);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  return out;
}

await test("when Haste runs out on an enemy by its duration the enemy loses its next turn to lethargy", async () => {
  const { world, sheets: [friend] } = await party(FIGHTER);
  const [enemy] = await fightDummies(world, 1);
  const hasted = await world.invoke("set_enemy_condition", { enemyId: enemy.id, condition: "hasted", rounds: 10 });
  assert.equal(hasted.ok, true, hasted.error);
  assert.deepEqual(foe(world, enemy).conditions, ["hasted"]);
  for (let round = 0; round < 10; round += 1) {
    nextRound(world);
  }
  assert.deepEqual(foe(world, enemy).conditions, ["incapacitated"], "the spell ran out into lethargy");
  assert.deepEqual(foe(world, enemy).conditionMeta, { incapacitated: { rounds: 1, source: "haste" } });
  const lost = await enemySwing(world, enemy, friend);
  assert.equal(lost.ok, false, "the enemy attacked on the turn the lethargy costs it");
  nextRound(world);
  assert.deepEqual(foe(world, enemy).conditions, [], "the lethargy lasts one turn");
  const acts = await enemySwing(world, enemy, friend);
  assert.equal(acts.ok, true, acts.error);
});

await test("when the concentration holding Haste on an enemy breaks, the enemy loses its next turn to lethargy", async () => {
  const { setEnemyConcentration } = await import("../src/lib/db/encounters.ts");
  const { world, sheets: [friend, mage] } = await party(FIGHTER, wizard(5, { abilities: { int: 16, con: 10 } }));
  const [casterFoe, ally, charmed] = await fightDummies(world, 3, { heroFaces: { [friend.id]: 20, [mage.id]: 18 } });
  // An enemy mage hastes its ally; the party wizard hastes a charmed foe.
  setEnemyConcentration(casterFoe.id, "Haste");
  world.patch(mage.id, { concentratingOn: "Haste" });
  for (const target of [ally, charmed]) {
    const out = await world.invoke("set_enemy_condition", { enemyId: target.id, condition: "hasted", rounds: 10 });
    assert.equal(out.ok, true, out.error);
  }
  // 12 damage is a DC 10 save; the dummy saves at +0 and rolls a 1.
  world.dice(1);
  await world.invoke("damage_enemy", { enemyId: casterFoe.id, amount: 12 });
  world.clearDice();
  assert.equal(foe(world, casterFoe).concentration, null);
  assert.deepEqual(foe(world, ally).conditions, ["incapacitated"]);
  assert.deepEqual(foe(world, ally).conditionMeta, { incapacitated: { rounds: 1, source: "haste" } });
  assert.equal((await enemySwing(world, ally, friend)).ok, false, "the ally attacked through its lethargy");

  world.dice(1);
  await world.invoke("apply_damage", { characterId: mage.id, amount: 6 });
  world.clearDice();
  assert.equal(world.sheet(mage.id).concentratingOn ?? null, null);
  assert.deepEqual(foe(world, charmed).conditions, ["incapacitated"]);
  assert.equal((await enemySwing(world, charmed, friend)).ok, false, "the charmed foe attacked through its lethargy");
  nextRound(world);
  assert.deepEqual([foe(world, ally).conditions, foe(world, charmed).conditions], [[], []]);
  assert.equal((await enemySwing(world, ally, friend)).ok, true, "a round later it acts");
});

// ---- Shield ----

await test("Shield is +5 AC until the start of the caster's next turn", async () => {
  // Order: the fighter, the wizard, the enemy. Raised on the fighter's turn
  // in round 1, it ends as the wizard's own turn starts.
  const { world, sheets: [friend, mage] } = await party(FIGHTER, wizard(5, { acOverride: false }));
  await fightDummies(world, 1, { heroFaces: { [friend.id]: 20, [mage.id]: 10 } });
  const ac = world.sheet(mage.id).ac;
  const raised = await world.invoke("use_reaction", { characterId: mage.id, feature: "Shield" });
  assert.equal(raised.ok, true, raised.error);
  assert.deepEqual(meta(world, mage), { shielded: { untilTurnOf: mage.id } });
  assert.equal(world.sheet(mage.id).ac, ac + 5);
  skipCurrentTurn(world.campaignId);
  assert.equal(world.encounter().order[world.encounter().turnIndex].characterId, mage.id);
  assert.deepEqual(held(world, mage), []);
  assert.equal(world.sheet(mage.id).ac, ac);
  assert.deepEqual(world.encounter().reactionsUsed, [], "and the reaction is back");
  // Raised on their own turn, it stands through the round wrap and the
  // fighter's next turn, until their own comes round again.
  const again = await world.invoke("use_reaction", { characterId: mage.id, feature: "Shield" });
  assert.equal(again.ok, true, again.error);
  nextRound(world);
  assert.equal(world.encounter().order[world.encounter().turnIndex].characterId, friend.id);
  assert.equal(world.sheet(mage.id).ac, ac + 5, "still raised after the round wrapped");
  skipCurrentTurn(world.campaignId);
  assert.equal(world.sheet(mage.id).ac, ac);
});

// ---- Mage Armor ----

await test("Mage Armor makes an unarmored AC 13 + Dexterity, and does nothing over armor", async () => {
  const { world, sheets: [mage, tank] } = await party(
    wizard(5, { acOverride: false }),
    { ...FIGHTER, equipment: [{ name: "Chain Mail", qty: 1, equipped: true }] },
  );
  assert.deepEqual([world.sheet(mage.id).ac, world.sheet(tank.id).ac], [10 + abilityMod(14), 16]);
  for (const target of [mage, tank]) {
    const cast = await world.invoke("cast_buff", { characterId: mage.id, spell: "Mage Armor", level: 1, targetCharacterIds: [target.id] });
    assert.equal(cast.ok, true, cast.error);
  }
  assert.equal(world.sheet(mage.id).ac, 13 + abilityMod(14));
  assert.equal(world.sheet(tank.id).ac, 16, "chain mail is chain mail");
  assert.equal(world.sheet(mage.id).spellcasting.slots["1"].used, 2);
  assert.equal(world.sheet(mage.id).concentratingOn ?? null, null, "Mage Armor takes no concentration");
});

await test("Mage Armor and Shield stack: 13 + Dexterity + 5", async () => {
  const { world, sheets: [mage] } = await party(wizard(5, { acOverride: false }));
  await fightDummies(world, 1);
  await world.invoke("cast_buff", { characterId: mage.id, spell: "Mage Armor", level: 1 });
  await world.invoke("use_reaction", { characterId: mage.id, feature: "Shield" });
  assert.equal(world.sheet(mage.id).ac, 13 + abilityMod(14) + 5);
});

await test("Mage Armor lasts eight hours", async () => {
  const { world, sheets: [mage] } = await party(wizard(5, { acOverride: false }));
  const cast = await world.invoke("cast_buff", { characterId: mage.id, spell: "Mage Armor", level: 1 });
  assert.equal(cast.ok, true, cast.error);
  await world.invoke("pass_time", { amount: 1, unit: "hours" });
  assert.deepEqual(held(world, mage), ["mage armor"], "Mage Armor ended within the hour");
  assert.equal(world.sheet(mage.id).ac, 13 + abilityMod(14));
});

await test("a buff's duration is the spell's, whatever slot it is cast from", async () => {
  const { world, sheets: [priest] } = await party(cleric(5));
  const cast = await world.invoke("cast_buff", { characterId: priest.id, spell: "Bless", level: 3 });
  assert.equal(cast.ok, true, cast.error);
  assert.deepEqual(meta(world, priest), { blessed: { rounds: 10 } });
  assert.deepEqual(world.sheet(priest.id).spellcasting.slots["3"], { max: 2, used: 1 });
  assert.equal(world.sheet(priest.id).spellcasting.slots["1"].used, 0);
});

await test("a buff does not land on the dead", async () => {
  const { world, sheets: [priest, friend] } = await party(cleric(5), FIGHTER);
  world.patch(friend.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  await world.invoke("cast_buff", { characterId: priest.id, spell: "Bless", level: 1, targetCharacterIds: [friend.id] });
  assert.deepEqual(held(world, friend), []);
});

for (const world of worlds) {
  world.clearDice();
}
worlds[0].close();
finish();
