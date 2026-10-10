// The numbers a cast resolves with, read off the engine's own state: whose
// save DC, whose attack bonus, which dice, how much healing.
//
// The rules (SRD 5.1): the save DC is 8 + proficiency + the caster's ability
// modifier and the spell attack bonus is proficiency + the modifier, both
// the CASTER's, whatever the caller supplies; a known spell forces its own
// save, halves or does not on a success, deals its own damage type and
// applies its own condition (docs/rules-coverage.md, "Structured spell
// mechanics ... OVERRIDE the model's args"); a higher slot rolls more dice;
// a spell of 1st level or higher always costs a slot; healing never raises
// hit points above the maximum, does nothing for the dead, and brings a
// dying character back up with the death saves wiped.
//
// Every roll here is forced, so each assertion is about one known number.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import {
  FULL_CASTER_SLOTS,
  cleric,
  fightDummies,
  packAnswers,
  slotsOf,
  warlock,
  wizard, castOnOwnTurn } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-casting-numbers");
const pack = await packAnswers();
const closing = [];

// A fresh table for each rule, so no fight inherits another's wounds. The
// enemies are the kit's dummies: 90 hit points, every save at +0.
async function table(heroes, count = 2) {
  const world = castOnOwnTurn(await openWorld());
  closing.push(world);
  const sheets = heroes.map((hero) => world.addHero(hero));
  const [first, second] = await fightDummies(world, count, { heroFaces: { [sheets[0].id]: 20 } });
  return { world, sheets, first, second };
}

const hpOf = (world, enemy) => world.enemies().find((entry) => entry.id === enemy.id).currentHp;
const sided = (log, sides) => log.filter((die) => die.sides === sides);

// ---- saves ----

