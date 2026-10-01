// The low findings of the second spells audit
// (/tmp/odm-enf2/reports/spells.md) and the spell features the features
// audit found (F:H8 Disciple of Life, F:M19 Empowered Evocation, Elemental
// Affinity and Potent Cantrip, F:L15 Spell Mastery), and the narrator
// audit's free spell effect through set_condition (N:B2).
//
// SRD 5.1 as printed. Dice forced; every check reads the stored sheet, the
// encounter row, the dice rolled, or a refusal.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { freshTurn, onTurnOf } from "./lib/enforce-spells.mjs";
import { caster, closeTables, countDice, enemyOf, FIGHTER, invokeAsAi, table } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-enforce-spell-riders");
const { skipCurrentTurn } = await import("../src/lib/dm/encounter-tools.ts");
const encounters = await import("../src/lib/db/encounters.ts");
const { spellMechanicsFor } = await import("../src/lib/content/index.ts");

// ---- L1, L2: spells the prose misreads as damage or a condition ----

await test("Calm Emotions lays no frightened condition on its target", async () => {
  const { world, sheets: [bard], enemies: [goblin] } = await table([caster("bard", "cha", ["Calm Emotions"])]);
  world.dice(1);
  await world.invoke("cast_at_enemy", { characterId: bard.id, targetEnemyId: goblin.id, spell: "Calm Emotions", saveAbility: "cha", level: 2 });
  world.clearDice();
  assert.ok(!enemyOf(world, goblin.id).conditions.includes("frightened"));
});

await test("Spike Growth and Meld into Stone deal no damage through cast_at_enemy", async () => {
  const { world, sheets: [druid], enemies: [goblin] } = await table([caster("druid", "wis", ["Spike Growth", "Meld into Stone"])]);
  for (const spell of ["Spike Growth", "Meld into Stone"]) {
    await freshTurn(world);
    world.dice(4, 4, 4, 4, 4, 4);
    await world.invoke("cast_at_enemy", { characterId: druid.id, targetEnemyId: goblin.id, spell, saveAbility: "dex", damage: "2d4" });
    world.clearDice();
  }
  const now = enemyOf(world, goblin.id);
  assert.equal(now.currentHp, now.maxHp);
});

// ---- L3: Phantasmal Killer hurts at the start of the target's turns ----

// SRD 5.1: the dread strikes "at the end of each of the target's turns"
// (this pinned the start of the turn until the turn's end was kept).
await test("Phantasmal Killer frightens on a failed save and deals its 4d10 at the end of the target's turn", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Phantasmal Killer"])]);
  world.dice(1);
  const out = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Phantasmal Killer", saveAbility: "wis", level: 4 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(enemyOf(world, goblin.id).conditions.includes("frightened"));
  assert.equal(enemyOf(world, goblin.id).currentHp, enemyOf(world, goblin.id).maxHp);
  // Its turn starts (nothing yet), then ends: the save fails and 4d10 lands.
  skipCurrentTurn(world.campaignId);
  assert.equal(enemyOf(world, goblin.id).currentHp, enemyOf(world, goblin.id).maxHp);
  world.dice(1, 5, 5, 5, 5);
  skipCurrentTurn(world.campaignId);
  world.clearDice();
  const now = enemyOf(world, goblin.id);
  assert.equal(now.maxHp - now.currentHp, 20);
});

// ---- L4: spells with no initial save ----

await test("Power Word Stun stuns a creature of 150 hit points or fewer with no save rolled", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Power Word Stun"], [], 15)]);
  world.diceLog();
  const out = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Power Word Stun", saveAbility: "con", level: 8 });
  const log = world.diceLog();
  assert.equal(out.ok, true, out.error);
  assert.equal(countDice(log, 20), 0);
  assert.ok(enemyOf(world, goblin.id).conditions.includes("stunned"));
});

// ---- L5: charms with long durations ----

await test("Animal Friendship charms a beast for a day with no repeat save, and Geas until it is ended", async () => {
  const { world, sheets: [druid], enemies: [beast] } = await table([caster("druid", "wis", ["Animal Friendship", "Geas"])], 1, { type: "beast" });
  world.dice(1);
  await world.invoke("cast_at_enemy", { characterId: druid.id, targetEnemyId: beast.id, spell: "Animal Friendship", saveAbility: "wis", level: 1 });
  world.clearDice();
  const meta = enemyOf(world, beast.id).conditionMeta.charmed;
  assert.equal(meta?.rounds, 14400);
  assert.equal(meta?.saveEnds, undefined);
  // Geas takes a minute to cast, so never in a fight: its row is read.
  const geas = spellMechanicsFor({ spell: "Geas" })?.mech.condition;
  assert.equal(geas?.name, "charmed");
  assert.equal(geas?.rounds, undefined);
  assert.equal(geas?.saveEnds, undefined);
});

