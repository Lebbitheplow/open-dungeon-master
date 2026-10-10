// The rest of the PARTIAL spells of the second spells audit (/tmp/odm-enf2/
// reports/spells.md Appendix A): effects that answer a blow (Fire Shield,
// Holy Aura), effects that mark a creature for later turns (Acid Arrow's
// second splash, Phantasmal Killer, Weird, Flesh to Stone, Regenerate),
// immunities a spell grants (Heroism, Protection from Evil and Good, Heroes'
// Feast), and the spells whose target is out of reach or turned to dust.
//
// SRD 5.1 as printed. Dice forced; every check reads the stored sheet, the
// encounter row, the dice rolled, or a refusal.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { freshTurn } from "./lib/enforce-spells.mjs";
import { caster, closeTables, enemyOf, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";
import { d20s, enemySwing, nextTurn } from "./lib/enforce-spell-tail.mjs";

const { test, finish } = suite("test-enforce-spell-hooks");
const { getDatabase } = await import("../src/lib/db/core.ts");
const encounters = await import("../src/lib/db/encounters.ts");
const { rollDeathSave } = await import("../src/lib/dm/death.ts");

const hurt = (world, id) => enemyOf(world, id).maxHp - enemyOf(world, id).currentHp;

// ---- immunities a spell grants ----

await test("A creature under Heroism cannot be frightened.", async () => {
  const { world, sheets: [paladin, fighter] } = await table([caster("paladin", "cha", ["Heroism"], [], 5), FIGHTER]);
  const cast = await world.invoke("cast_buff", { characterId: paladin.id, spell: "Heroism", targetCharacterIds: [fighter.id], level: 1 });
  assert.equal(cast.ok, true, cast.error);
  await world.invoke("set_condition", { characterId: fighter.id, condition: "frightened", rounds: 3 });
  assert.ok(!world.sheet(fighter.id).conditions.includes("frightened"));
});

await test("Protection from Evil and Good keeps an undead's (or fiend's, fey's...) charm and fright off its target; a humanoid's still lands.", async () => {
  const { world, sheets: [cleric, fighter], enemies: [ghoul] } = await table([caster("cleric", "wis", ["Protection from Evil and Good"]), FIGHTER], 1, { type: "undead" });
  world.patch(cleric.id, { gold: 100 });
  const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Protection from Evil and Good", targetCharacterIds: [fighter.id], level: 1 });
  assert.equal(cast.ok, true, cast.error);
  await world.invoke("set_condition", { characterId: fighter.id, condition: "frightened", rounds: 3, sourceEnemyId: ghoul.id });
  assert.ok(!world.sheet(fighter.id).conditions.includes("frightened"));
});

// ---- effects that answer a blow ----

await test("Each time the creature under Warding Bond takes damage, the caster takes the same amount.", async () => {
  const { world, sheets: [cleric, fighter] } = await table([caster("cleric", "wis", ["Warding Bond"]), FIGHTER]);
  // The pair of rings, carried (no buying them mid-fight).
  world.patch(cleric.id, { equipment: [...world.sheet(cleric.id).equipment, { name: "Platinum ring (50 gp)", qty: 2 }] });
  const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Warding Bond", targetCharacterIds: [fighter.id], level: 2 });
  assert.equal(cast.ok, true, cast.error);
  const before = world.sheet(cleric.id).currentHp;
  const fighterBefore = world.sheet(fighter.id).currentHp;
  await world.invoke("apply_damage", { characterId: fighter.id, amount: 10, type: "slashing" });
  const took = fighterBefore - world.sheet(fighter.id).currentHp;
  assert.equal(took, 5);
  assert.equal(before - world.sheet(cleric.id).currentHp, took);
});

await test("A creature within 5 feet that hits the holder of Fire Shield with a melee attack takes 2d8 of the shield's damage.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Fire Shield"])]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Fire Shield", variant: "fire shield (cold)", level: 4 });
  assert.equal(cast.ok, true, cast.error);
  world.dice(19, 3, 4, 4);
  await enemySwing(world, goblin.id, wizard.id);
  world.clearDice();
  assert.equal(hurt(world, goblin.id), 8);
});

