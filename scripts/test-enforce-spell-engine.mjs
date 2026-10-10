// What a spell DOES once it is paid for, the high findings of the second
// spells audit (/tmp/odm-enf2/reports/spells.md): whose effects a broken
// concentration ends, area spells as one casting, a concentration spell's
// later turns, Spirit Guardians as an aura, the rows the prose parser gets
// wrong, the warlock's one slot level, bringing back the dead, the area tool
// that cannot be used for a free spell, and the same numbers with no content
// pack.
//
// The rules are SRD 5.1's. Every die is forced; every check reads the stored
// sheet, the encounter row, the dice the engine rolled, or a refusal.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { freshTurn, layMap, warlock } from "./lib/enforce-spells.mjs";
import {
  caster,
  closeTables,
  countDice,
  enemyOf,
  field,
  FIGHTER,
  table,
  withoutPack,
} from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-enforce-spell-engine");
const { skipCurrentTurn } = await import("../src/lib/dm/encounter-tools.ts");
const encounters = await import("../src/lib/db/encounters.ts");
const { advanceClock } = await import("../src/lib/db/clock.ts");
void openWorld;

// ---- H2: concentration ends that spell's effects, not a name ----

await test("ending concentration on Hold Person frees its own target and nobody another source holds", async () => {
  const { world, sheets: [wizard, ally], enemies: [held, other] } = await table(
    [caster("wizard", "int", ["Hold Person"]), FIGHTER],
    2,
  );
  world.dice(1);
  const cast = await world.invoke("cast_at_enemy", {
    characterId: wizard.id, targetEnemyId: held.id, spell: "Hold Person", saveAbility: "wis", level: 2,
  });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(enemyOf(world, held.id).conditions.includes("paralyzed"));
  // A ghoul's claw paralyzed goblin B and the ally.
  const b = enemyOf(world, other.id);
  encounters.patchEnemyConditions(b.id, [...b.conditions, "paralyzed"], { ...b.conditionMeta, paralyzed: { rounds: 10 } });
  world.patch(ally.id, { conditions: ["paralyzed"], conditionMeta: { paralyzed: { rounds: 10 } } });
  const out = await world.invoke("clear_condition", { characterId: wizard.id, condition: "concentration" });
  assert.equal(out.ok, true, out.error);
  assert.ok(!enemyOf(world, held.id).conditions.includes("paralyzed"));
  assert.ok(enemyOf(world, other.id).conditions.includes("paralyzed"));
  assert.ok(world.sheet(ally.id).conditions.includes("paralyzed"));
});

await test("a condition a spell lays down records the spell and its caster", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Hold Person"])]);
  world.dice(1);
  await world.invoke("cast_at_enemy", {
    characterId: wizard.id, targetEnemyId: goblin.id, spell: "Hold Person", saveAbility: "wis", level: 2,
  });
  world.clearDice();
  const meta = enemyOf(world, goblin.id).conditionMeta.paralyzed;
  assert.equal(meta.spell, "Hold Person");
  assert.equal(meta.source, wizard.id);
});

// ---- H3: an area spell is one casting for everybody in its area ----

await test("Entangle through aoe_damage restrains every creature that fails, deals no damage, and spends one slot", async () => {
  const { world, sheets: [druid], enemies: [a, b] } = await table([caster("druid", "wis", ["Entangle"])], 2);
  world.dice(1, 1);
  const out = await world.invoke("aoe_damage", {
    casterId: druid.id, spell: "Entangle", level: 1, damage: "2d4", saveAbility: "str", dc: 15, enemyIds: [a.id, b.id],
  });
  const unused = world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(unused, 0);
  for (const id of [a.id, b.id]) {
    const now = enemyOf(world, id);
    assert.ok(now.conditions.includes("restrained"), `${now.displayName} is not restrained`);
    assert.equal(now.currentHp, now.maxHp);
  }
  assert.equal(world.sheet(druid.id).spellcasting.slots["1"].used, 1);
});

