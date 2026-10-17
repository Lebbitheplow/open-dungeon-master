// The creature a sheet is, and the hit points it holds, stay true
// (docs/character-table-rules-audit-2026-10-17.md, workstream 4: F17, F18,
// F19, F20, F21, F22):
//
//   - a maximum-HP drain can reach 0 (the creature dies), and a long rest
//     gives back exactly what was taken.
//   - Aid lifting a dying creature above 0 wakes it and clears the track.
//   - Regenerate's hit point reaches a creature at 0 and wakes it.
//   - Polymorph is the beast's saves and defenses, not the character's.
//   - Shield of Faith and Haste count on a beast form's AC.
//   - mixed damage keeps its types to the end: poison immunity stops the
//     poison half of a bite.
//
// SRD 5.1 as printed. Dice forced; every check reads a stored row.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";
import { fightDummies } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-creature-state");
const { longRestPatch } = await import("../src/lib/dm/rest-logic.ts");
const { spellTurnStart } = await import("../src/lib/dm/spell-aura.ts");
const { computeSheetDerived, effectiveAcFor } = await import("../src/lib/srd/index.ts");
const { pcResistances } = await import("../src/lib/dm/condition-logic.ts");

const DRAIN = { name: "Life Drain", toHit: 8, damage: "2d10", type: "necrotic", onHit: { save: "con", dc: 13, drainMaxHp: "total" } };

await test("F17: a 20-point drain on a maximum of 10 kills, and a rest gives back exactly 10", async () => {
  const { world, sheets: [hero], enemies: [wight] } = await table([{ ...FIGHTER, maxHp: 10 }], 1, { attacks: [DRAIN] });
  world.patch(hero.id, { tempHp: 30 });
  world.dice(15, 10, 10, 1);
  const out = await world.invoke("enemy_attack", { enemyId: wight.id, targetCharacterId: hero.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const drained = world.sheet(hero.id);
  assert.equal(drained.maxHp, 0, "the maximum reaches 0");
  assert.equal(drained.deathSaves?.dead, true, "and the creature dies");
  world.patch(hero.id, longRestPatch(drained));
  assert.equal(world.sheet(hero.id).maxHp, 10, "back to its own 10, not 21");
});

await test("F17: a drain that leaves some maximum gives back the same on a rest", async () => {
  const { world, sheets: [hero], enemies: [wight] } = await table([{ ...FIGHTER, maxHp: 40 }], 1, { attacks: [DRAIN] });
  world.patch(hero.id, { tempHp: 30 });
  world.dice(15, 5, 5, 1);
  await world.invoke("enemy_attack", { enemyId: wight.id, targetCharacterId: hero.id });
  world.clearDice();
  assert.equal(world.sheet(hero.id).maxHp, 30);
  world.patch(hero.id, longRestPatch(world.sheet(hero.id)));
  assert.equal(world.sheet(hero.id).maxHp, 40);
});

await test("F18: Aid on a dying character wakes them and clears the death track", async () => {
  const world = await openWorld();
  const priest = world.addHero(caster("cleric", "wis", ["Aid"]));
  const fighter = world.addHero(FIGHTER);
  world.patch(fighter.id, { currentHp: 0, deathSaves: { successes: 0, failures: 1, stable: false, dead: false }, conditions: ["unconscious"] });
  const out = await world.invoke("cast_buff", { characterId: priest.id, targetCharacterIds: [fighter.id], spell: "Aid" });
  assert.equal(out.ok, true, out.error);
  const now = world.sheet(fighter.id);
  assert.equal(now.currentHp, 5);
  assert.equal(now.conditions.includes("unconscious"), false);
  assert.equal(now.deathSaves, null);
  world.close();
});

await test("F18: healing leaves a spell's sleep in place", async () => {
  const world = await openWorld();
  const fighter = world.addHero(FIGHTER);
  world.patch(fighter.id, {
    currentHp: 0,
    deathSaves: { successes: 0, failures: 0, stable: false, dead: false },
    conditions: ["unconscious"],
    conditionMeta: { unconscious: { spell: "Sleep", source: "x", rounds: 10, endsOnDamage: true, others: [{}] } },
  });
  const out = await world.invoke("heal", { characterId: fighter.id, amount: 3 });
  assert.equal(out.ok, true, out.error);
  const now = world.sheet(fighter.id);
  assert.ok(now.conditions.includes("unconscious"), "still asleep");
  assert.equal(now.conditionMeta.unconscious.spell, "Sleep");
  world.close();
});

await test("F19: Regenerate's hit point reaches a character at 0 and wakes them", async () => {
  const world = await openWorld();
  const bard = world.addHero(caster("bard", "cha", ["Regenerate"], [], 13));
  const fighter = world.addHero(FIGHTER);
  const cast = await world.invoke("heal", { characterId: fighter.id, casterId: bard.id, spell: "Regenerate" });
  assert.equal(cast.ok, true, cast.error);
  await fightDummies(world);
  const held = world.sheet(fighter.id);
  world.patch(fighter.id, { currentHp: 0, deathSaves: { successes: 0, failures: 1, stable: false, dead: false }, conditions: [...held.conditions, "unconscious"] });
  spellTurnStart(world.campaign(), world.encounter(), [fighter.id]);
  const now = world.sheet(fighter.id);
  assert.equal(now.currentHp, 1);
  assert.equal(now.conditions.includes("unconscious"), false);
  assert.equal(now.deathSaves, null);
});

await test("F20: a polymorphed tiefling fighter has a brown bear's saves and no fire resistance", async () => {
  const { world, sheets: [mage, fighter] } = await table([
    caster("wizard", "int", ["Polymorph"]),
    { ...FIGHTER, race: "tiefling", proficiencies: { ...FIGHTER.proficiencies, saves: ["str", "con"] } },
  ]);
  const out = await world.invoke("cast_buff", { characterId: mage.id, spell: "Polymorph", variant: "Brown Bear", targetCharacterIds: [fighter.id] });
  assert.equal(out.ok, true, out.error);
  const now = world.sheet(fighter.id);
  assert.equal(computeSheetDerived(now).saves.str, 4, "the bear's +4, not the fighter's proficiency on top");
  assert.equal(pcResistances(now).includes("fire"), false, "the tiefling's ancestry is not the bear's");
});

test("F21: a beast form's AC takes Shield of Faith and Haste", () => {
  const ac = effectiveAcFor({
    ...FIGHTER,
    abilities: { str: 16, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
    equipment: [],
    features: [],
    conditions: ["shield of faith", "hasted"],
    conditionMeta: {},
    wildShape: { kind: "wild_shape", form: "Brown Bear", beastAc: 11, beastHp: 34, beastMaxHp: 34 },
  });
  assert.equal(ac, 15);
});

await test("F22: a bite of 5 piercing + 5 poison does 5 to a monk immune to poison", async () => {
  const { world, sheets: [monk], enemies: [snake] } = await table([{ class: "monk", level: 10, maxHp: 30 }], 1, {
    attacks: [{ name: "Bite", toHit: 8, damage: "1d6+1d6", type: "piercing", riders: [{ dice: "1d6", type: "poison" }] }],
  });
  world.patch(monk.id, { currentHp: 30 });
  world.dice(15, 5, 5);
  const out = await world.invoke("enemy_attack", { enemyId: snake.id, targetCharacterId: monk.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(monk.id).currentHp, 25);
});

closeTables();
finish();