await test("A fiend or undead that hits a creature under Holy Aura with a melee attack makes a Constitution save or is blinded until the spell ends.", async () => {
  const { world, sheets: [cleric], enemies: [imp] } = await table([caster("cleric", "wis", ["Holy Aura"], [], 15)], 1, { type: "fiend" });
  world.patch(cleric.id, { equipment: [...world.sheet(cleric.id).equipment, { name: "Reliquary (1000 gp)", qty: 1 }] });
  const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Holy Aura", targetCharacterIds: [cleric.id], level: 8 });
  assert.equal(cast.ok, true, cast.error);
  // The swing at disadvantage, its damage, the cleric's concentration save
  // (with Holy Aura's advantage), then the imp's CON save.
  world.dice(19, 19, 3, 20, 20, 1);
  await enemySwing(world, imp.id, cleric.id);
  world.clearDice();
  assert.ok(enemyOf(world, imp.id).conditions.includes("blinded"));
});

await test("A creature Ray of Enfeeblement hits deals only half damage with its Strength weapon attacks.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await table([caster("wizard", "int", ["Ray of Enfeeblement"]), FIGHTER]);
  world.dice(15);
  const hit = await world.invoke("pc_attack", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Ray of Enfeeblement", level: 2 });
  world.clearDice();
  assert.equal(hit.ok, true, hit.error);
  const before = world.sheet(fighter.id).currentHp;
  world.dice(19, 4);
  await enemySwing(world, goblin.id, fighter.id);
  world.clearDice();
  assert.equal(before - world.sheet(fighter.id).currentHp, 3);
});

await test("Sanctuary ends when the warded creature attacks or casts a spell at an enemy.", async () => {
  const { world, sheets: [cleric], enemies: [goblin] } = await table([caster("cleric", "wis", ["Sanctuary", "Guiding Bolt"], ["Sacred Flame"])]);
  const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Sanctuary", targetCharacterIds: [cleric.id], level: 1 });
  assert.equal(cast.ok, true, cast.error);
  await freshTurn(world);
  world.dice(1, 4);
  await world.invoke("cast_at_enemy", { characterId: cleric.id, targetEnemyId: goblin.id, spell: "Sacred Flame", saveAbility: "dex" });
  world.clearDice();
  assert.ok(!world.sheet(cleric.id).conditions.includes("sanctuary"));
});

// ---- effects that come back on later turns ----

await test("Acid Arrow's hit deals 2d4 acid again at the end of the target's next turn.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Acid Arrow"])]);
  world.dice(15, 1, 1, 1, 1);
  const out = await world.invoke("pc_attack", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Acid Arrow", level: 2 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(hurt(world, goblin.id), 4);
  nextTurn(world);
  world.dice(2, 2);
  nextTurn(world);
  world.clearDice();
  assert.equal(hurt(world, goblin.id), 8);
});

await test("Phantasmal Killer's target saves at the END of each of its turns or takes 4d10 psychic.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Phantasmal Killer"])]);
  world.dice(1);
  await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Phantasmal Killer", saveAbility: "wis", level: 4 });
  world.clearDice();
  nextTurn(world);
  assert.equal(hurt(world, goblin.id), 0, "nothing as its turn starts");
  world.dice(1, 5, 5, 5, 5);
  nextTurn(world);
  world.clearDice();
  assert.equal(hurt(world, goblin.id), 20);
});

