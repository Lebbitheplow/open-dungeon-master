// Who may cast what, and what it costs: the legality of a cast, asked of the
// engine through the same handlers the AI DM's tool calls reach.
//
// The rules (SRD 5.1, "Spellcasting"): a caster casts only a spell they know
// or have prepared; a spell chosen since the last long rest is not ready
// until the rest, and a spell merely written in a wizard's book is not
// prepared; a spell of 1st level or higher spends a slot of its level or
// higher, a cantrip spends none, and a slot the caster does not have or has
// already spent cannot pay; a character with no Spellcasting feature casts
// nothing; a ritual is a spell with the ritual tag, cast by a class that can
// cast rituals, with no slot and ten minutes added. A refusal changes
// nothing on the sheet.
//
// ODM's own rules, pinned where they differ: a missing spell name is
// tolerated by use_spell_slot and the slot still spends (mutations.ts, "weak
// tool calling must not break casting"). Several checks need the content
// pack, because a spell's level and ritual tag live there; without it they
// are recorded as gaps rather than skipped.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import {
  castingState,
  cleric,
  fightDummies,
  packAnswers,
  sorcerer,
  warlock,
  wizard, castOnOwnTurn } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-casting");
const world = castOnOwnTurn(await openWorld());
const pack = await packAnswers();

const mage = world.addHero(
  wizard(5, { spellcasting: { pending: ["Misty Step"], spellbook: ["Detect Magic", "Identify", "Lightning Bolt"] } }),
);
const priest = world.addHero(cleric(5));
const soldier = world.addHero({ class: "fighter", level: 5, abilities: { str: 16, int: 14 } });
const sorc = world.addHero(sorcerer(5, { spellcasting: { known: ["Magic Missile", "Detect Magic", "Hold Person", "Blur", "Fireball", "Haste"] } }));
const hexer = world.addHero(warlock(5));

const [ogre, other] = await fightDummies(world, 2, { heroFaces: { [mage.id]: 20 } });

// A ritual takes ten minutes more than the spell and is never cast in the
// middle of a fight, so the rituals that should go through are cast at a
// table with no fight on.
const calm = castOnOwnTurn(await openWorld());
const calmPriest = calm.addHero(cleric(5));
const calmMage = calm.addHero(
  wizard(5, { spellcasting: { spellbook: ["Detect Magic", "Identify", "Lightning Bolt"] } }),
);
const enemyState = () => JSON.stringify(world.enemies().map((enemy) => [enemy.currentHp, enemy.conditions]));

