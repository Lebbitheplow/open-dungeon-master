// Every damage roll the server makes is a dice card the table sees, named for
// who made it and whom it hit (src/lib/dm/roll-card.ts): the spells that
// strike at a turn's start or end, the zones on enemies and on characters, a
// retort, the costs a caster pays in their own hit points, a character's
// fall, and harm no character dealt to an object. A flat amount rolls no dice
// and has no card. test-enforce-roll-attacker.mjs covers the attacks.
import assert from "node:assert/strict";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { caster, closeTables, enemyOf, FIGHTER, field, table } from "./lib/enforce-spell-kit.mjs";
import { enemySwing, nextTurn } from "./lib/enforce-spell-tail.mjs";
import { layMap } from "./lib/enforce-spells.mjs";
import { board, holdTurn, nextTurn as nextZoneTurn } from "./lib/enforce-zones.mjs";

const { test, finish } = suite("test-enforce-damage-cards");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { rollCard } = await import("../src/lib/dm/roll-card.ts");

const snapshot = (world) => new Set(listRecentRolls(world.campaignId, 200).map((roll) => roll.id));
const cardsSince = (world, before) =>
  listRecentRolls(world.campaignId, 200).filter((roll) => !before.has(roll.id) && roll.kind === "damage");
const asSheet = (world, id) => ({ kind: "sheet", id, name: world.sheet(id).name });

// The one damage card stored since `before`, as the table sees it.
function expectCard(world, before, { attacker, detail, characterId, total }) {
  const cards = cardsSince(world, before);
  assert.equal(cards.length, 1, `expected one damage card, got ${JSON.stringify(cards.map((card) => card.detail))}`);
  const [card] = cards;
  assert.deepEqual(card.attacker, attacker);
  assert.equal(card.detail, detail);
  assert.equal(card.characterId, characterId);
  assert.equal(card.visibility, "public");
  if (total !== undefined) {
    assert.equal(card.total, total);
  }
}

// ---- at a turn's start or end ----

await test("Spirit Guardians: the damage on an enemy starting its turn in the aura is the cleric's card.", async () => {
  const { world, sheets: [priest], enemies: [goblin] } = await table([caster("cleric", "wis", ["Spirit Guardians"])]);
  await layMap(world, field(), { [priest.id]: { x: 1, y: 2 }, [goblin.id]: { x: 2, y: 2 } });
  const cast = await world.invoke("cast_buff", { characterId: priest.id, spell: "Spirit Guardians", level: 3 });
  assert.equal(cast.ok, true, cast.error);
  const before = snapshot(world);
  world.dice(1, 4, 4, 4);
  nextTurn(world);
  world.clearDice();
  expectCard(world, before, { attacker: asSheet(world, priest.id), detail: `Spirit Guardians vs ${goblin.displayName}`, characterId: priest.id, total: 12 });
});

await test("Phantasmal Killer: the damage at the end of the target's turn is the caster's card.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Phantasmal Killer"])]);
  world.dice(1);
  await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Phantasmal Killer", saveAbility: "wis", level: 4 });
  world.clearDice();
  nextTurn(world);
  const before = snapshot(world);
  world.dice(1, 5, 5, 5, 5);
  nextTurn(world);
  world.clearDice();
  expectCard(world, before, { attacker: asSheet(world, wizard.id), detail: `Phantasmal Killer vs ${goblin.displayName}`, characterId: wizard.id, total: 20 });
});

await test("Acid Arrow: the second burn at the end of the target's next turn is the caster's card.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Acid Arrow"])]);
  world.dice(15, 1, 1, 1, 1);
  const out = await world.invoke("pc_attack", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Acid Arrow", level: 2 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  nextTurn(world);
  const before = snapshot(world);
  world.dice(2, 2);
  nextTurn(world);
  world.clearDice();
  expectCard(world, before, { attacker: asSheet(world, wizard.id), detail: `Acid Arrow (second burn) vs ${goblin.displayName}`, characterId: wizard.id, total: 4 });
  assert.equal(enemyOf(world, goblin.id).maxHp - enemyOf(world, goblin.id).currentHp, 8);
});