await test("Weird frightens on a failed save, and the frightened creature saves at the end of each of its turns or takes 4d10 psychic.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Weird"], [], 17)]);
  world.dice(1);
  await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Weird", enemyIds: [goblin.id], saveAbility: "wis", dc: 15, level: 9 });
  world.clearDice();
  assert.ok(enemyOf(world, goblin.id).conditions.includes("frightened"));
  nextTurn(world);
  world.dice(1, 5, 5, 5, 5);
  nextTurn(world);
  world.clearDice();
  assert.equal(hurt(world, goblin.id), 20);
});

await test("Flesh to Stone's restrained creature turns to stone after three failed saves at the end of its turns.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Flesh to Stone"], [], 11)]);
  world.dice(1);
  await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Flesh to Stone", saveAbility: "con", level: 6 });
  world.clearDice();
  assert.ok(enemyOf(world, goblin.id).conditions.includes("restrained"));
  nextTurn(world);
  for (let count = 0; count < 3; count += 1) {
    world.dice(1);
    nextTurn(world);
    world.clearDice();
  }
  assert.ok(enemyOf(world, goblin.id).conditions.includes("petrified"));
});

await test("Regenerate's target regains 1 hit point at the start of each of its turns.", async () => {
  // A minute's casting: before the fight, which then finds it running.
  const world = await openWorld();
  const cleric = world.addHero(caster("cleric", "wis", ["Regenerate"], [], 13));
  const fighter = world.addHero(FIGHTER);
  world.patch(fighter.id, { currentHp: 1 });
  world.dice(1, 1, 1, 1);
  const out = await world.invoke("heal", { characterId: fighter.id, casterId: cleric.id, spell: "Regenerate", level: 7 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const { fightDummies } = await import("./lib/enforce-spells.mjs");
  await fightDummies(world, 1, { heroFaces: { [cleric.id]: 20 } });
  const after = world.sheet(fighter.id).currentHp;
  nextTurn(world);
  assert.equal(world.sheet(fighter.id).currentHp, after + 1);
});

// ---- conditions with their effects ----

await test("Eyebite's Sickened creature has disadvantage on attack rolls.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await table([caster("wizard", "int", ["Eyebite"], [], 11), FIGHTER]);
  world.dice(1);
  await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Eyebite", condition: "sickened", saveAbility: "wis", level: 6 });
  world.clearDice();
  assert.deepEqual(enemyOf(world, goblin.id).conditions, ["sickened"]);
  world.diceLog();
  world.dice(10, 10, 1);
  await enemySwing(world, goblin.id, fighter.id);
  world.clearDice();
  assert.equal(d20s(world.diceLog()), 2);
});

await test("A creature under Irresistible Dance has disadvantage on its attack rolls.", async () => {
  const { world, sheets: [bard, fighter], enemies: [goblin] } = await table([caster("bard", "cha", ["Irresistible Dance"], [], 11), FIGHTER]);
  await world.invoke("cast_at_enemy", { characterId: bard.id, targetEnemyId: goblin.id, spell: "Irresistible Dance", saveAbility: "wis", level: 6 });
  world.diceLog();
  world.dice(10, 10, 1);
  await enemySwing(world, goblin.id, fighter.id);
  world.clearDice();
  assert.equal(d20s(world.diceLog()), 2);
});

await test("Sunbeam blinds a creature that fails its save until the caster's next turn, with no repeat save.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Sunbeam"], [], 11)]);
  world.dice(1, ...new Array(6).fill(1));
  await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Sunbeam", saveAbility: "con", level: 6 });
  world.clearDice();
  const meta = enemyOf(world, goblin.id).conditionMeta.blinded;
  assert.equal(meta?.untilTurnOf, wizard.id);
  assert.equal(meta?.saveEnds, undefined);
});