await test("Faerie Fire on a second creature in the same turn is the same casting: one slot", async () => {
  const { world, sheets: [druid], enemies: [a, b] } = await table([caster("druid", "wis", ["Faerie Fire"])], 2);
  const { onTurnOf } = await import("./lib/enforce-spells.mjs");
  await onTurnOf(world, druid.id, async () => {
    world.dice(1);
    const one = await world.invokeAsIs("cast_at_enemy", { characterId: druid.id, targetEnemyId: a.id, spell: "Faerie Fire", saveAbility: "dex", level: 1 });
    world.clearDice();
    world.dice(1);
    const two = await world.invokeAsIs("cast_at_enemy", { characterId: druid.id, targetEnemyId: b.id, spell: "Faerie Fire", saveAbility: "dex", level: 1 });
    world.clearDice();
    assert.equal(one.ok, true, one.error);
    assert.equal(two.ok, true, two.error);
  });
  assert.ok(enemyOf(world, a.id).conditions.includes("faerie fire"));
  assert.ok(enemyOf(world, b.id).conditions.includes("faerie fire"));
  assert.equal(world.sheet(druid.id).spellcasting.slots["1"].used, 1);
});

await test("Slow takes up to six creatures from one casting, and a seventh is refused before the slot", async () => {
  const { world, sheets: [wizard], enemies } = await table([caster("wizard", "int", ["Slow"])], 7);
  const before = JSON.stringify(world.sheet(wizard.id).spellcasting.slots);
  const seven = await world.invoke("aoe_damage", {
    casterId: wizard.id, spell: "Slow", level: 3, damage: "0", saveAbility: "wis", dc: 15, enemyIds: enemies.map((entry) => entry.id),
  });
  assert.equal(seven.ok, false);
  assert.equal(JSON.stringify(world.sheet(wizard.id).spellcasting.slots), before);
  world.dice(1, 1, 1, 1, 1, 1);
  const six = await world.invoke("aoe_damage", {
    casterId: wizard.id, spell: "Slow", level: 3, damage: "0", saveAbility: "wis", dc: 15, enemyIds: enemies.slice(0, 6).map((entry) => entry.id),
  });
  world.clearDice();
  assert.equal(six.ok, true, six.error);
  assert.equal(enemies.slice(0, 6).filter((entry) => enemyOf(world, entry.id).conditions.includes("slowed")).length, 6);
  assert.equal(world.sheet(wizard.id).spellcasting.slots["3"].used, 1);
});

// ---- H4: a concentration spell's repeat costs the turn, not a slot ----

await test("a second Call Lightning bolt on a later turn spends no slot", async () => {
  const { world, sheets: [druid], enemies: [goblin] } = await table([caster("druid", "wis", ["Call Lightning"])]);
  world.dice(1, 5, 5, 5);
  const one = await world.invoke("aoe_damage", {
    casterId: druid.id, spell: "Call Lightning", level: 3, damage: "3d10", saveAbility: "dex", dc: 15, enemyIds: [goblin.id],
  });
  world.clearDice();
  assert.equal(one.ok, true, one.error);
  await freshTurn(world);
  world.dice(1, 5, 5, 5);
  const two = await world.invoke("aoe_damage", {
    casterId: druid.id, spell: "Call Lightning", level: 3, damage: "3d10", saveAbility: "dex", dc: 15, enemyIds: [goblin.id],
  });
  world.clearDice();
  assert.equal(two.ok, true, two.error);
  assert.equal(world.sheet(druid.id).spellcasting.slots["3"].used, 1);
  assert.equal(world.sheet(druid.id).concentratingOn, "Call Lightning");
});

await test("a Call Lightning bolt from a 4th level casting keeps rolling 4d10 on its later turns", async () => {
  const { world, sheets: [druid], enemies: [goblin] } = await table([caster("druid", "wis", ["Call Lightning"])]);
  world.dice(1, 1, 1, 1, 1);
  await world.invoke("aoe_damage", {
    casterId: druid.id, spell: "Call Lightning", level: 4, damage: "3d10", saveAbility: "dex", dc: 15, enemyIds: [goblin.id],
  });
  world.clearDice();
  await freshTurn(world);
  world.diceLog();
  world.dice(1, 1, 1, 1, 1);
  await world.invoke("aoe_damage", {
    casterId: druid.id, spell: "Call Lightning", damage: "3d10", saveAbility: "dex", dc: 15, enemyIds: [goblin.id],
  });
  const log = world.diceLog();
  world.clearDice();
  assert.equal(countDice(log, 10), 4);
  assert.equal(world.sheet(druid.id).spellcasting.slots["4"].used, 1);
});

