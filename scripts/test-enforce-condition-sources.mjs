// Each source of a condition keeps its own events and its own end
// (docs/character-table-rules-audit-2026-10-17.md, workstream 3: F07, F08,
// F13, F14, F15, F16, F23, F24, F25):
//
//   - a spell that paralyzes a concentrating monster ends its concentration.
//   - Draconic Presence taking up concentration ends the spell held before.
//   - damage settles each instance of a condition on its own: Hypnotic
//     Pattern's ends, Hideous Laughter's saves; casting a spell ends
//     Invisibility and leaves Greater Invisibility.
//   - a dominated character saves again when hurt.
//   - a monster's Hypnotic Pattern lays charmed AND incapacitated.
//   - False Life's temporary hit points go when the spell does.
//   - Black Tentacles crushes a restrained character at the start of its turn.
//   - Sleet Storm's concentration save does not wait on the DEX save failing.
//   - Flesh to Stone held for its whole minute leaves the creature stone.
//
// SRD 5.1 as printed. Dice forced; every check reads a stored row.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, enemyOf, FIGHTER, field, table } from "./lib/enforce-spell-kit.mjs";
import { layMap } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-condition-sources");
const { setEnemyConcentration } = await import("../src/lib/db/encounters.ts");
const { layOnEnemy } = await import("../src/lib/dm/spell-riders.ts");
const { spellEffectsOnEnemyDamage } = await import("../src/lib/dm/spell-effects.ts");
const { addConditionInstance } = await import("../src/lib/dm/condition-logic.ts");
const { endInvisibilityOnCast } = await import("../src/lib/dm/attack-marks.ts");
const { placeSpellZone } = await import("../src/lib/dm/zone-cast.ts");
const { zoneTurnStart } = await import("../src/lib/dm/zone-triggers.ts");
const { spellTurnStart } = await import("../src/lib/dm/spell-aura.ts");
const { beginTurns, endTurns } = await import("../src/lib/dm/turn-end.ts");
const { tickConcentrationClocks } = await import("../src/lib/dm/concentration-clock.ts");


await test("F07: Hold Person on a concentrating monster ends its concentration", async () => {
  const { world, sheets: [mage], enemies: [foe] } = await table([caster("wizard", "int", ["Hold Person"])]);
  setEnemyConcentration(foe.id, "Bless", 10);
  world.dice(1);
  const out = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: foe.id, spell: "Hold Person", level: 2 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(enemyOf(world, foe.id).conditions.includes("paralyzed"));
  assert.equal(enemyOf(world, foe.id).concentration, null);
});

await test("F07: a stun laid by a monster-spell path ends concentration too", async () => {
  const { world, enemies: [foe] } = await table([FIGHTER]);
  setEnemyConcentration(foe.id, "Bless", 10);
  layOnEnemy(foe.id, [["stunned", { spell: "Power Word Stun", source: "x", rounds: 10 }]]);
  assert.equal(enemyOf(world, foe.id).concentration, null);
});

await test("F08: Draconic Presence ends the spell its sorcerer held", async () => {
  const { world, sheets: [sorc] } = await table([caster("sorcerer", "cha", ["Blur"], [], 18, { subclass: "Draconic Bloodline" })]);
  const blur = await world.invoke("cast_buff", { characterId: sorc.id, spell: "Blur" });
  assert.equal(blur.ok, true, blur.error);
  world.dice(1);
  const presence = await world.invoke("use_resource", { characterId: sorc.id, resource: "Draconic Presence" });
  world.clearDice();
  assert.equal(presence.ok, true, presence.error);
  assert.equal(world.sheet(sorc.id).concentratingOn, "Draconic Presence");
  assert.equal(world.sheet(sorc.id).conditions.includes("blurred"), false, "Blur ended");
});

await test("F13: damage ends Hypnotic Pattern's incapacitation and gives Hideous Laughter's its own save", async () => {
  const { world, enemies: [foe] } = await table([FIGHTER]);
  layOnEnemy(foe.id, [["incapacitated", { spell: "Hypnotic Pattern", source: "a", rounds: 10, endsOnDamage: true }]]);
  layOnEnemy(foe.id, [["incapacitated", { spell: "Hideous Laughter", source: "b", rounds: 10, saveOnDamage: { ability: "wis", dc: 30, advantage: true } }]]);
  world.diceLog();
  world.dice(1, 1);
  spellEffectsOnEnemyDamage(foe.id);
  world.clearDice();
  const now = enemyOf(world, foe.id);
  assert.ok(now.conditions.includes("incapacitated"), "Laughter's failed save keeps it");
  assert.equal(now.conditionMeta.incapacitated.spell, "Hideous Laughter");
  assert.equal(now.conditionMeta.incapacitated.others, undefined, "Pattern's instance is gone");
  assert.equal(world.diceLog().filter((die) => die.sides === 20).length, 2, "the save, with advantage");
});