// ---- L6: Magic Missile's darts split across targets ----

await test("Magic Missile's three darts split two and one across two goblins for one slot", async () => {
  const { world, sheets: [wizard], enemies: [a, b] } = await table([caster("wizard", "int", ["Magic Missile"])], 2);
  await onTurnOf(world, wizard.id, async () => {
    world.dice(1, 1);
    const one = await world.invokeAsIs("cast_at_enemy", { characterId: wizard.id, targetEnemyId: a.id, spell: "Magic Missile", saveAbility: "dex", darts: 2, level: 1 });
    world.clearDice();
    world.dice(1);
    const two = await world.invokeAsIs("cast_at_enemy", { characterId: wizard.id, targetEnemyId: b.id, spell: "Magic Missile", saveAbility: "dex", darts: 1, level: 1 });
    world.clearDice();
    assert.equal(one.ok, true, one.error);
    assert.equal(two.ok, true, two.error);
  });
  assert.equal(enemyOf(world, a.id).maxHp - enemyOf(world, a.id).currentHp, 4);
  assert.equal(enemyOf(world, b.id).maxHp - enemyOf(world, b.id).currentHp, 2);
  assert.equal(world.sheet(wizard.id).spellcasting.slots["1"].used, 1);
});

await test("Magic Missile with no darts named throws all three, and leaves none for a free second call", async () => {
  const { world, sheets: [wizard], enemies: [a, b] } = await table([caster("wizard", "int", ["Magic Missile"])], 2);
  await onTurnOf(world, wizard.id, async () => {
    world.dice(1, 1, 1);
    await world.invokeAsIs("cast_at_enemy", { characterId: wizard.id, targetEnemyId: a.id, spell: "Magic Missile", saveAbility: "dex", level: 1 });
    world.clearDice();
    const again = await world.invokeAsIs("cast_at_enemy", { characterId: wizard.id, targetEnemyId: b.id, spell: "Magic Missile", saveAbility: "dex", level: 1 });
    world.clearDice();
    assert.equal(again.ok, false);
  });
  assert.equal(enemyOf(world, a.id).maxHp - enemyOf(world, a.id).currentHp, 6);
  assert.equal(enemyOf(world, b.id).currentHp, enemyOf(world, b.id).maxHp);
});

// ---- L8: the healing modifier is the carrying class's ----