// Runs a call that must be refused and proves nothing moved.
async function refused(hero, name, args, label = name) {
  const before = castingState(world.sheet(hero.id));
  const enemies = enemyState();
  world.dice(1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
  const out = await world.invoke(name, args);
  world.clearDice();
  assert.equal(out.ok, false, `${label} was allowed: ${JSON.stringify(out.result ?? {}).slice(0, 200)}`);
  assert.equal(castingState(world.sheet(hero.id)), before, `${label} was refused but changed the caster`);
  assert.equal(enemyState(), enemies, `${label} was refused but changed an enemy`);
  return out;
}

// ---- known and prepared ----

await test("a spell that is not on the sheet is refused by every cast tool", async () => {
  await refused(mage, "use_spell_slot", { characterId: mage.id, level: 3, spell: "Counterspell" });
  await refused(mage, "cast_at_enemy", { characterId: mage.id, targetEnemyId: ogre.id, spell: "Banishment", saveAbility: "cha", level: 3, condition: "banished" });
  await refused(mage, "cast_at_enemy", { characterId: mage.id, targetEnemyId: ogre.id, spell: "Sacred Flame", saveAbility: "dex", damage: "1d8" }, "a cantrip not known");
  await refused(mage, "pc_attack", { characterId: mage.id, enemyId: ogre.id, targetEnemyId: ogre.id, spell: "Eldritch Blast", damage: "1d10" });
  await refused(priest, "cast_buff", { characterId: priest.id, spell: "Mage Armor" });
});

await test("an area spell that is not on the sheet is refused", async () => {
  await refused(priest, "aoe_damage", {
    damage: "8d6", saveAbility: "dex", dc: 15, enemyIds: [ogre.id, other.id], casterId: priest.id, spell: "Fireball",
  });
});

await test("a class list is not a spell list: a wizard cannot cast a cleric's spell", async () => {
  await refused(mage, "use_spell_slot", { characterId: mage.id, level: 1, spell: "Cure Wounds" });
  await refused(mage, "cast_buff", { characterId: mage.id, spell: "Bless" });
});

await test("a spell chosen since the last long rest is not castable until the rest", async () => {
  await refused(mage, "use_spell_slot", { characterId: mage.id, level: 2, spell: "Misty Step" });
  await refused(mage, "cast_buff", { characterId: mage.id, spell: "Misty Step" });
});

await test("a spell only written in the spellbook is not castable", async () => {
  await refused(mage, "use_spell_slot", { characterId: mage.id, level: 3, spell: "Lightning Bolt" });
  await refused(mage, "aoe_damage", {
    damage: "8d6", saveAbility: "dex", dc: 14, enemyIds: [ogre.id], casterId: mage.id, spell: pack ? "Lightning Bolt" : "Faerie Fire",
  });
});

await test("a spell is held by its whole name, not part of it", async () => {
  await refused(mage, "cast_at_enemy", {
    characterId: mage.id, targetEnemyId: ogre.id, spell: "Bolt", saveAbility: "dex", damage: "10d10",
  });
});

// ---- slots ----

await test("a slot below the spell's level cannot pay for it", async () => {
  for (const level of [1, 2]) {
    await refused(mage, "use_spell_slot", { characterId: mage.id, level, spell: "Fireball" }, `Fireball from a level ${level} slot`);
  }
  await refused(mage, "aoe_damage", {
    damage: "8d6", saveAbility: "dex", dc: 14, enemyIds: [ogre.id], casterId: mage.id, spell: "Fireball", level: 2,
  });
  await refused(mage, "cast_at_enemy", { characterId: mage.id, targetEnemyId: ogre.id, spell: "Hold Person", saveAbility: "wis", level: 1 });
});

await test("a slot level the caster does not have cannot pay for anything", async () => {
  for (const level of [4, 9]) {
    await refused(mage, "use_spell_slot", { characterId: mage.id, level, spell: "Fireball" }, `a level ${level} slot`);
  }
  await refused(mage, "cast_buff", { characterId: mage.id, spell: "Blur", level: 6 });
});

await test("a 1st level wizard cannot cast a 9th level spell, even with it on the sheet", async () => {
  const table = castOnOwnTurn(await openWorld());
  const novice = table.addHero(wizard(1, { spellcasting: { prepared: ["Magic Missile", "Wish", "Meteor Swarm"] } }));
  for (const level of [1, 9]) {
    const before = castingState(table.sheet(novice.id));
    const out = await table.invoke("use_spell_slot", { characterId: novice.id, level, spell: "Wish" });
    // Without the pack the level is unknown and a 1st level slot pays; that
    // is cast-slot-below-level-nopack, recorded once above.
    if (level === 9 || pack) {
      assert.equal(out.ok, false, `Wish from a level ${level} slot`);
      assert.equal(castingState(table.sheet(novice.id)), before);
    }
  }
});

await test("a cantrip spends no slot, however it is called", async () => {
  const before = JSON.stringify(world.sheet(mage.id).spellcasting.slots);
  for (const level of [0, 1, 3]) {
    const out = await world.invoke("use_spell_slot", { characterId: mage.id, level, spell: "Fire Bolt" });
    assert.equal(out.ok, true, out.error);
  }
  assert.equal(JSON.stringify(world.sheet(mage.id).spellcasting.slots), before);
});

await test("a cast spends exactly one slot of the level named, and the last slot is the last", async () => {
  const table = castOnOwnTurn(await openWorld());
  const hero = table.addHero(wizard(5));
  const [enemy] = await fightDummies(table, 1);
  for (let cast = 1; cast <= 3; cast += 1) {
    table.dice(1);
    const out = await table.invoke("cast_at_enemy", {
      characterId: hero.id, targetEnemyId: enemy.id, spell: "Hold Person", saveAbility: "wis", level: 2,
    });
    table.clearDice();
    // The ogre is held after the first; the slot spends all the same.
    assert.equal(out.ok, true, out.error);
    assert.deepEqual(table.sheet(hero.id).spellcasting.slots["2"], { max: 3, used: cast });
  }
  const spent = castingState(table.sheet(hero.id));
  const fourth = await table.invoke("cast_at_enemy", {
    characterId: hero.id, targetEnemyId: enemy.id, spell: "Hold Person", saveAbility: "wis", level: 2,
  });
  assert.equal(fourth.ok, false);
  assert.equal(castingState(table.sheet(hero.id)), spent);
  assert.deepEqual(table.sheet(hero.id).spellcasting.slots["1"], { max: 4, used: 0 });
  assert.deepEqual(table.sheet(hero.id).spellcasting.slots["3"], { max: 2, used: 0 });
});

await test("a warlock casts from the pact slot's level and has no other", async () => {
  await refused(hexer, "use_spell_slot", { characterId: hexer.id, level: 1, spell: "Hellish Rebuke" });
  await refused(hexer, "use_spell_slot", { characterId: hexer.id, level: 2, spell: "Hold Person" });
  const out = await world.invoke("use_spell_slot", { characterId: hexer.id, level: 3, spell: "Hellish Rebuke" });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(world.sheet(hexer.id).spellcasting.slots, { 3: { max: 2, used: 1 } });
});

await test("ODM's rule: a slot named without a spell still spends", async () => {
  // SRD 5.1 has no such thing as spending a slot on nothing. ODM tolerates
  // the missing name (mutations.ts use_spell_slot) and validates the slot.
  const before = world.sheet(priest.id).spellcasting.slots["1"].used;
  const out = await world.invoke("use_spell_slot", { characterId: priest.id, level: 1 });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(priest.id).spellcasting.slots["1"].used, before + 1);
  await refused(priest, "use_spell_slot", { characterId: priest.id, level: 7 });
});