// ---- zones ----

await test("Moonbeam: the damage on an enemy starting its turn in the beam is the druid's card.", async () => {
  const { world, sheets: [druid, fighter], enemies: [goblin] } = await board([caster("druid", "wis", ["Moonbeam"]), FIGHTER], { 0: { x: 2, y: 4 }, 1: { x: 4, y: 8 }, e0: { x: 14, y: 4 } });
  const cast = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Moonbeam", level: 2, atX: 14, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  holdTurn(world, fighter.id);
  const before = snapshot(world);
  world.dice(1, 5, 5);
  nextZoneTurn(world);
  world.clearDice();
  expectCard(world, before, { attacker: asSheet(world, druid.id), detail: `Moonbeam vs ${goblin.displayName}`, characterId: druid.id, total: 10 });
});

await test("Wall of Fire: the damage on a character ending their turn by the wall is the caster's card, about that character.", async () => {
  const { world, sheets: [wizard, fighter] } = await board([caster("wizard", "int", ["Wall of Fire"]), FIGHTER], [{ x: 4, y: 4 }, { x: 13, y: 4 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Wall of Fire", level: 4, atX: 12, atY: 0, towardX: 12, towardY: 8 });
  assert.equal(cast.ok, true, cast.error);
  holdTurn(world, fighter.id);
  const before = snapshot(world);
  world.dice(1, 1, 1, 1, 1);
  nextZoneTurn(world);
  world.clearDice();
  expectCard(world, before, { attacker: asSheet(world, wizard.id), detail: `Wall of Fire vs ${world.sheet(fighter.id).name}`, characterId: fighter.id, total: 5 });
});

// ---- a retort ----

await test("Fire Shield: the burn on a creature that hits the holder is the holder's card.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Fire Shield"])]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Fire Shield", variant: "fire shield (cold)", level: 4 });
  assert.equal(cast.ok, true, cast.error);
  const before = snapshot(world);
  world.dice(19, 3, 4, 4);
  await enemySwing(world, goblin.id, wizard.id);
  world.clearDice();
  const burn = cardsSince(world, before).filter((card) => card.detail.startsWith("Fire Shield"));
  assert.equal(burn.length, 1);
  assert.deepEqual(burn[0].attacker, asSheet(world, wizard.id));
  assert.equal(burn[0].detail, `Fire Shield vs ${goblin.displayName}`);
  assert.equal(burn[0].total, 8);
});

await test("Bestow Curse: the extra necrotic when the curser's spell harms the creature is the curser's card.", async () => {
  const { world, sheets: [cleric], enemies: [goblin] } = await table([caster("cleric", "wis", ["Bestow Curse"], ["Sacred Flame"])]);
  world.dice(1);
  const cursed = await world.invoke("cast_at_enemy", { characterId: cleric.id, targetEnemyId: goblin.id, spell: "Bestow Curse", condition: "necrotic", saveAbility: "wis", level: 3 });
  world.clearDice();
  assert.equal(cursed.ok, true, cursed.error);
  const { freshTurn } = await import("./lib/enforce-spells.mjs");
  await freshTurn(world);
  const before = snapshot(world);
  // Its DEX save, Sacred Flame's 2d8 at 9th level, the curse's 1d8.
  world.dice(1, 5, 5, 3);
  const out = await world.invoke("cast_at_enemy", { characterId: cleric.id, targetEnemyId: goblin.id, spell: "Sacred Flame", saveAbility: "dex" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const burn = cardsSince(world, before).filter((card) => card.detail.startsWith("Bestow Curse"));
  assert.equal(burn.length, 1, "no Bestow Curse card");
  assert.deepEqual(burn[0].attacker, asSheet(world, cleric.id));
  assert.equal(burn[0].detail, `Bestow Curse vs ${goblin.displayName}`);
  assert.equal(burn[0].total, 3);
});

// ---- costs paid in the caster's own hit points ----

await test("Overchannel's second use: the necrotic it costs is the wizard's card, with no attacker.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Fireball"], [], 14)]);
  world.patch(wizard.id, { features: [...world.sheet(wizard.id).features, { name: "Overchannel", source: "test" }] });
  world.dice(1);
  await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Fireball", enemyIds: [goblin.id], saveAbility: "dex", dc: 15, level: 3, overchannel: true });
  world.clearDice();
  const { freshTurn } = await import("./lib/enforce-spells.mjs");
  await freshTurn(world);
  const before = snapshot(world);
  world.dice(1, ...new Array(6).fill(1));
  await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Fireball", enemyIds: [goblin.id], saveAbility: "dex", dc: 15, level: 3, overchannel: true });
  world.clearDice();
  const cost = cardsSince(world, before).find((card) => card.detail === "Overchannel");
  assert.ok(cost, "no Overchannel card");
  assert.equal(cost.attacker, null);
  assert.equal(cost.characterId, wizard.id);
  assert.equal(cost.total, 6);
});

