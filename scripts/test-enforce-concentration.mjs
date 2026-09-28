// Concentration (SRD 5.1, "Spellcasting: Concentration"), as the server
// tracks it in src/lib/dm/concentration.ts.
//
// The rules: a caster concentrates on one spell at a time, so casting a
// second concentration spell ends the first and everything it was holding in
// place; taking damage forces a Constitution save against DC 10 or half the
// damage taken, whichever is higher, with the caster's real save bonus
// (proficiency included) and one save per source of damage; a failed save,
// dropping to 0 hit points, dying, or being incapacitated ends the spell at
// once, on every creature it touched; a spell without concentration does not
// disturb one that has it; and when the duration runs out the concentration
// is over too. Enemy casters concentrate by the same rules
// (docs/rules-coverage.md, "Enemy concentration ... best effort").
//
// Every save here is a forced die, placed one below and exactly on the DC.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { cleric, fightDummies, packAnswers, sorcerer, wizard, castOnOwnTurn } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-concentration");
await packAnswers();
const worlds = [];

async function party(...heroes) {
  const world = castOnOwnTurn(await openWorld());
  worlds.push(world);
  return { world, sheets: heroes.map((hero) => world.addHero({ maxHp: 100, ...hero })) };
}

// Concentration on `spell`, set the way a cast sets it. The flag is the
// tool's own (use_spell_slot, "homebrew concentration flag"), so the suite
// stands without the content pack.
async function concentrate(world, hero, spell, level = 1) {
  const out = await world.invoke("use_spell_slot", { characterId: hero.id, level, spell, concentration: true });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(hero.id).concentratingOn, spell);
}

async function hit(world, hero, amount, face, extra = {}) {
  world.diceLog();
  world.dice(face);
  const out = await world.invoke("apply_damage", { characterId: hero.id, amount, ...extra });
  const rolled = world.diceLog().filter((die) => die.sides === 20);
  assert.equal(world.clearDice(), 0, "the save took the forced die");
  assert.equal(out.ok, true, out.error);
  return { out, rolled, concentration: out.result.concentration };
}

// ---- setting it ----

// With or without the content pack: the checklist carries the flag.
await test("casting a concentration spell starts the caster concentrating", async () => {
  const { world, sheets: [priest] } = await party(cleric(5));
  const out = await world.invoke("cast_buff", { characterId: priest.id, spell: "Bless" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(priest.id).concentratingOn, "Bless", "nothing is tracked after Bless");
});

await test("a spell without concentration starts none and disturbs none", async () => {
  const { world, sheets: [mage] } = await party(wizard(5));
  await world.invoke("use_spell_slot", { characterId: mage.id, level: 1, spell: "Magic Missile" });
  assert.equal(world.sheet(mage.id).concentratingOn, null);
  await concentrate(world, mage, "Blur", 2);
  for (const [spell, level] of [["Shield", 1], ["Burning Hands", 1], ["Fire Bolt", 0]]) {
    await world.invoke("use_spell_slot", { characterId: mage.id, level, spell });
    assert.equal(world.sheet(mage.id).concentratingOn, "Blur", spell);
  }
  const armor = await world.invoke("cast_buff", { characterId: mage.id, spell: "Mage Armor" });
  assert.equal(armor.ok, true, armor.error);
  assert.equal(world.sheet(mage.id).concentratingOn, "Blur");
});

await test("concentration is stored on the sheet and outlives the fight", async () => {
  const { world, sheets: [mage] } = await party(wizard(5));
  await fightDummies(world, 1);
  await concentrate(world, mage, "Blur", 2);
  assert.equal(world.sheets().find((sheet) => sheet.id === mage.id).concentratingOn, "Blur");
  await world.invoke("end_encounter", { outcome: "truce" });
  assert.equal(world.encounter(), null);
  assert.equal(world.sheet(mage.id).concentratingOn, "Blur");
});

await test("a second concentration spell replaces the first on the sheet", async () => {
  const { world, sheets: [mage] } = await party(wizard(5));
  await concentrate(world, mage, "Blur", 2);
  const out = await world.invoke("use_spell_slot", { characterId: mage.id, level: 3, spell: "Haste", concentration: true });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(mage.id).concentratingOn, "Haste");
});

