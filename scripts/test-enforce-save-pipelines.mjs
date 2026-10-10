// Every saving throw a character makes reads the same riders, whichever
// engine path rolls it (docs/dnd-rules-audit-2026-10-09-extent.md, R1): a
// death save, a concentration save and a save to end a condition each take
// Bless, Bane, exhaustion and a halfling's Lucky exactly as a requested save
// does. A death save keeps its natural 1 and 20 apart from the modified total.
// Stabilizing, by the third success or by another's hand, resets both counts.
// A legendary creature's resistance settles the save it answers, and Evasion
// holds when a save fails automatically.
//
// SRD 5.1 as printed. Dice forced; every check reads a stored sheet.
import assert from "node:assert/strict";
import { openWorld, dice, clearDice } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-save-pipelines");
const { rollDeathSave } = await import("../src/lib/dm/death.ts");
const { applyDeathSaveRoll, onDamageAtZero, freshDeathTrack } = await import("../src/lib/dm/death-logic.ts");

// One table per check: a campaign seats few players, and a clock jump ticks
// every sheet at the table.
const worlds = [];
let world = null;
const fresh = async () => {
  world = await openWorld();
  worlds.push(world);
  return world;
};
const LUCKY = { race: "halfling", features: [{ name: "Lucky", source: "race" }] };
const dying = async (overrides = {}) => {
  await fresh();
  const hero = world.addHero(overrides);
  world.patch(hero.id, { currentHp: 0, deathSaves: freshDeathTrack(), conditions: ["unconscious"] });
  return hero;
};
const deathSave = (hero, ...faces) => {
  clearDice();
  dice(...faces);
  rollDeathSave(world.campaign(), hero.id);
  clearDice();
  return world.sheet(hero.id).deathSaves;
};

// ---- death saves ----

await test("A blessed creature adds the d4 to its death save: 8 + 4 succeeds.", async () => {
  const hero = await dying();
  world.patch(hero.id, { conditions: ["unconscious", "blessed"], conditionMeta: { blessed: { rounds: 10 } } });
  const track = deathSave(hero, 8, 4);
  assert.equal(track.successes, 1, JSON.stringify(track));
  assert.equal(track.failures, 0);
});

await test("A halfling's Lucky rerolls a natural 1 on a death save.", async () => {
  const hero = await dying(LUCKY);
  const track = deathSave(hero, 1, 18);
  assert.equal(track.failures, 0, JSON.stringify(track));
  assert.equal(track.successes, 1);
});

await test("A natural 20 revives whatever Bane takes away from the total.", async () => {
  const hero = await dying();
  world.patch(hero.id, { conditions: ["unconscious", "baned"], conditionMeta: { baned: { rounds: 10 } } });
  deathSave(hero, 20, 4);
  assert.equal(world.sheet(hero.id).currentHp, 1);
});

await test("A natural 1 is two failures even when Bless lifts the total past 10.", async () => {
  const hero = await dying();
  world.patch(hero.id, { conditions: ["unconscious", "blessed"], conditionMeta: { blessed: { rounds: 10 } } });
  // A d4 of 4 cannot lift a 1 to 10, so the rule is read through the helper too.
  const track = deathSave(hero, 1, 4);
  assert.equal(track.failures, 2, JSON.stringify(track));
  const helper = applyDeathSaveRoll(freshDeathTrack(), 1, 12);
  assert.equal(helper.track.failures, 2);
});

await test("A modified total of 10 or more succeeds though the die alone would not.", async () => {
  const helper = applyDeathSaveRoll(freshDeathTrack(), 8, 12);
  assert.equal(helper.track.successes, 1);
  assert.equal(helper.track.failures, 0);
});

// ---- stabilizing resets the counts ----

await test("The third success stabilizes with both counts back to zero.", async () => {
  const stable = applyDeathSaveRoll({ successes: 2, failures: 2, stable: false, dead: false }, 15);
  assert.equal(stable.outcome, "stable");
  assert.deepEqual([stable.track.successes, stable.track.failures], [0, 0]);
  const hit = onDamageAtZero(stable.track, false);
  assert.equal(hit.failures, 1);
  assert.equal(hit.dead, false);
});