await test("Contact Other Plane: the psychic backlash of a failed save is the caster's card, with no attacker.", async () => {
  const world = await openWorld();
  const wizard = world.addHero(caster("wizard", "int", ["Contact Other Plane"], [], 9));
  const before = snapshot(world);
  world.dice(1, 1, 1, 1, 1, 1, 1);
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Contact Other Plane", level: 5 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  expectCard(world, before, { attacker: null, detail: "Contact Other Plane", characterId: wizard.id, total: 6 });
  world.close();
});

// ---- hazards and objects ----

await test("A character's fall is a card with no attacker that names who fell, as an enemy's fall is.", async () => {
  const { world, sheets: [fighter] } = await table([{ ...FIGHTER, name: "Aria" }]);
  const before = snapshot(world);
  world.dice(2, 2, 2);
  const out = await world.invoke("apply_hazard", { type: "falling", characterIds: [fighter.id], feet: 30 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  expectCard(world, before, { attacker: null, detail: "30 ft fall (3d6 bludgeoning) on Aria", characterId: fighter.id, total: 6 });
});

await test("A potion of poison's damage is a card about the drinker, with no attacker.", async () => {
  const { world, sheets: [fighter] } = await table([{ ...FIGHTER, name: "Aria", equipment: [...FIGHTER.equipment, { name: "Potion of Poison", qty: 1 }] }]);
  const before = snapshot(world);
  world.dice(2, 2, 2, 20);
  const out = await world.invoke("use_item", { characterId: fighter.id, item: "Potion of Poison" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  expectCard(world, before, { attacker: null, detail: "Potion of Poison: it was poison", characterId: fighter.id, total: 6 });
});

await test("Dice of harm no character dealt to an object are a card with no attacker that names the object.", async () => {
  const { world } = await table([FIGHTER]);
  const before = snapshot(world);
  world.dice(3, 3);
  const out = await world.invoke("damage_object", { name: "the oak door", material: "wood", size: "medium", damage: "2d6", damageType: "fire" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  expectCard(world, before, { attacker: null, detail: "fire on the oak door", characterId: null, total: 6 });
});

await test("A flat amount rolls no dice and stores no card; dice always do.", async () => {
  const { world, sheets: [fighter] } = await table([FIGHTER]);
  const before = snapshot(world);
  assert.equal(rollCard(world.campaign(), null, fighter.id, "damage", "Aura of Conquest vs Goblin", "5", null).total, 5);
  assert.equal(cardsSince(world, before).length, 0, "a flat 5 was carded");
  world.dice(3);
  rollCard(world.campaign(), null, fighter.id, "damage", "Aura vs Goblin", "1d4", null);
  world.clearDice();
  assert.equal(cardsSince(world, before).length, 1);
});

closeTables();
finish();