await test("a second concentration spell ends the first and its effects on every creature", async () => {
  const { world, sheets: [priest, friend] } = await party(cleric(5), { class: "fighter", level: 5 });
  const blessed = await world.invoke("cast_buff", { characterId: priest.id, spell: "Bless", targetCharacterIds: [priest.id, friend.id] });
  assert.equal(blessed.ok, true, blessed.error);
  assert.ok(world.sheet(friend.id).conditions.includes("blessed"));
  const next = await world.invoke("use_spell_slot", { characterId: priest.id, level: 2, spell: "Hold Person", concentration: true });
  assert.equal(next.ok, true, next.error);
  const still = world.sheets().filter((sheet) => sheet.conditions.includes("blessed")).map((sheet) => sheet.name);
  assert.deepEqual(still, [], `still blessed after the cleric moved on to Hold Person: ${still.join(", ")}`);
});

// ---- damage ----

await test("damage forces a Constitution save against 10 or half the damage, whichever is higher", async () => {
  // Constitution 10 and no proficiency: the die is the total.
  const { world, sheets: [mage] } = await party(wizard(5, { abilities: { int: 16, con: 10 } }));
  for (const [damage, dc] of [[1, 10], [19, 10], [20, 10], [21, 10], [22, 11], [23, 11], [40, 20]]) {
    for (const [face, held] of [[dc - 1, false], [dc, true]]) {
      world.patch(mage.id, { currentHp: 100 });
      await concentrate(world, mage, "Blur", 2);
      const { concentration, rolled } = await hit(world, mage, damage, face);
      assert.equal(rolled.length, 1, "one save for one source of damage");
      assert.deepEqual(concentration, { spell: "Blur", dc, rolled: face, held }, `${damage} damage, a ${face} on the die`);
      assert.equal(world.sheet(mage.id).concentratingOn, held ? "Blur" : null);
      world.patch(mage.id, { spellcasting: { ...world.sheet(mage.id).spellcasting, slots: { 2: { max: 3, used: 0 } } } });
    }
  }
});

await test("the save is the caster's real Constitution save: modifier and proficiency", async () => {
  for (const [hero, bonus] of [
    [wizard(5, { abilities: { int: 16, con: 14 } }), abilityMod(14)],
    [sorcerer(5, { abilities: { cha: 16, con: 14 } }), abilityMod(14) + proficiencyBonus(5)],
    [sorcerer(17, { abilities: { cha: 16, con: 8 } }), abilityMod(8) + proficiencyBonus(17)],
  ]) {
    const { world, sheets: [caster] } = await party(hero);
    await concentrate(world, caster, "Blur", 2);
    const low = await hit(world, caster, 5, 9 - bonus);
    assert.deepEqual(low.concentration, { spell: "Blur", dc: 10, rolled: 9, held: false }, `${hero.class} ${hero.level}`);
    await concentrate(world, caster, "Blur", 2);
    const high = await hit(world, caster, 5, 10 - bonus);
    assert.equal(high.concentration.held, true);
  }
});

await test("each source of damage is its own save, and no damage is no save", async () => {
  const { world, sheets: [mage] } = await party(wizard(5, { abilities: { int: 16, con: 10 } }));
  await concentrate(world, mage, "Blur", 2);
  for (const face of [10, 15, 20]) {
    const { rolled, concentration } = await hit(world, mage, 3, face);
    assert.equal(rolled.length, 1);
    assert.equal(concentration.held, true);
  }
  world.diceLog();
  const healed = await world.invoke("heal", { characterId: mage.id, amount: 5 });
  assert.equal(healed.ok, true);
  assert.equal(world.diceLog().length, 0);
  assert.equal(world.sheet(mage.id).concentratingOn, "Blur");
  // Nobody concentrating, nobody saving.
  await world.invoke("clear_condition", { characterId: mage.id, condition: "concentration" });
  world.diceLog();
  await world.invoke("apply_damage", { characterId: mage.id, amount: 30 });
  assert.equal(world.diceLog().filter((die) => die.sides === 20).length, 0);
});