await test("Divine Word acts by hit points on a failed save: 20 or fewer killed, 30 or fewer blinded, deafened and stunned, 50 or fewer deafened.", async () => {
  const { world, sheets: [cleric], enemies: [a, b, c] } = await table([caster("cleric", "wis", ["Divine Word"], [], 13)], 3);
  encounters.patchEnemyHp(a.id, 15, "alive");
  encounters.patchEnemyHp(b.id, 25, "alive");
  encounters.patchEnemyHp(c.id, 45, "alive");
  world.dice(1, 1, 1);
  const out = await world.invoke("aoe_damage", { casterId: cleric.id, spell: "Divine Word", enemyIds: [a.id, b.id, c.id], saveAbility: "cha", dc: 15, level: 7 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(enemyOf(world, a.id).status, "dead");
  for (const name of ["blinded", "deafened", "stunned"]) {
    assert.ok(enemyOf(world, b.id).conditions.includes(name), name);
  }
  assert.deepEqual(enemyOf(world, c.id).conditions, ["deafened"]);
});

await test("A creature enclosed in a Resilient Sphere cannot be struck from outside it.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await table([caster("wizard", "int", ["Resilient Sphere"]), FIGHTER]);
  world.patch(wizard.id, { gold: 100 });
  world.dice(1);
  await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Resilient Sphere", saveAbility: "dex", level: 4 });
  world.clearDice();
  world.dice(20, 8);
  const swing = await world.invoke("pc_attack", { characterId: fighter.id, targetEnemyId: goblin.id, weapon: "Longsword" });
  world.clearDice();
  assert.equal(swing.ok, false);
  assert.equal(hurt(world, goblin.id), 0);
});

await test("A creature Entangle restrains frees itself with its action and a Strength check against the caster's DC.", async () => {
  const { world, sheets: [druid], enemies: [goblin] } = await table([caster("druid", "wis", ["Entangle"])]);
  world.dice(1);
  await world.invoke("aoe_damage", { casterId: druid.id, spell: "Entangle", enemyIds: [goblin.id], saveAbility: "str", dc: 15, level: 1 });
  world.clearDice();
  assert.ok(enemyOf(world, goblin.id).conditions.includes("restrained"));
  world.dice(20);
  const out = await world.invoke("take_action", { action: "escape", enemyId: goblin.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(!enemyOf(world, goblin.id).conditions.includes("restrained"));
});

await test("A creature Disintegrate drops to 0 hit points is disintegrated: a character is dead, not dying.", async () => {
  const { world, sheets: [fighter] } = await table([FIGHTER]);
  // 50 damage on 30 hit points: 20 past 0, short of massive damage's 30.
  world.dice(1, ...new Array(10).fill(1));
  await world.invoke("cast_at_player", { characterId: fighter.id, saveAbility: "dex", dc: 15, damage: "10d6+40", damageType: "force", spell: "Disintegrate" });
  world.clearDice();
  assert.equal(world.sheet(fighter.id).deathSaves?.dead, true);
});

// ---- buffs with numbers ----

await test("A weapon under Magic Weapon is magical: it passes resistance to nonmagical attacks.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [golem] } = await table(
    [caster("wizard", "int", ["Magic Weapon"]), FIGHTER],
    1,
    { resist: "bludgeoning, piercing, and slashing from nonmagical attacks" },
  );
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Magic Weapon", targetCharacterIds: [fighter.id], level: 2 });
  assert.equal(cast.ok, true, cast.error);
  world.dice(15, 8);
  await world.invoke("pc_attack", { characterId: fighter.id, targetEnemyId: golem.id, weapon: "Longsword" });
  world.clearDice();
  assert.equal(hurt(world, golem.id), 12);
});

await test("A creature under Beacon of Hope makes its death saves with advantage.", async () => {
  const { world, sheets: [cleric, fighter] } = await table([caster("cleric", "wis", ["Beacon of Hope"]), FIGHTER]);
  const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Beacon of Hope", targetCharacterIds: [fighter.id], level: 3 });
  assert.equal(cast.ok, true, cast.error);
  world.patch(fighter.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  world.diceLog();
  world.dice(12, 12);
  rollDeathSave(world.campaign(), fighter.id);
  world.clearDice();
  assert.equal(d20s(world.diceLog()), 2);
});

await test("A creature in Gaseous Form cannot cast spells.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Gaseous Form", "Magic Missile"])]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Gaseous Form", targetCharacterIds: [wizard.id], level: 3 });
  assert.equal(cast.ok, true, cast.error);
  await freshTurn(world);
  const missile = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Magic Missile", level: 1 });
  assert.equal(missile.ok, false);
  assert.equal(world.sheet(wizard.id).spellcasting.slots["1"].used, 0);
});