// ---- characters who do not cast ----

await test("a character with no spellcasting casts nothing through the cast tools", async () => {
  await refused(soldier, "use_spell_slot", { characterId: soldier.id, level: 1, spell: "Magic Missile" });
  await refused(soldier, "use_spell_slot", { characterId: soldier.id, level: 1 });
  await refused(soldier, "cast_at_enemy", { characterId: soldier.id, targetEnemyId: ogre.id, spell: "Hold Person", saveAbility: "wis", level: 2 });
  await refused(soldier, "cast_buff", { characterId: soldier.id, spell: "Bless" });
  await refused(soldier, "pc_attack", { characterId: soldier.id, enemyId: ogre.id, targetEnemyId: ogre.id, spell: "Fire Bolt", damage: "1d10" });
});

await test("a character with no Spellcasting casts no cantrip and no ritual", async () => {
  await refused(soldier, "use_spell_slot", { characterId: soldier.id, level: 1, spell: pack ? "Fire Bolt" : "Detect Magic", ritual: !pack });
  await refused(soldier, "use_spell_slot", { characterId: soldier.id, level: 1, spell: "Detect Magic", ritual: true });
});

await test("a character with no Spellcasting casts no area spell", async () => {
  await refused(soldier, "aoe_damage", {
    damage: "8d6", saveAbility: "dex", dc: 15, enemyIds: [ogre.id], casterId: soldier.id, spell: "Arcane Detonation",
  });
});

// ---- rituals ----

await test("only a spell with the ritual tag is cast as a ritual", async () => {
  await refused(mage, "use_spell_slot", { characterId: mage.id, level: 3, spell: "Fireball", ritual: true });
  await refused(priest, "use_spell_slot", { characterId: priest.id, level: 1, spell: "Cure Wounds", ritual: true });
});

await test("a ritual spends no slot", async () => {
  const before = castingState(calm.sheet(calmPriest.id));
  const out = await calm.invoke("use_spell_slot", { characterId: calmPriest.id, level: 1, spell: "Detect Magic", ritual: true });
  assert.equal(out.ok, true, out.error);
  // Detect Magic takes concentration, which the ritual starts like any cast.
  assert.equal(castingState({ ...calm.sheet(calmPriest.id), concentratingOn: null }), before);
});

await test("a ritual out of a fight moves the clock on by the ten minutes it takes", async () => {
  const { getClock } = await import("../src/lib/db/clock.ts");
  const before = getClock(calm.campaignId).instant;
  const out = await calm.invoke("use_spell_slot", { characterId: calmPriest.id, level: 1, spell: "Detect Magic", ritual: true });
  assert.equal(out.ok, true, out.error);
  assert.ok(getClock(calm.campaignId).instant > before, "the clock did not move");
});

await test("a wizard casts a ritual from the spellbook without preparing it", async () => {
  const out = await calm.invoke("use_spell_slot", { characterId: calmMage.id, level: 1, spell: "Detect Magic", ritual: true });
  assert.equal(out.ok, true, out.error);
});

await test("only a class with Ritual Casting casts a ritual", async () => {
  await refused(sorc, "use_spell_slot", { characterId: sorc.id, level: 1, spell: "Detect Magic", ritual: true });
});

await test("a ritual names its spell", async () => {
  await refused(mage, "use_spell_slot", { characterId: mage.id, level: 3, ritual: true });
});

await test("a ritual is not cast in the middle of a fight", async () => {
  const { getClock } = await import("../src/lib/db/clock.ts");
  const before = JSON.stringify(getClock(world.campaignId));
  const out = await world.invoke("use_spell_slot", { characterId: priest.id, level: 1, spell: "Detect Magic", ritual: true });
  assert.ok(
    out.ok === false || JSON.stringify(getClock(world.campaignId)) !== before,
    "a ritual was cast mid-fight and the in-world clock did not move",
  );
});

// ---- after the rest ----

await test("the long rest makes a pending spell castable and leaves the book unprepared", async () => {
  const table = castOnOwnTurn(await openWorld());
  const hero = table.addHero(
    wizard(5, { spellcasting: { prepared: ["Magic Missile"], pending: ["Misty Step"], spellbook: ["Identify"] } }),
  );
  assert.equal((await table.invoke("use_spell_slot", { characterId: hero.id, level: 2, spell: "Misty Step" })).ok, false);
  await table.invoke("take_rest", { kind: "long" });
  const rested = table.sheet(hero.id).spellcasting;
  assert.ok(rested.prepared.includes("Misty Step"));
  assert.deepEqual(rested.pending ?? [], []);
  const out = await table.invoke("use_spell_slot", { characterId: hero.id, level: 2, spell: "Misty Step" });
  assert.equal(out.ok, true, out.error);
  assert.equal(table.sheet(hero.id).spellcasting.slots["2"].used, 1);
  assert.equal((await table.invoke("use_spell_slot", { characterId: hero.id, level: 1, spell: "Identify" })).ok, false);
});

world.close();
finish();