await test("A Medicine check that stabilizes clears the failures already taken.", async () => {
  const hero = await dying();
  const healer = world.addHero({ abilities: { wis: 14 } });
  world.patch(hero.id, { deathSaves: { successes: 1, failures: 2, stable: false, dead: false } });
  clearDice();
  dice(15);
  const out = await world.invoke("stabilize", { characterId: hero.id, healerId: healer.id });
  clearDice();
  assert.equal(out.ok, true, out.error);
  const track = world.sheet(hero.id).deathSaves;
  assert.equal(track.stable, true);
  assert.deepEqual([track.successes, track.failures], [0, 0]);
});

// ---- concentration ----

const concentrating = async (overrides = {}) => {
  await fresh();
  const hero = world.addHero({ class: "wizard", abilities: { con: 14 }, ...overrides });
  world.patch(hero.id, {
    concentratingOn: "Fly",
    conditions: ["flying"],
    conditionMeta: { flying: { rounds: 100, spell: "Fly", source: hero.id } },
  });
  return hero;
};

await test("Exhaustion 3 puts the concentration save at disadvantage: 15 and 1 keep the 1.", async () => {
  const hero = await concentrating();
  world.patch(hero.id, { exhaustion: 3 });
  clearDice();
  dice(15, 1);
  await world.invoke("apply_damage", { characterId: hero.id, amount: 8, type: "slashing" });
  clearDice();
  assert.equal(world.sheet(hero.id).concentratingOn, null);
});

await test("A halfling's Lucky rerolls a natural 1 on a concentration save.", async () => {
  const hero = await concentrating(LUCKY);
  clearDice();
  dice(1, 15);
  await world.invoke("apply_damage", { characterId: hero.id, amount: 4, type: "slashing" });
  clearDice();
  assert.equal(world.sheet(hero.id).concentratingOn, "Fly");
});

// ---- saves to end a condition ----

const poisoned = async (overrides = {}) => {
  await fresh();
  const hero = world.addHero({ abilities: { con: 10 }, ...overrides });
  world.patch(hero.id, { conditions: ["poisoned"], conditionMeta: { poisoned: { saveEnds: { ability: "con", dc: 10 } } } });
  return hero;
};

await test("Bless rides the save to end a condition: 8 + 4 ends poisoned.", async () => {
  const hero = await poisoned();
  world.patch(hero.id, {
    conditions: ["poisoned", "blessed"],
    conditionMeta: { poisoned: { saveEnds: { ability: "con", dc: 10 } }, blessed: { rounds: 100 } },
  });
  clearDice();
  dice(8, 4);
  await world.invoke("pass_time", { amount: 1, unit: "minutes" });
  clearDice();
  assert.equal(world.sheet(hero.id).conditions.includes("poisoned"), false);
});

await test("A halfling's Lucky rerolls a natural 1 on the save to end a condition.", async () => {
  const hero = await poisoned(LUCKY);
  clearDice();
  dice(1, 15);
  await world.invoke("pass_time", { amount: 1, unit: "minutes" });
  clearDice();
  assert.equal(world.sheet(hero.id).conditions.includes("poisoned"), false);
});

// ---- Legendary Resistance settles the save it answers (F15) ----

const { table, caster, enemyOf, closeTables } = await import("./lib/enforce-spell-kit.mjs");
const encounters = await import("../src/lib/db/encounters.ts");
// A table whose first dummy (90 HP, saves +0) keeps three Legendary
// Resistances.
const legendaryTable = async (heroes, count = 1) => {
  const t = await table(heroes, count);
  const encounter = t.world.encounter();
  encounters.saveEncounter({ ...encounter, legendary: { ...encounter.legendary, pools: { ...encounter.legendary.pools, [t.enemies[0].id]: { actions: 0, resistances: 3 } } } });
  return t;
};
const resistancesOf = (t) => t.world.encounter().legendary.pools[t.enemies[0].id].resistances;