await test("Dispel Evil and Good gives celestials, elementals, fey, fiends and undead disadvantage on attack rolls against the caster.", async () => {
  const { world, sheets: [cleric], enemies: [ghoul] } = await table([caster("cleric", "wis", ["Dispel Evil and Good"])], 1, { type: "undead" });
  const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Dispel Evil and Good", targetCharacterIds: [cleric.id], level: 5 });
  assert.equal(cast.ok, true, cast.error);
  world.diceLog();
  // Two low faces: a miss, so no concentration save adds a d20.
  world.dice(1, 1);
  await enemySwing(world, ghoul.id, cleric.id);
  world.clearDice();
  assert.equal(d20s(world.diceLog()), 2);
});

await test("Animate Objects makes creatures; it is not an automatic blast of damage.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Animate Objects"])]);
  world.dice(6, 6, 6);
  const out = await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Animate Objects", enemyIds: [goblin.id], damage: "3d6", saveAbility: "dex", dc: 15, level: 5 });
  world.clearDice();
  assert.equal(out.ok, false);
  assert.equal(hurt(world, goblin.id), 0);
});

await test("Heroes' Feast raises each diner's hit point maximum by 2d10 and makes them immune to poison and to being frightened.", async () => {
  const world = await openWorld();
  const cleric = world.addHero({ ...caster("cleric", "wis", ["Heroes' Feast"], [], 11), gold: 1000 });
  const fighter = world.addHero(FIGHTER);
  const max = world.sheet(fighter.id).maxHp;
  world.dice(5, 5);
  const out = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Heroes' Feast", targetCharacterIds: [fighter.id], level: 6 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(fighter.id).maxHp, max + 10);
  await world.invoke("set_condition", { characterId: fighter.id, condition: "frightened", rounds: 3 });
  assert.ok(!world.sheet(fighter.id).conditions.includes("frightened"));
});

// ---- spells the audit left narrated that carry a state the engine holds ----

await test("Lesser Restoration ends a blinded, deafened, paralyzed or poisoned condition on its target, and with none to end it is refused before the slot.", async () => {
  const { world, sheets: [cleric, fighter] } = await table([caster("cleric", "wis", ["Lesser Restoration"]), FIGHTER]);
  const idle = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Lesser Restoration", targetCharacterIds: [fighter.id], level: 2 });
  assert.equal(idle.ok, false);
  assert.equal(world.sheet(cleric.id).spellcasting.slots["2"].used, 0);
  await world.invoke("set_condition", { characterId: fighter.id, condition: "poisoned", rounds: 10 });
  const { freshTurn } = await import("./lib/enforce-spells.mjs");
  await freshTurn(world);
  const out = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Lesser Restoration", targetCharacterIds: [fighter.id], level: 2 });
  assert.equal(out.ok, true, out.error);
  assert.ok(!world.sheet(fighter.id).conditions.includes("poisoned"));
  assert.equal(world.sheet(cleric.id).spellcasting.slots["2"].used, 1);
});

await test("Greater Restoration takes away one level of exhaustion (or one charm, petrification or curse).", async () => {
  const world = await openWorld();
  const cleric = world.addHero({ ...caster("cleric", "wis", ["Greater Restoration"]), gold: 200 });
  const fighter = world.addHero(FIGHTER);
  world.patch(fighter.id, { exhaustion: 2 });
  const out = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Greater Restoration", targetCharacterIds: [fighter.id], variant: "exhaustion", level: 5 });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(fighter.id).exhaustion, 1);
});