if (pack) {
  await test("Fireball: the server's dice, save, DC and type, whatever the caller sent", async () => {
    const { world, sheets: [mage], first, second } = await table([wizard(5)]);
    const before = [hpOf(world, first), hpOf(world, second)];
    // Eight d6 of 4, then the two saves: a 1 fails, a 20 succeeds.
    world.dice(4, 4, 4, 4, 4, 4, 4, 4, 1, 20);
    const out = await world.invoke("aoe_damage", {
      damage: "1d4", type: "cold", saveAbility: "str", dc: 5, halfOnSave: false,
      enemyIds: [first.id, second.id], casterId: mage.id, spell: "Fireball",
    });
    assert.equal(out.ok, true, out.error);
    const log = world.diceLog();
    assert.equal(world.clearDice(), 0);
    assert.equal(sided(log, 6).length, 8, "8d6");
    assert.equal(sided(log, 4).length, 0, "the caller's 1d4 was not rolled");
    assert.equal(out.result.damageRolled, 32);
    assert.equal(out.result.saveAbility, "dex");
    assert.equal(out.result.halfOnSave, true);
    assert.equal(out.result.dc, 8 + proficiencyBonus(5) + abilityMod(16));
    assert.equal(hpOf(world, first), before[0] - 32, "a failed save takes it all");
    assert.equal(hpOf(world, second), before[1] - 16, "a made save takes half");
    assert.deepEqual(world.sheet(mage.id).spellcasting.slots["3"], { max: 2, used: 1 });
  });

  await test("Fireball from a 4th level slot rolls 9d6 and spends that slot", async () => {
    const { world, sheets: [mage], first } = await table([wizard(7)]);
    world.dice(1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
    const out = await world.invoke("aoe_damage", {
      damage: "8d6", saveAbility: "dex", dc: 15, enemyIds: [first.id], casterId: mage.id, spell: "Fireball", level: 4,
    });
    assert.equal(out.ok, true, out.error);
    assert.equal(sided(world.diceLog(), 6).length, 9);
    const slots = world.sheet(mage.id).spellcasting.slots;
    assert.deepEqual([slots["3"].used, slots["4"].used], [0, 1]);
  });

  await test("Sacred Flame: a Dexterity save, and a success takes nothing", async () => {
    const { world, sheets: [priest], first, second } = await table([cleric(5)]);
    const before = [hpOf(world, first), hpOf(world, second)];
    world.dice(20, 8, 8);
    const saved = await world.invoke("cast_at_enemy", {
      characterId: priest.id, targetEnemyId: first.id, spell: "Sacred Flame", saveAbility: "wis", damage: "9d8", halfOnSave: true,
    });
    world.clearDice();
    assert.equal(saved.ok, true, saved.error);
    assert.equal(saved.result.saved, true);
    assert.equal(hpOf(world, first), before[0], "no half damage on a cantrip save");
    world.dice(1, 8, 8);
    const failed = await world.invoke("cast_at_enemy", {
      characterId: priest.id, targetEnemyId: second.id, spell: "Sacred Flame", saveAbility: "wis", damage: "9d8",
    });
    assert.equal(world.clearDice(), 0);
    // 2d8 at 5th level: the caller's 9d8 is ignored.
    assert.equal(hpOf(world, second), before[1] - 16);
    assert.equal(failed.result.damageType, "radiant");
    assert.equal(failed.result.dc, 8 + proficiencyBonus(5) + abilityMod(18));
    assert.deepEqual(world.sheet(priest.id).spellcasting.slots, slotsOf(FULL_CASTER_SLOTS[4]), "a cantrip spends nothing");
  });
}

await test("Hold Person: a Wisdom save against the caster's DC, paralyzed until a save ends it", async () => {
  const { world, sheets: [mage], first, second } = await table([wizard(5)]);
  world.dice(1);
  const held = await world.invoke("cast_at_enemy", {
    characterId: mage.id, targetEnemyId: first.id, spell: "Hold Person", saveAbility: "str", level: 2, condition: "stunned", rounds: 3,
  });
  assert.equal(held.ok, true, held.error);
  const dc = 8 + proficiencyBonus(5) + abilityMod(16);
  assert.equal(held.result.dc, dc);
  assert.equal(held.result.saved, false);
  const target = world.enemies().find((enemy) => enemy.id === first.id);
  assert.deepEqual(target.conditions, ["paralyzed"]);
  // The condition records the spell, its caster and the slot, so the caster's
  // concentration ends this casting and nothing else (spell-effects.ts).
  assert.deepEqual(target.conditionMeta, {
    // A save at the end of each of its turns, and never past the spell's minute.
    paralyzed: { saveEnds: { ability: "wis", dc }, rounds: 10, spell: "Hold Person", source: mage.id, slotLevel: 2 },
  });
  world.dice(20);
  const resisted = await world.invoke("cast_at_enemy", {
    characterId: mage.id, targetEnemyId: second.id, spell: "Hold Person", saveAbility: "wis", level: 2,
  });
  assert.equal(resisted.result.saved, true);
  assert.deepEqual(world.enemies().find((enemy) => enemy.id === second.id).conditions, []);
  assert.equal(world.sheet(mage.id).spellcasting.slots["2"].used, 2, "a resisted spell still costs its slot");
});

// ---- attacks ----

await test("a spell attack rolls d20 + proficiency + the casting modifier, against the target's AC", async () => {
  for (const [level, score] of [[1, 16], [5, 18], [9, 20]]) {
    const { world, sheets: [mage], first } = await table([wizard(level, { abilities: { int: score } })], 1);
    world.dice(10, 5, 5, 5, 5);
    const out = await world.invoke("pc_attack", {
      characterId: mage.id, enemyId: first.id, targetEnemyId: first.id, spell: "Fire Bolt", damage: "1d10",
    });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
    assert.equal(out.result.rolled, 10 + proficiencyBonus(level) + abilityMod(score), `level ${level}, int ${score}`);
    assert.equal(out.result.hit, out.result.rolled >= out.result.vsAc);
  }
});

if (pack) {
  await test("Fire Bolt rolls the dice of the caster's level, not the caller's", async () => {
    for (const [level, dice] of [[4, 1], [5, 2], [11, 3], [17, 4]]) {
      const { world, sheets: [mage], first } = await table([wizard(level)], 1);
      const before = hpOf(world, first);
      world.dice(15, 5, 5, 5, 5);
      const out = await world.invoke("pc_attack", {
        characterId: mage.id, enemyId: first.id, targetEnemyId: first.id, spell: "Fire Bolt", damage: "9d10",
      });
      const log = world.diceLog();
      world.clearDice();
      assert.equal(out.ok, true, out.error);
      assert.equal(sided(log, 10).length, dice, `level ${level}`);
      assert.equal(hpOf(world, first), before - 5 * dice);
    }
  });
}

await test("Guiding Bolt through pc_attack spends a 1st level slot", async () => {
  const { world, sheets: [priest], first } = await table([cleric(5)]);
  world.dice(15, 3, 3, 3, 3);
  const out = await world.invoke("pc_attack", {
    characterId: priest.id, enemyId: first.id, targetEnemyId: first.id, spell: "Guiding Bolt", damage: "4d6",
  });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(priest.id).spellcasting.slots["1"].used, 1, "Guiding Bolt was cast and no slot was spent");
});