// ---- H5: Spirit Guardians is an aura ----

await test("Spirit Guardians hits an enemy that starts its turn within 15 feet: a WIS save and 3d8, no slot", async () => {
  const { world, sheets: [priest], enemies: [goblin] } = await table([caster("cleric", "wis", ["Spirit Guardians"])]);
  await layMap(world, field(), { [priest.id]: { x: 1, y: 2 }, [goblin.id]: { x: 2, y: 2 } });
  const cast = await world.invoke("cast_buff", { characterId: priest.id, spell: "Spirit Guardians", level: 3 });
  assert.equal(cast.ok, true, cast.error);
  const slots = JSON.stringify(world.sheet(priest.id).spellcasting.slots);
  world.dice(1, 4, 4, 4);
  assert.equal(skipCurrentTurn(world.campaignId), true);
  world.clearDice();
  const now = enemyOf(world, goblin.id);
  assert.equal(now.maxHp - now.currentHp, 12);
  assert.equal(JSON.stringify(world.sheet(priest.id).spellcasting.slots), slots);
});

await test("an enemy starting its turn outside Spirit Guardians is untouched", async () => {
  const { world, sheets: [priest], enemies: [goblin] } = await table([caster("cleric", "wis", ["Spirit Guardians"])]);
  await layMap(world, field(), { [priest.id]: { x: 1, y: 2 }, [goblin.id]: { x: 20, y: 2 } });
  await world.invoke("cast_buff", { characterId: priest.id, spell: "Spirit Guardians", level: 3 });
  world.dice(1, 4, 4, 4);
  skipCurrentTurn(world.campaignId);
  const unused = world.clearDice();
  assert.equal(unused, 4);
  const now = enemyOf(world, goblin.id);
  assert.equal(now.currentHp, now.maxHp);
});

// ---- H6 to H8: the rows the prose reads wrong ----

await test("Hypnotic Pattern leaves a failed creature charmed and incapacitated with no repeat save, until it is hurt", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Hypnotic Pattern"])]);
  world.dice(1);
  const out = await world.invoke("cast_at_enemy", {
    characterId: wizard.id, targetEnemyId: goblin.id, spell: "Hypnotic Pattern", saveAbility: "wis", level: 3,
  });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const now = enemyOf(world, goblin.id);
  assert.ok(now.conditions.includes("incapacitated"));
  assert.ok(now.conditions.includes("charmed"));
  assert.equal(now.conditionMeta.incapacitated?.saveEnds, undefined);
  const hurt = await world.invoke("damage_enemy", { enemyId: goblin.id, amount: 1 });
  assert.equal(hurt.ok, true, hurt.error);
  assert.ok(!enemyOf(world, goblin.id).conditions.includes("incapacitated"));
  assert.ok(!enemyOf(world, goblin.id).conditions.includes("charmed"));
});

await test("Blindness/Deafness blinds when the caster chooses blindness", async () => {
  const { world, sheets: [priest], enemies: [goblin] } = await table([caster("cleric", "wis", ["Blindness/Deafness"])]);
  world.dice(1);
  const out = await world.invoke("cast_at_enemy", {
    characterId: priest.id, targetEnemyId: goblin.id, spell: "Blindness/Deafness", saveAbility: "con", condition: "blinded", level: 2,
  });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(enemyOf(world, goblin.id).conditions.includes("blinded"));
  assert.ok(!enemyOf(world, goblin.id).conditions.includes("deafened"));
});

await test("Web restrains on a failed DEX save and burns nobody", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Web"])]);
  world.dice(1, 4, 4);
  const out = await world.invoke("cast_at_enemy", {
    characterId: wizard.id, targetEnemyId: goblin.id, spell: "Web", saveAbility: "dex", level: 2,
  });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const now = enemyOf(world, goblin.id);
  assert.ok(now.conditions.includes("restrained"));
  assert.equal(now.currentHp, now.maxHp);
});

// ---- H11: Eldritch Blast is a d10 a beam ----

await test("an Eldritch Blast beam rolls one d10 whatever dice the caller names", async () => {
  const { world, sheets: [lock], enemies: [goblin] } = await table([warlock(5)]);
  world.diceLog();
  world.dice(15, 1, 1, 1, 1);
  const out = await world.invoke("pc_attack", {
    characterId: lock.id, targetEnemyId: goblin.id, spell: "Eldritch Blast", damage: "4d10",
  });
  const log = world.diceLog();
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(countDice(log, 10), 1);
});