await test("F13: the same two in the other order", async () => {
  const { world, enemies: [foe] } = await table([FIGHTER]);
  layOnEnemy(foe.id, [["incapacitated", { spell: "Hideous Laughter", source: "b", rounds: 10, saveOnDamage: { ability: "wis", dc: 30, advantage: true } }]]);
  layOnEnemy(foe.id, [["incapacitated", { spell: "Hypnotic Pattern", source: "a", rounds: 10, endsOnDamage: true }]]);
  world.dice(1, 1);
  spellEffectsOnEnemyDamage(foe.id);
  world.clearDice();
  const now = enemyOf(world, foe.id);
  assert.ok(now.conditions.includes("incapacitated"));
  assert.equal(now.conditionMeta.incapacitated.spell, "Hideous Laughter");
});

await test("F13: casting ends Invisibility and leaves Greater Invisibility", async () => {
  const world = await openWorld();
  const hero = world.addHero(FIGHTER);
  let held = addConditionInstance([], {}, "invisible", { spell: "Invisibility", source: "a", rounds: 600 });
  held = addConditionInstance(held.conditions, held.meta, "invisible", { spell: "Greater Invisibility", source: "b", rounds: 10 });
  world.patch(hero.id, { conditions: held.conditions, conditionMeta: held.meta });
  endInvisibilityOnCast(world.campaignId, hero.id);
  const now = world.sheet(hero.id);
  assert.ok(now.conditions.includes("invisible"));
  assert.equal(now.conditionMeta.invisible.spell, "Greater Invisibility");
  world.close();
});