await test("Eldritch Blast fires two beams at 5th level from one action", async () => {
  // One turn, the warlock's own: both beams come from the one action.
  const { world, sheets: [hexer], first } = await table([warlock(5)]);
  for (const beam of [1, 2]) {
    world.dice(15, 5);
    const out = await world.invokeAsIs("pc_attack", {
      characterId: hexer.id, enemyId: first.id, targetEnemyId: first.id, spell: "Eldritch Blast", damage: "1d10",
    });
    world.clearDice();
    assert.equal(out.ok, true, `beam ${beam}: ${out.error}`);
  }
});

await test("a 5th level warlock has two beams and no third, and each beam is its own attack roll", async () => {
  const { world, sheets: [hexer], first } = await table([warlock(5)]);
  const rolls = [];
  for (const beam of [1, 2]) {
    world.diceLog();
    world.dice(15, 5);
    const out = await world.invokeAsIs("pc_attack", {
      characterId: hexer.id, enemyId: first.id, targetEnemyId: first.id, spell: "Eldritch Blast", damage: "1d10",
    });
    rolls.push(sided(world.diceLog(), 20).length);
    world.clearDice();
    assert.equal(out.ok, true, `beam ${beam}: ${out.error}`);
  }
  assert.deepEqual(rolls, [1, 1], "one d20 a beam");
  world.dice(15, 5);
  const third = await world.invokeAsIs("pc_attack", {
    characterId: hexer.id, enemyId: first.id, targetEnemyId: first.id, spell: "Eldritch Blast", damage: "1d10",
  });
  world.clearDice();
  assert.equal(third.ok, false, "a third beam at 5th level");
});

// ---- dice the server should own ----

await test("Magic Missile deals three darts of 1d4 + 1 from a 1st level slot, whatever the caller sent", async () => {
  const { world, sheets: [mage], first } = await table([wizard(5)]);
  const before = hpOf(world, first);
  world.dice(4, 4, 4, 4, 4, 4, 4, 4, 4, 4);
  const out = await world.invoke("cast_at_enemy", {
    characterId: mage.id, targetEnemyId: first.id, spell: "Magic Missile", saveAbility: "dex", level: 1, damage: "10d10",
  });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(before - hpOf(world, first), 15, `three darts of 4 + 1 are 15; the target took ${before - hpOf(world, first)}`);
});