await test("the DC comes from the damage taken: resistance halves it first, temporary hit points do not hide it", async () => {
  const { world, sheets: [mage] } = await party(wizard(5, { race: "tiefling", abilities: { int: 16, con: 10 } }));
  await concentrate(world, mage, "Blur", 2);
  // 44 fire against a tiefling's resistance is 22 taken: DC 11, not 22.
  const burned = await hit(world, mage, 44, 11, { type: "fire" });
  assert.equal(world.sheet(mage.id).currentHp, 100 - 22, "the fixture's tiefling resists fire");
  assert.deepEqual(burned.concentration, { spell: "Blur", dc: 11, rolled: 11, held: true });
  world.patch(mage.id, { tempHp: 30 });
  const soaked = await hit(world, mage, 24, 11);
  assert.equal(world.sheet(mage.id).currentHp, 100 - 22, "the temporary hit points took it");
  assert.deepEqual(soaked.concentration, { spell: "Blur", dc: 12, rolled: 11, held: false });
});

await test("a failed save ends the spell on every creature it touched, friend and foe", async () => {
  const { world, sheets: [priest, friend, other] } = await party(cleric(5, { abilities: { wis: 18, con: 10 } }), { class: "fighter", level: 5 }, { class: "rogue", level: 5 });
  const [enemy] = await fightDummies(world, 1);
  const blessed = await world.invoke("cast_buff", { characterId: priest.id, spell: "Bless", targetCharacterIds: [priest.id, friend.id, other.id] });
  assert.equal(blessed.ok, true, blessed.error);
  world.patch(priest.id, { concentratingOn: "Bless" });
  assert.equal(world.sheets().filter((sheet) => sheet.conditions.includes("blessed")).length, 3);
  // Bless rides the save (gap conc-save-ignores-bless), so the die is forced low enough either way.
  world.dice(1, 1);
  await world.invoke("apply_damage", { characterId: priest.id, amount: 8 });
  world.clearDice();
  assert.equal(world.sheet(priest.id).concentratingOn, null);
  assert.equal(world.sheets().filter((sheet) => sheet.conditions.includes("blessed")).length, 0);

  world.dice(1);
  const held = await world.invoke("cast_at_enemy", { characterId: priest.id, targetEnemyId: enemy.id, spell: "Hold Person", saveAbility: "wis", level: 2 });
  world.clearDice();
  assert.equal(held.ok, true, held.error);
  world.patch(priest.id, { concentratingOn: "Hold Person" });
  assert.deepEqual(world.enemies()[0].conditions, ["paralyzed"]);
  await hit(world, priest, 8, 2);
  assert.deepEqual(world.enemies()[0].conditions, [], "the ogre is free the moment the save fails");
});

await test("dropping to 0 hit points ends concentration with no save", async () => {
  const { world, sheets: [mage, friend] } = await party(wizard(5), { class: "fighter", level: 5 });
  const hasted = await world.invoke("cast_buff", { characterId: mage.id, spell: "Haste", targetCharacterIds: [friend.id] });
  assert.equal(hasted.ok, true, hasted.error);
  world.patch(mage.id, { concentratingOn: "Haste", currentHp: 5 });
  world.diceLog();
  const out = await world.invoke("apply_damage", { characterId: mage.id, amount: 5 });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.diceLog().filter((die) => die.sides === 20).length, 0, "no save is rolled for a caster who dropped");
  assert.equal(out.result.concentrationBroken, "Haste");
  assert.equal(world.sheet(mage.id).concentratingOn, null);
  assert.equal(world.sheet(friend.id).conditions.includes("hasted"), false);
});