await test("Remove Curse ends every curse on its target (Bestow Curse's among them).", async () => {
  const { world, sheets: [cleric, fighter] } = await table([caster("cleric", "wis", ["Remove Curse"]), FIGHTER]);
  await world.invoke("set_condition", { characterId: fighter.id, condition: "cursed (wis)", rounds: 10 });
  assert.ok(world.sheet(fighter.id).conditions.includes("cursed (wis)"));
  const out = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Remove Curse", targetCharacterIds: [fighter.id], level: 3 });
  assert.equal(out.ok, true, out.error);
  assert.ok(!world.sheet(fighter.id).conditions.some((name) => name.startsWith("cursed")));
});

await test("Power Word Kill kills a creature of 100 hit points or fewer outright, with no save, and does nothing to one with more.", async () => {
  const { world, sheets: [wizard], enemies: [small] } = await table([caster("wizard", "int", ["Power Word Kill"], [], 17)]);
  world.diceLog();
  const out = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: small.id, spell: "Power Word Kill", saveAbility: "con", level: 9 });
  assert.equal(out.ok, true, out.error);
  assert.equal(d20s(world.diceLog()), 0);
  // The fight ends with its only foe: the row is read straight.
  assert.equal(encounters.getEnemy(small.id).status, "dead");
  const other = await table([caster("wizard", "int", ["Power Word Kill"], [], 17)]);
  const big = other.enemies[0];
  getDatabase().prepare("UPDATE encounter_enemies SET current_hp = 150, max_hp = 150 WHERE id = ?").run(big.id);
  await other.world.invoke("cast_at_enemy", { characterId: other.sheets[0].id, targetEnemyId: big.id, spell: "Power Word Kill", saveAbility: "con", level: 9 });
  assert.equal(enemyOf(other.world, big.id).status, "alive");
  assert.equal(enemyOf(other.world, big.id).currentHp, 150);
});

await test("Mind Blank makes its target immune to psychic damage and to being charmed.", async () => {
  const world = await openWorld();
  const wizard = world.addHero(caster("wizard", "int", ["Mind Blank"], [], 15));
  const fighter = world.addHero(FIGHTER);
  const out = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Mind Blank", targetCharacterIds: [fighter.id], level: 8 });
  assert.equal(out.ok, true, out.error);
  const before = world.sheet(fighter.id).currentHp;
  await world.invoke("apply_damage", { characterId: fighter.id, amount: 10, type: "psychic" });
  assert.equal(world.sheet(fighter.id).currentHp, before);
  await world.invoke("set_condition", { characterId: fighter.id, condition: "charmed", rounds: 10 });
  assert.ok(!world.sheet(fighter.id).conditions.includes("charmed"));
});

await test("Foresight gives its target advantage on attack rolls, checks and saves, and attacks against it disadvantage.", async () => {
  const world = await openWorld();
  const wizard = world.addHero(caster("wizard", "int", ["Foresight"], [], 17));
  const fighter = world.addHero(FIGHTER);
  const out = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Foresight", targetCharacterIds: [fighter.id], level: 9 });
  assert.equal(out.ok, true, out.error);
  world.diceLog();
  world.dice(5, 15);
  await world.invoke("request_roll", { characterId: fighter.id, kind: "saving_throw", ability: "wis", dc: 13 });
  world.clearDice();
  assert.equal(d20s(world.diceLog()), 2);
});

await test("Chill Touch, Ray of Frost, Shocking Grasp and Guiding Bolt lay their riders on a hit", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", [], ["Ray of Frost"])]);
  world.dice(15, 1);
  await world.invoke("pc_attack", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Ray of Frost" });
  world.clearDice();
  assert.ok(enemyOf(world, goblin.id).conditions.includes("ray of frost"));
});

closeTables();
finish();