await test("An area's binding condition spends a Legendary Resistance: Hypnotic Pattern leaves the creature uncharmed.", async () => {
  const t = await legendaryTable([caster("wizard", "int", ["Hypnotic Pattern"])]);
  t.world.dice(1);
  const out = await t.world.invoke("aoe_damage", { casterId: t.sheets[0].id, spell: "Hypnotic Pattern", level: 3, saveAbility: "wis", enemyIds: [t.enemies[0].id] });
  t.world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(resistancesOf(t), 2);
  assert.equal(enemyOf(t.world, t.enemies[0].id).conditions.includes("charmed"), false);
});

await test("legendary_resist settles the failed save as a success: Fireball's damage comes back to half.", async () => {
  const t = await legendaryTable([caster("wizard", "int", ["Fireball"])]);
  t.world.dice(3, 3, 3, 3, 3, 3, 3, 3, 1);
  const out = await t.world.invoke("aoe_damage", { casterId: t.sheets[0].id, spell: "Fireball", level: 3, enemyIds: [t.enemies[0].id] });
  t.world.clearDice();
  assert.equal(out.ok, true, out.error);
  // Damage alone is not worth a resistance on its own: the DM chooses.
  assert.equal(resistancesOf(t), 3);
  assert.equal(enemyOf(t.world, t.enemies[0].id).currentHp, 66);
  const resisted = await t.world.invoke("legendary_resist", { enemyId: t.enemies[0].id });
  assert.equal(resisted.ok, true, resisted.error);
  assert.equal(resistancesOf(t), 2);
  assert.equal(enemyOf(t.world, t.enemies[0].id).currentHp, 78, "a success takes 12 of the 24");
  // One failure, one resistance.
  assert.equal((await t.world.invoke("legendary_resist", { enemyId: t.enemies[0].id })).ok, false);
  assert.equal(resistancesOf(t), 2);
});

await test("legendary_resist answers a spell's failed save: Vicious Mockery's damage is undone.", async () => {
  const t = await legendaryTable([caster("bard", "cha", [], ["Vicious Mockery"])]);
  t.world.dice(1, 4, 4);
  const out = await t.world.invoke("cast_at_enemy", { characterId: t.sheets[0].id, targetEnemyId: t.enemies[0].id, spell: "Vicious Mockery", saveAbility: "wis" });
  t.world.clearDice();
  assert.equal(out.ok, true, out.error);
  // A one-attack disadvantage is not worth a resistance on its own.
  assert.equal(resistancesOf(t), 3);
  assert.ok(enemyOf(t.world, t.enemies[0].id).currentHp < 90);
  const resisted = await t.world.invoke("legendary_resist", { enemyId: t.enemies[0].id });
  assert.equal(resisted.ok, true, resisted.error);
  assert.equal(enemyOf(t.world, t.enemies[0].id).currentHp, 90, "the cantrip deals nothing on a success");
});

// ---- Evasion holds when a save fails automatically (F14) ----

await test("A paralyzed rogue fails a DEX save automatically and Evasion still halves the Fireball.", async () => {
  const rogue = { class: "rogue", level: 7, abilities: { dex: 16 }, proficiencies: { saves: ["dex", "int"], skills: [], expertise: [], languages: ["Common"], tools: [], armor: ["light"], weapons: ["simple"] } };
  const t = await table([caster("wizard", "int", ["Fireball"]), rogue]);
  const [, hero] = t.sheets;
  t.world.patch(hero.id, { maxHp: 60, currentHp: 60, conditions: ["paralyzed"], conditionMeta: { paralyzed: { rounds: 10 } } });
  t.world.dice(3, 3, 3, 3, 3, 3, 3, 3);
  const out = await t.world.invoke("aoe_damage", { casterId: t.sheets[0].id, spell: "Fireball", level: 3, characterIds: [hero.id] });
  t.world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(t.world.sheet(hero.id).currentHp, 48, "half of 24, not all of it");
});

closeTables();
worlds[0]?.close();
finish();