await test("a caster ending concentration by choice ends the effects too", async () => {
  const { world, sheets: [mage] } = await party(wizard(5));
  const blurred = await world.invoke("cast_buff", { characterId: mage.id, spell: "Blur" });
  assert.equal(blurred.ok, true, blurred.error);
  world.patch(mage.id, { concentratingOn: "Blur" });
  const ended = await world.invoke("clear_condition", { characterId: mage.id, condition: "concentration" });
  assert.equal(ended.ok, true, ended.error);
  assert.equal(world.sheet(mage.id).concentratingOn, null);
  assert.deepEqual(world.sheet(mage.id).conditions, []);
  assert.equal((await world.invoke("clear_condition", { characterId: mage.id, condition: "concentration" })).ok, false);
});

// ---- what else ends it, and what should and does not ----

await test("being incapacitated ends concentration at once, whatever the condition", async () => {
  const { world, sheets: [mage] } = await party(wizard(5));
  const kept = [];
  for (const condition of ["stunned", "paralyzed", "unconscious", "incapacitated", "petrified"]) {
    world.patch(mage.id, { conditions: [], conditionMeta: {}, concentratingOn: "Blur" });
    await world.invoke("set_condition", { characterId: mage.id, condition, rounds: 2 });
    if (world.sheet(mage.id).concentratingOn !== null) {
      kept.push(condition);
    }
  }
  assert.deepEqual(kept, [], `still concentrating while ${kept.join(", ")}`);
});

await test(
  "entering a rage ends any spell the barbarian was concentrating on",
  async () => {
    const { world, sheets: [brute] } = await party({
      class: "barbarian", level: 5, abilities: { str: 16, wis: 14 },
      spellcasting: { ability: "wis", slots: { 1: { max: 2, used: 0 } }, known: ["Hunter's Mark"], prepared: [], cantrips: [] },
    });
    await fightDummies(world, 1);
    await concentrate(world, brute, "Hunter's Mark", 1);
    const raged = await world.invoke("use_resource", { characterId: brute.id, resource: "Rage" });
    assert.equal(raged.ok, true, raged.error);
    assert.ok(world.sheet(brute.id).conditions.includes("raging"));
    assert.equal(world.sheet(brute.id).concentratingOn, null, "raging and still concentrating on Hunter's Mark");
  },
);

await test("when the spell's duration runs out the caster stops concentrating", async () => {
  const { world, sheets: [priest] } = await party(cleric(5));
  const out = await world.invoke("cast_buff", { characterId: priest.id, spell: "Bless" });
  assert.equal(out.ok, true, out.error);
  world.patch(priest.id, { concentratingOn: "Bless" });
  await world.invoke("pass_time", { amount: 5, unit: "minutes" });
  assert.deepEqual(world.sheet(priest.id).conditions, [], "Bless has run out");
  assert.equal(world.sheet(priest.id).concentratingOn, null, "still concentrating on a spell that ended");
});

await test("War Caster rolls the concentration save with advantage", async () => {
  const { world, sheets: [mage] } = await party(wizard(5, { abilities: { int: 16, con: 10 }, feats: ["War Caster"] }));
  await concentrate(world, mage, "Blur", 2);
  world.diceLog();
  world.dice(3, 17);
  const out = await world.invoke("apply_damage", { characterId: mage.id, amount: 6 });
  const rolled = world.diceLog().filter((die) => die.sides === 20).length;
  world.clearDice();
  assert.equal(rolled, 2, `${rolled} d20 rolled for a War Caster's concentration save`);
  assert.equal(out.result.concentration.held, true);
});

await test("Bless adds its d4 to a concentration save", async () => {
  const { world, sheets: [priest] } = await party(cleric(5, { abilities: { wis: 18, con: 10 } }));
  await world.invoke("cast_buff", { characterId: priest.id, spell: "Bless" });
  world.patch(priest.id, { concentratingOn: "Bless" });
  world.diceLog();
  world.dice(7, 4);
  const out = await world.invoke("apply_damage", { characterId: priest.id, amount: 6 });
  const log = world.diceLog();
  world.clearDice();
  assert.equal(log.filter((die) => die.sides === 4).length, 1, "no d4 was rolled with the save");
  assert.equal(out.result.concentration.held, true);
});