if (pack) {
  await test("Harm rolls its own 14d6, not the caller's dice", async () => {
    const { world, sheets: [priest], first } = await table([cleric(11, { spellcasting: { prepared: ["Harm"] } })]);
    world.dice(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
    const out = await world.invoke("cast_at_enemy", {
      characterId: priest.id, targetEnemyId: first.id, spell: "Harm", saveAbility: "con", level: 6, damage: "20d12",
    });
    const log = world.diceLog();
    world.clearDice();
    assert.equal(out.ok, true, out.error);
    assert.equal(sided(log, 12).length, 0, `the caller's 20d12 was rolled (${sided(log, 12).length} d12)`);
    assert.equal(sided(log, 6).length, 14);
  });
}

await test("Sleep rolls no save and leaves a creature with more hit points than the pool awake", async () => {
  const { world, sheets: [mage], first } = await table([wizard(5, { spellcasting: { prepared: ["Sleep"] } })]);
  world.dice(1, 8, 8, 8, 8, 8);
  const out = await world.invoke("cast_at_enemy", {
    characterId: mage.id, targetEnemyId: first.id, spell: "Sleep", saveAbility: "wis", level: 1, condition: "unconscious",
  });
  world.clearDice();
  const target = world.enemies().find((enemy) => enemy.id === first.id);
  assert.ok(target.currentHp > 40, "the dummy has more hit points than 5d8 can roll");
  assert.ok(
    out.ok === false || !target.conditions.includes("unconscious"),
    `a creature at ${target.currentHp} hit points fell asleep`,
  );
});

await test("Sleep puts a creature the pool covers to sleep with no save, and spends the slot", async () => {
  const { world, sheets: [mage], first } = await table([wizard(5, { spellcasting: { prepared: ["Sleep"] } })], 1);
  const { getDatabase } = await import("../src/lib/db/core.ts");
  getDatabase().prepare("UPDATE encounter_enemies SET current_hp = 12 WHERE id = ?").run(first.id);
  world.diceLog();
  world.dice(3, 3, 3, 3, 3);
  const out = await world.invoke("cast_at_enemy", {
    characterId: mage.id, targetEnemyId: first.id, spell: "Sleep", saveAbility: "wis", level: 1,
  });
  const log = world.diceLog();
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(sided(log, 20).length, 0, "no saving throw");
  assert.equal(sided(log, 8).length, 5, "5d8 of hit points");
  assert.ok(world.enemies()[0].conditions.includes("unconscious"));
  assert.equal(world.sheet(mage.id).spellcasting.slots["1"].used, 1);
});

await test("Bless from a 1st level slot blesses three at most", async () => {
  const world = castOnOwnTurn(await openWorld());
  closing.push(world);
  const priest = world.addHero(cleric(5));
  const friends = [1, 2, 3].map(() => world.addHero({ class: "fighter", level: 5 }));
  const out = await world.invoke("cast_buff", {
    characterId: priest.id, spell: "Bless", level: 1, targetCharacterIds: [priest.id, ...friends.map((friend) => friend.id)],
  });
  const blessed = world.sheets().filter((sheet) => sheet.conditions.includes("blessed")).length;
  assert.ok(out.ok === false || blessed <= 3, `${blessed} creatures were blessed from a 1st level slot`);
});

await test("Bless from a 2nd level slot blesses four", async () => {
  const world = castOnOwnTurn(await openWorld());
  closing.push(world);
  const priest = world.addHero(cleric(5));
  const friends = [1, 2, 3].map(() => world.addHero({ class: "fighter", level: 5 }));
  const out = await world.invoke("cast_buff", {
    characterId: priest.id, spell: "Bless", level: 2, targetCharacterIds: [priest.id, ...friends.map((friend) => friend.id)],
  });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheets().filter((sheet) => sheet.conditions.includes("blessed")).length, 4);
  assert.equal(world.sheet(priest.id).spellcasting.slots["2"].used, 1);
});

// ---- healing ----

const healer = castOnOwnTurn(await openWorld());
closing.push(healer);
const priest = healer.addHero(cleric(5));
const hurt = healer.addHero({ class: "fighter", level: 5, maxHp: 40 });
const hpNow = (hero) => healer.sheet(hero.id).currentHp;

await test("healing never raises hit points above the maximum", async () => {
  healer.patch(hurt.id, { currentHp: 35 });
  const out = await healer.invoke("heal", { characterId: hurt.id, amount: 100 });
  assert.equal(out.ok, true, out.error);
  assert.equal(hpNow(hurt), 40);
  const again = await healer.invoke("heal", { characterId: hurt.id, amount: 1 });
  assert.equal(again.ok, true, again.error);
  assert.equal(hpNow(hurt), 40);
});

await test("healing needs an amount above zero", async () => {
  healer.patch(hurt.id, { currentHp: 10 });
  for (const amount of [0, -5]) {
    const out = await healer.invoke("heal", { characterId: hurt.id, amount });
    assert.equal(out.ok, false, `heal ${amount}`);
    assert.equal(hpNow(hurt), 10);
  }
});