await test("F14: a dominated character saves again when hurt", async () => {
  const { world, sheets: [fighter], enemies: [foe] } = await table([FIGHTER], 1, {
    spells: ["Dominate Person"],
    spellcasting: { dc: 20, ability: "int", casterLevel: 9, spells: [{ name: "Dominate Person", level: 5 }], slots: { 5: 2 } },
  });
  world.dice(1);
  const cast = await world.invoke("cast_at_player", { characterId: fighter.id, casterEnemyId: foe.id, spell: "Dominate Person", saveAbility: "wis", dc: 20 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(world.sheet(fighter.id).conditions.includes("charmed"));
  world.diceLog();
  world.dice(20);
  const hurt = await world.invoke("apply_damage", { characterId: fighter.id, amount: 1, type: "force" });
  world.clearDice();
  assert.equal(hurt.ok, true, hurt.error);
  assert.ok(world.diceLog().some((die) => die.sides === 20), "a WIS save was rolled");
  assert.equal(world.sheet(fighter.id).conditions.includes("charmed"), false, "the natural 20 frees them");
});

await test("F15: a monster's Hypnotic Pattern lays charmed and incapacitated (single target)", async () => {
  const { world, sheets: [fighter], enemies: [foe] } = await table([FIGHTER], 1, {
    spells: ["Hypnotic Pattern"],
    spellcasting: { dc: 16, casterLevel: 5, spells: [{ name: "Hypnotic Pattern", level: 3 }], slots: { 3: 2 } },
  });
  world.dice(1);
  const cast = await world.invoke("cast_at_player", { characterId: fighter.id, casterEnemyId: foe.id, spell: "Hypnotic Pattern", saveAbility: "wis", dc: 16 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  const now = world.sheet(fighter.id).conditions;
  assert.ok(now.includes("charmed"));
  assert.ok(now.includes("incapacitated"), now.join(", "));
});

await test("F15: ... and through aoe_damage", async () => {
  const { world, sheets: [fighter], enemies: [foe] } = await table([FIGHTER], 1, {
    spells: ["Hypnotic Pattern"],
    spellcasting: { dc: 16, casterLevel: 5, spells: [{ name: "Hypnotic Pattern", level: 3 }], slots: { 3: 2 } },
  });
  world.dice(1);
  const cast = await world.invoke("aoe_damage", { casterEnemyId: foe.id, spell: "Hypnotic Pattern", characterIds: [fighter.id], saveAbility: "wis", dc: 16 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  const now = world.sheet(fighter.id).conditions;
  assert.ok(now.includes("charmed"));
  assert.ok(now.includes("incapacitated"), now.join(", "));
});

await test("F16: False Life's temporary hit points go when the spell does", async () => {
  const world = await openWorld();
  const mage = world.addHero(caster("wizard", "int", ["False Life"]));
  world.dice(4);
  const out = await world.invoke("cast_buff", { characterId: mage.id, spell: "False Life" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(mage.id).tempHp, 8);
  await world.invoke("pass_time", { amount: 2, unit: "hours" });
  assert.equal(world.sheet(mage.id).tempHp, 0);
  world.close();
});

await test("F16: temporary hit points from another source stay when False Life ends", async () => {
  const world = await openWorld();
  const mage = world.addHero(caster("wizard", "int", ["False Life"]));
  world.dice(4);
  await world.invoke("cast_buff", { characterId: mage.id, spell: "False Life" });
  world.clearDice();
  // A bigger pool from elsewhere replaces False Life's (they never stack).
  const other = await world.invoke("heal", { characterId: mage.id, amount: 12, temp: true });
  assert.equal(other.ok, true, other.error);
  await world.invoke("pass_time", { amount: 2, unit: "hours" });
  assert.equal(world.sheet(mage.id).tempHp, 12);
  world.close();
});

await test("F23: Black Tentacles crushes a restrained character at the start of its turn", async () => {
  const { world, sheets: [fighter], enemies: [foe] } = await table([FIGHTER]);
  await layMap(world, field(12), { [fighter.id]: { x: 5, y: 2 }, [foe.id]: { x: 9, y: 2 } });
  setEnemyConcentration(foe.id, "Black Tentacles", 10);
  placeSpellZone(world.campaign(), { spell: "Black Tentacles", caster: { kind: "enemy", id: foe.id, name: foe.displayName }, slotLevel: 4, dc: 15, at: { x: 5, y: 2 } });
  world.patch(fighter.id, { conditions: ["restrained"], conditionMeta: { restrained: { spell: "Black Tentacles", source: foe.id, slotLevel: 4 } } });
  const before = world.sheet(fighter.id).currentHp;
  world.dice(4, 4, 4);
  spellTurnStart(world.campaign(), world.encounter(), [fighter.id]);
  zoneTurnStart(world.campaign(), world.encounter(), [fighter.id]);
  world.clearDice();
  assert.equal(world.sheet(fighter.id).currentHp, before - 12, "3d6 once, no save");
});

await test("F24: Sleet Storm's concentration save comes whatever the DEX save does", async () => {
  const { world, sheets: [mage], enemies: [foe] } = await table([caster("wizard", "int", ["Blur"])]);
  const blur = await world.invoke("cast_buff", { characterId: mage.id, spell: "Blur" });
  assert.equal(blur.ok, true, blur.error);
  await layMap(world, field(12), { [mage.id]: { x: 5, y: 2 }, [foe.id]: { x: 9, y: 2 } });
  setEnemyConcentration(foe.id, "Sleet Storm", 10);
  placeSpellZone(world.campaign(), { spell: "Sleet Storm", caster: { kind: "enemy", id: foe.id, name: foe.displayName }, slotLevel: 3, dc: 15, at: { x: 5, y: 2 } });
  world.dice(20, 1);
  zoneTurnStart(world.campaign(), world.encounter(), [mage.id]);
  world.clearDice();
  assert.equal(world.sheet(mage.id).concentratingOn, null, "the failed CON save ends Blur");
  assert.equal(world.sheet(mage.id).conditions.includes("prone"), false, "the DEX save kept them up");
});

await test("F25: Flesh to Stone held for its full minute leaves the creature petrified", async () => {
  const { world, sheets: [mage], enemies: [foe] } = await table([caster("wizard", "int", ["Flesh to Stone"], [], 13)]);
  world.dice(1);
  const out = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: foe.id, spell: "Flesh to Stone" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  for (let i = 0; i < 3; i += 1) {
    beginTurns(world.campaign(), world.encounter().id, [foe.id]);
    world.dice(1);
    endTurns(world.campaign(), world.encounter().id, [foe.id]);
    world.clearDice();
  }
  assert.ok(enemyOf(world, foe.id).conditions.includes("petrified"));
  tickConcentrationClocks(world.campaign(), 10, (id) => id === mage.id);
  assert.ok(enemyOf(world, foe.id).conditions.includes("petrified"), "stone for good");
});

await test("F25: Flesh to Stone's petrification ends if concentration breaks early", async () => {
  const { world, sheets: [mage], enemies: [foe] } = await table([caster("wizard", "int", ["Flesh to Stone", "Blur"], [], 13)]);
  world.dice(1);
  await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: foe.id, spell: "Flesh to Stone" });
  world.clearDice();
  for (let i = 0; i < 3; i += 1) {
    beginTurns(world.campaign(), world.encounter().id, [foe.id]);
    world.dice(1);
    endTurns(world.campaign(), world.encounter().id, [foe.id]);
    world.clearDice();
  }
  const { breakConcentration } = await import("../src/lib/dm/concentration.ts");
  breakConcentration(world.campaign(), null, mage.id, "hit");
  assert.equal(enemyOf(world, foe.id).conditions.includes("petrified"), false);
});

closeTables();
finish();