await test(
  "a druid who transforms keeps concentrating, and damage taken in beast form forces the save like any other damage",
  async () => {
    const { world, sheets: [druid] } = await party({
      class: "druid", level: 5, abilities: { wis: 16, con: 10 },
      spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 } }, known: [], prepared: ["Faerie Fire"], cantrips: [] },
    });
    await concentrate(world, druid, "Faerie Fire", 1);
    world.patch(druid.id, { wildShape: { form: "Brown Bear", beastHp: 34, beastMaxHp: 34, beastAc: 11 } });
    world.diceLog();
    world.dice(1);
    await world.invoke("apply_damage", { characterId: druid.id, amount: 10 });
    const rolled = world.diceLog().filter((die) => die.sides === 20).length;
    world.clearDice();
    assert.equal(rolled, 1, "no concentration save was rolled for damage taken as a bear");
    assert.equal(world.sheet(druid.id).concentratingOn, null);
  },
);

await test("a blow that breaks a beast form sets the concentration DC by the whole blow, not the excess", async () => {
  const { world, sheets: [druid] } = await party({
    class: "druid", level: 5, abilities: { wis: 16, con: 10 },
    spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 } }, known: [], prepared: ["Faerie Fire"], cantrips: [] },
  });
  await concentrate(world, druid, "Faerie Fire", 1);
  world.patch(druid.id, { wildShape: { form: "Brown Bear", beastHp: 25, beastMaxHp: 34, beastAc: 11 } });
  // 30 damage: 25 to the bear, 5 carried over. DC 15, not the 10 the excess alone would set.
  world.dice(12);
  const out = await world.invoke("apply_damage", { characterId: druid.id, amount: 30 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.concentration.dc, 15);
  assert.equal(world.sheet(druid.id).concentratingOn, null);
});

// ---- enemies ----

// With or without the content pack: the bundled checklist carries the
// concentration flag (src/lib/srd/spell-facts.ts).
await test("an enemy caster concentrates, saves on damage, and loses the spell on a failure or death", async () => {
  const { world, sheets: [mage, friend] } = await party(wizard(5, { abilities: { int: 16, wis: 10 } }), { class: "fighter", level: 5 });
  const [hag, second] = await fightDummies(world, 2);
  const cast = async (enemy, target) => {
    world.dice(1);
    const out = await world.invoke("cast_at_player", {
      characterId: target.id, characterIds: [target.id], spell: "Hold Person", saveAbility: "wis", dc: 15,
      condition: "paralyzed", casterEnemyId: enemy.id,
    });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
    assert.deepEqual(world.sheet(target.id).conditions, ["paralyzed"]);
  };
  const enemy = (entry) => world.enemies().find((row) => row.id === entry.id);

  await cast(hag, mage);
  assert.equal(enemy(hag).concentration, "Hold Person", "the enemy's concentration was not tracked");
  // 12 damage: DC 10. The dummy saves at +0, so a 10 holds and a 9 does not.
  world.dice(10);
  await world.invoke("damage_enemy", { enemyId: hag.id, amount: 12 });
  assert.equal(world.clearDice(), 0, "the enemy rolled its save");
  assert.equal(enemy(hag).concentration, "Hold Person");
  assert.deepEqual(world.sheet(mage.id).conditions, ["paralyzed"]);
  world.dice(9);
  await world.invoke("damage_enemy", { enemyId: hag.id, amount: 12 });
  world.clearDice();
  assert.equal(enemy(hag).concentration, null);
  assert.deepEqual(world.sheet(mage.id).conditions, []);

  await cast(second, friend);
  await world.invoke("damage_enemy", { enemyId: second.id, amount: 200 });
  assert.notEqual(enemy(second).status, "alive");
  assert.deepEqual(world.sheet(friend.id).conditions, [], "the spell dies with its caster");
});

for (const world of worlds) {
  world.clearDice();
}
worlds[0].close();
finish();