await test("healing a dying character brings them up and wipes the death saves", async () => {
  healer.patch(hurt.id, { currentHp: 10 });
  const dropped = await healer.invoke("apply_damage", { characterId: hurt.id, amount: 10 });
  assert.equal(dropped.ok, true, dropped.error);
  assert.equal(hpNow(hurt), 0);
  assert.ok(healer.sheet(hurt.id).deathSaves, "the dying track opened");
  healer.patch(hurt.id, { deathSaves: { successes: 1, failures: 2, stable: false, dead: false } });
  const out = await healer.invoke("heal", { characterId: hurt.id, amount: 6 });
  assert.equal(out.ok, true, out.error);
  const sheet = healer.sheet(hurt.id);
  assert.equal(sheet.currentHp, 6);
  assert.ok(
    !sheet.deathSaves || (sheet.deathSaves.successes === 0 && sheet.deathSaves.failures === 0 && !sheet.deathSaves.dead),
    `death saves after healing: ${JSON.stringify(sheet.deathSaves)}`,
  );
  assert.equal(sheet.conditions.includes("unconscious"), false, "they are conscious again");
});

await test("healing does nothing for the dead", async () => {
  healer.patch(hurt.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  for (const args of [{ amount: 20 }, { spell: "Cure Wounds", casterId: priest.id, level: 1 }, { amount: 5, temp: true }]) {
    healer.dice(8);
    const out = await healer.invoke("heal", { characterId: hurt.id, ...args });
    healer.clearDice();
    assert.equal(out.ok, false, JSON.stringify(args));
  }
  const sheet = healer.sheet(hurt.id);
  assert.equal(sheet.currentHp, 0);
  assert.equal(sheet.tempHp, 0);
  assert.equal(sheet.deathSaves.dead, true);
  healer.patch(hurt.id, { currentHp: 10, deathSaves: null });
});

if (pack) {
  await test("Cure Wounds heals 1d8 + the caster's modifier, and 1d8 more per slot level", async () => {
    const mod = abilityMod(18);
    for (const [level, dice] of [[1, 1], [2, 2], [3, 3]]) {
      healer.patch(hurt.id, { currentHp: 1 });
      healer.diceLog();
      healer.dice(5, 5, 5);
      const out = await healer.invoke("heal", { characterId: hurt.id, spell: "Cure Wounds", casterId: priest.id, level, amount: 99 });
      const log = healer.diceLog();
      healer.clearDice();
      assert.equal(out.ok, true, out.error);
      assert.equal(sided(log, 8).length, dice, `level ${level}`);
      assert.equal(hpNow(hurt), 1 + 5 * dice + mod, "the caller's 99 is ignored");
    }
  });

  await test("Healing Word heals 1d4 + the caster's modifier", async () => {
    healer.patch(hurt.id, { currentHp: 1 });
    healer.dice(3);
    const out = await healer.invoke("heal", { characterId: hurt.id, spell: "Healing Word", casterId: priest.id, level: 1 });
    assert.equal(healer.clearDice(), 0);
    assert.equal(out.ok, true, out.error);
    assert.equal(hpNow(hurt), 1 + 3 + abilityMod(18));
  });

  await test("a healing spell through heal must be held and spends its slot", async () => {
    healer.patch(hurt.id, { currentHp: 1 });
    const before = JSON.stringify(healer.sheet(priest.id).spellcasting.slots);
    healer.dice(8, 8, 8, 8, 8, 8, 8, 8, 8);
    const selfTaught = await healer.invoke("heal", { characterId: hurt.id, spell: "Cure Wounds", casterId: hurt.id, level: 9 });
    healer.clearDice();
    assert.equal(selfTaught.ok, false, `a fighter healed ${selfTaught.result?.healed} with a 9th level Cure Wounds`);
    healer.dice(8);
    const paid = await healer.invoke("heal", { characterId: hurt.id, spell: "Cure Wounds", casterId: priest.id, level: 1 });
    healer.clearDice();
    assert.equal(paid.ok, true);
    assert.notEqual(JSON.stringify(healer.sheet(priest.id).spellcasting.slots), before, "no slot was spent");
  });
}

for (const world of closing) {
  world.clearDice();
}
closing[0]?.close();
finish();