// ---- H12: a warlock casts at the pact slot's level ----

await test("a 5th level warlock's Hex with no level named spends a 3rd level pact slot", async () => {
  const { world, sheets: [lock] } = await table([warlock(5)]);
  const out = await world.invoke("cast_buff", { characterId: lock.id, spell: "Hex" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(lock.id).spellcasting.slots["3"].used, 1);
});

await test("a 5th level warlock's Hold Person with no level named is cast at 3rd level", async () => {
  const { world, sheets: [lock], enemies: [goblin] } = await table([warlock(5)]);
  world.dice(1);
  const out = await world.invoke("cast_at_enemy", {
    characterId: lock.id, targetEnemyId: goblin.id, spell: "Hold Person", saveAbility: "wis",
  });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(enemyOf(world, goblin.id).conditions.includes("paralyzed"));
  assert.equal(world.sheet(lock.id).spellcasting.slots["3"].used, 1);
});

// ---- H13: bringing back the dead ----

const DEAD = { successes: 0, failures: 3, stable: false, dead: true };

await test("Revivify through heal brings a dead fighter back at 1 HP for one 3rd level slot and 300 gp of diamonds", async () => {
  // In a fight the diamonds are carried: there is no buying them mid-battle
  // (src/lib/dm/cast-materials.ts).
  const { world, sheets: [priest, fighter] } = await table([
    { ...caster("cleric", "wis", ["Revivify"]), gold: 400, equipment: [{ name: "Diamonds (300 gp)", qty: 1 }] },
    FIGHTER,
  ]);
  world.patch(fighter.id, { currentHp: 0, deathSaves: DEAD });
  const out = await world.invoke("heal", { characterId: fighter.id, casterId: priest.id, spell: "Revivify", level: 3 });
  assert.equal(out.ok, true, out.error);
  const now = world.sheet(fighter.id);
  assert.equal(now.deathSaves?.dead ?? false, false);
  assert.equal(now.currentHp, 1);
  assert.equal(world.sheet(priest.id).spellcasting.slots["3"].used, 1);
  // The diamonds are consumed; the purse is untouched.
  assert.equal(world.sheet(priest.id).equipment.some((item) => /diamond/i.test(item.name)), false);
  assert.equal(world.sheet(priest.id).gold, 400);
});

await test("Revivify on a creature dead longer than a minute is refused before the slot and the diamond", async () => {
  const { world, sheets: [priest, fighter] } = await table([
    { ...caster("cleric", "wis", ["Revivify"]), gold: 400 },
    FIGHTER,
  ]);
  const killed = await world.invoke("apply_damage", { characterId: fighter.id, amount: 70 });
  assert.equal(killed.ok, true, killed.error);
  assert.equal(world.sheet(fighter.id).deathSaves?.dead, true);
  await world.invoke("end_encounter", { outcome: "truce" });
  advanceClock(world.campaignId, 5, "minutes");
  const out = await world.invoke("heal", { characterId: fighter.id, casterId: priest.id, spell: "Revivify", level: 3 });
  assert.equal(out.ok, false);
  assert.equal(world.sheet(priest.id).spellcasting.slots["3"].used, 0);
  assert.equal(world.sheet(priest.id).gold, 400);
  assert.equal(world.sheet(fighter.id).deathSaves?.dead, true);
});

await test("Raise Dead reaches ten days back and no further", async () => {
  const { world, sheets: [priest, fighter, other] } = await table([
    { ...caster("cleric", "wis", ["Raise Dead"]), gold: 1200 },
    FIGHTER,
    FIGHTER,
  ]);
  await world.invoke("apply_damage", { characterId: fighter.id, amount: 70 });
  await world.invoke("end_encounter", { outcome: "truce" });
  advanceClock(world.campaignId, 9, "days");
  await world.invoke("apply_damage", { characterId: other.id, amount: 70 });
  advanceClock(world.campaignId, 2, "days");
  const late = await world.invoke("heal", { characterId: fighter.id, casterId: priest.id, spell: "Raise Dead", level: 5 });
  assert.equal(late.ok, false);
  assert.equal(world.sheet(priest.id).gold, 1200);
  const inTime = await world.invoke("heal", { characterId: other.id, casterId: priest.id, spell: "Raise Dead", level: 5 });
  assert.equal(inTime.ok, true, inTime.error);
  assert.equal(world.sheet(other.id).deathSaves?.dead ?? false, false);
  assert.equal(world.sheet(other.id).currentHp, 1);
  assert.equal(world.sheet(priest.id).gold, 700);
});

// ---- H14 (N:B1): aoe_damage is no free spell ----

await test("aoe_damage naming a spell with no caster is refused and deals nothing", async () => {
  const { world, enemies: [goblin] } = await table([caster("wizard", "int", ["Fireball"])]);
  world.dice(1, 6, 6, 6);
  const out = await world.invoke("aoe_damage", {
    spell: "Fireball", level: 3, damage: "20d6", saveAbility: "wis", dc: 25, enemyIds: [goblin.id],
  });
  world.clearDice();
  assert.equal(out.ok, false);
  const now = enemyOf(world, goblin.id);
  assert.equal(now.currentHp, now.maxHp);
});

await test("aoe_damage naming a caster who is not a character is refused and deals nothing", async () => {
  const { world, enemies: [goblin] } = await table([caster("wizard", "int", ["Fireball"])]);
  const out = await world.invoke("aoe_damage", {
    spell: "Fireball", casterId: "nobody", level: 3, damage: "8d6", saveAbility: "dex", dc: 15, enemyIds: [goblin.id],
  });
  world.clearDice();
  assert.equal(out.ok, false);
  assert.equal(enemyOf(world, goblin.id).currentHp, enemyOf(world, goblin.id).maxHp);
});

// ---- H15: the same numbers without the content pack ----

await test("with no content pack, Fireball through aoe_damage rolls 8d6, a DEX save, half on a success", () => {
  const out = withoutPack("fireball");
  assert.equal(out.pack, false);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.saveAbility, "dex");
  assert.equal(out.halfOnSave, true);
  assert.equal(out.d6, 8);
});