await test("a wizard and cleric heals with Wisdom, the cleric's ability, not Intelligence", async () => {
  const hero = caster("wizard", "int", [], [], 5, {
    abilities: { int: 18, wis: 12, con: 14 },
    classes: [{ id: "wizard", subclass: "", level: 3 }, { id: "cleric", subclass: "", level: 2 }],
    spellcasting: {
      ability: "int",
      prepared: ["Magic Missile", "Cure Wounds"],
      casters: [
        { classId: "wizard", ability: "int", known: [], prepared: ["Magic Missile"], cantrips: [], spellbook: ["Magic Missile"] },
        { classId: "cleric", ability: "wis", known: [], prepared: ["Cure Wounds"], cantrips: [] },
      ],
    },
  });
  const { world, sheets: [mage, fighter] } = await table([hero, FIGHTER]);
  world.patch(fighter.id, { currentHp: 1 });
  world.dice(1);
  const out = await world.invoke("heal", { characterId: fighter.id, casterId: mage.id, spell: "Cure Wounds", level: 1 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  // 1 + 1 (d8) + 1 (WIS 12), not + 4 (INT 18).
  assert.equal(world.sheet(fighter.id).currentHp, 3);
});

// ---- L9: Spare the Dying ----

await test("Spare the Dying through heal stabilizes a dying ally", async () => {
  const { world, sheets: [priest, fighter] } = await table([caster("cleric", "wis", [], ["Spare the Dying"]), FIGHTER]);
  await world.invoke("apply_damage", { characterId: fighter.id, amount: world.sheet(fighter.id).currentHp });
  assert.equal(world.sheet(fighter.id).deathSaves?.stable, false);
  const out = await world.invoke("heal", { characterId: fighter.id, casterId: priest.id, spell: "Spare the Dying" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(fighter.id).deathSaves?.stable, true);
});

// ---- H13: the ordeal of coming back ----

await test("Raise Dead leaves -4 on attack rolls and saves, and each long rest eases it by one", async () => {
  const { world, sheets: [priest, fighter] } = await table([{ ...caster("cleric", "wis", ["Raise Dead"]), gold: 600 }, FIGHTER]);
  world.patch(fighter.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  // An hour's casting: after the fight.
  await world.invoke("end_encounter", { outcome: "truce" });
  const raised = await world.invoke("heal", { characterId: fighter.id, casterId: priest.id, spell: "Raise Dead", level: 5 });
  assert.equal(raised.ok, true, raised.error);
  assert.ok(world.sheet(fighter.id).conditions.includes("returned from death (-4)"));
  world.dice(10);
  const save = await world.invoke("request_roll", { characterId: fighter.id, kind: "saving_throw", ability: "wis", dc: 10, reason: "nerve" });
  world.clearDice();
  assert.equal(save.result.total, 6);
  const { longRestPatch } = await import("../src/lib/dm/rest-logic.ts");
  assert.ok(longRestPatch(world.sheet(fighter.id)).conditions.includes("returned from death (-3)"));
});

// ---- L10: concentration upkeep matches by source ----

await test("a caster whose own Hold Person held nobody any more stops concentrating, whatever else is paralyzed", async () => {
  const { world, sheets: [wizard], enemies: [a, b] } = await table([caster("wizard", "int", ["Hold Person"])], 2);
  world.dice(1);
  await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: a.id, spell: "Hold Person", saveAbility: "wis", level: 2 });
  world.clearDice();
  // A ghoul's claw holds goblin B; goblin A makes its repeat save at the
  // round's end.
  const other = enemyOf(world, b.id);
  encounters.patchEnemyConditions(other.id, ["paralyzed"], { paralyzed: { rounds: 50 } });
  const round = world.encounter().round;
  world.dice(20);
  for (let step = 0; step < 6 && world.encounter().round === round; step += 1) {
    skipCurrentTurn(world.campaignId);
  }
  world.clearDice();
  assert.ok(!enemyOf(world, a.id).conditions.includes("paralyzed"));
  assert.equal(world.sheet(wizard.id).concentratingOn ?? null, null);
});

// ---- L11: Dominate saves again when hurt ----

await test("a dominated creature saves again when it takes damage, and a success frees it", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Dominate Person"])]);
  world.dice(1);
  await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Dominate Person", saveAbility: "wis", level: 5 });
  world.clearDice();
  assert.ok(enemyOf(world, goblin.id).conditions.includes("charmed"));
  world.dice(20);
  await world.invoke("damage_enemy", { enemyId: goblin.id, amount: 1 });
  world.clearDice();
  assert.ok(!enemyOf(world, goblin.id).conditions.includes("charmed"));
});

// ---- F:H8, F:M19, F:L15: spell features ----

await test("Disciple of Life adds 2 + the slot level to a healing spell", async () => {
  const life = caster("cleric", "wis", ["Cure Wounds"], [], 1, {
    subclass: "life",
    abilities: { wis: 16 },
    features: [{ name: "Disciple of Life", source: "class", level: 1 }],
  });
  const { world, sheets: [priest, fighter] } = await table([life, FIGHTER]);
  world.patch(fighter.id, { currentHp: 1 });
  world.dice(1);
  await world.invoke("heal", { characterId: fighter.id, casterId: priest.id, spell: "Cure Wounds", level: 1 });
  world.clearDice();
  // 1 + (1 + 3 WIS + 3 Disciple of Life).
  assert.equal(world.sheet(fighter.id).currentHp, 8);
});

await test("Empowered Evocation adds the wizard's Intelligence to an evocation spell's damage", async () => {
  const evoker = caster("wizard", "int", ["Fireball"], [], 10, { subclass: "School of Evocation", features: [{ name: "Empowered Evocation", source: "class", level: 10 }] });
  const { world, sheets: [wizard], enemies: [goblin] } = await table([evoker]);
  // The damage rolls first, once for the area, then each save.
  world.dice(1, 1, 1, 1, 1, 1, 1, 1, 20);
  await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Fireball", level: 3, damage: "8d6", saveAbility: "dex", dc: 15, enemyIds: [goblin.id] });
  world.clearDice();
  // A made save: half of (8 + 4).
  const now = enemyOf(world, goblin.id);
  assert.equal(now.maxHp - now.currentHp, 6);
});

await test("Empowered Evocation adds the wizard's Intelligence to a Fire Bolt through pc_attack", async () => {
  const evoker = caster("wizard", "int", [], ["Fire Bolt"], 10, { subclass: "School of Evocation", features: [{ name: "Empowered Evocation", source: "class", level: 10 }] });
  const { world, sheets: [wizard], enemies: [goblin] } = await table([evoker]);
  world.dice(15, 1, 1);
  const out = await world.invoke("pc_attack", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Fire Bolt" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  // 2d10 at 10th level, both 1, + 4 INT.
  const now = enemyOf(world, goblin.id);
  assert.equal(now.maxHp - now.currentHp, 6);
});

await test("Elemental Affinity adds the sorcerer's Charisma to a spell of the ancestor's type", async () => {
  const draconic = caster("sorcerer", "cha", ["Burning Hands"], [], 6, {
    subclass: "Draconic Bloodline",
    features: [
      { name: "Dragon Ancestor: Red", source: "choice", level: 1 },
      { name: "Elemental Affinity", source: "class", level: 6 },
    ],
    spellcasting: { known: ["Burning Hands"], prepared: [] },
  });
  const { world, sheets: [sorcerer], enemies: [goblin] } = await table([draconic]);
  world.dice(1, 1, 1, 1);
  await world.invoke("aoe_damage", { casterId: sorcerer.id, spell: "Burning Hands", level: 1, damage: "3d6", saveAbility: "dex", dc: 15, enemyIds: [goblin.id] });
  world.clearDice();
  // A failed save: 3 + 4 CHA.
  const now = enemyOf(world, goblin.id);
  assert.equal(now.maxHp - now.currentHp, 7);
});

await test("Potent Cantrip: a save against the evoker's cantrip still takes half", async () => {
  const evoker = caster("wizard", "int", [], ["Acid Splash"], 6, { subclass: "School of Evocation", features: [{ name: "Potent Cantrip", source: "class", level: 6 }] });
  const { world, sheets: [wizard], enemies: [goblin] } = await table([evoker]);
  world.dice(20, 6, 6);
  await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Acid Splash", saveAbility: "dex" });
  world.clearDice();
  const now = enemyOf(world, goblin.id);
  assert.equal(now.maxHp - now.currentHp, 6);
});

await test("Spell Mastery casts a mastered 1st level spell at its own level with no slot", async () => {
  const master = caster("wizard", "int", ["Magic Missile"], [], 18, {
    features: [{ name: "Spell Mastery: Magic Missile, Invisibility", source: "choice", level: 18 }],
  });
  const { world, sheets: [wizard], enemies: [goblin] } = await table([master]);
  world.dice(1, 1, 1);
  const out = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Magic Missile", saveAbility: "dex" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(wizard.id).spellcasting.slots["1"].used, 0);
});

// ---- N:B2: a spell's effect is cast, not set ----

await test("the AI DM cannot hand out a spell's effect with set_condition; cast_buff still casts it", async () => {
  const { world, sheets: [priest, fighter] } = await table([caster("cleric", "wis", ["Bless"]), FIGHTER]);
  const free = await invokeAsAi(world, "set_condition", { characterId: fighter.id, condition: "blessed", rounds: 10 });
  assert.equal(free.ok, false);
  assert.ok(!world.sheet(fighter.id).conditions.includes("blessed"));
  const hasted = await invokeAsAi(world, "set_condition", { characterId: fighter.id, condition: "haste", rounds: 10 });
  assert.equal(hasted.ok, false);
  const cast = await onTurnOf(world, priest.id, () =>
    invokeAsAi(world, "cast_buff", { characterId: priest.id, spell: "Bless", level: 1, targetCharacterIds: [fighter.id] }),
  );
  assert.equal(cast.ok, true, cast.error);
  assert.ok(world.sheet(fighter.id).conditions.includes("blessed"));
});

await test("the human DM console may still set a spell's effect as a correction, and the AI may still set an SRD condition", async () => {
  const { world, sheets: [fighter] } = await table([FIGHTER]);
  const human = await world.invoke("set_condition", { characterId: fighter.id, condition: "blessed", rounds: 10 });
  assert.equal(human.ok, true, human.error);
  const prone = await invokeAsAi(world, "set_condition", { characterId: fighter.id, condition: "prone" });
  assert.equal(prone.ok, true, prone.error);
});

closeTables();
finish();