await test("with no content pack, an 11th level Fire Bolt rolls 3d10", () => {
  const out = withoutPack("firebolt");
  assert.equal(out.ok, true, out.error);
  assert.equal(out.d10, 3);
});

await test("with no content pack, Sacred Flame is a DEX save for 2d8 radiant at 5th level", () => {
  const out = withoutPack("sacred-flame");
  assert.equal(out.ok, true, out.error);
  assert.equal(out.d8, 2);
  assert.equal(out.damageType, "radiant");
});

// ---- M1 (N:B6): healing that cannot be derived refuses before the spend ----

await test("with no content pack, Cure Wounds and Heal heal what they print", () => {
  const out = withoutPack("heal");
  // 1 HP + Cure Wounds (1d8 forced 3, +4 WIS) = 8; then Heal's 70.
  assert.equal(out.cure, 8);
  assert.equal(out.heal, 78);
  assert.equal(out.slots["1"].used, 1);
  assert.equal(out.slots["6"].used, 1);
});

await test("Heal restores 70 hit points for one 6th level slot", async () => {
  const { world, sheets: [priest, friend] } = await table([caster("cleric", "wis", ["Heal"], [], 11), { ...FIGHTER, maxHp: 90 }]);
  world.patch(friend.id, { currentHp: 5 });
  const out = await world.invoke("heal", { characterId: friend.id, casterId: priest.id, spell: "Heal", level: 6 });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(friend.id).currentHp, 75);
  assert.equal(world.sheet(priest.id).spellcasting.slots["6"].used, 1);
});

await test("a healing spell the server cannot roll is refused before any slot is spent", async () => {
  const { world, sheets: [priest, friend] } = await table([
    caster("cleric", "wis", ["Detect Magic"], [], 5),
    FIGHTER,
  ]);
  world.patch(friend.id, { currentHp: 5 });
  const before = JSON.stringify(world.sheet(priest.id).spellcasting.slots);
  const out = await world.invoke("heal", { characterId: friend.id, casterId: priest.id, spell: "Detect Magic", level: 1 });
  assert.equal(out.ok, false);
  assert.equal(JSON.stringify(world.sheet(priest.id).spellcasting.slots), before);
});

closeTables();
finish();
