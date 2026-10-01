// The spellcasting features and roll rules the wave 1 repair left open
// (/tmp/odm-enf2/fixes/spells.md, features.md, actions.md, pc-attack.md):
// Signature Spells, Supreme Healing's grant, Sculpt Spells, Overchannel,
// Feather Fall against a fall, an enemy's save kept as a roll row, Steel
// Will, the Hunter's Evasion pick, and the AI's free advantage on
// request_roll.
//
// SRD 5.1 as printed. Dice forced; every check reads the stored sheet, the
// encounter row, a roll record, the dice rolled, or a refusal.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, enemyOf, FIGHTER, invokeAsAi, table } from "./lib/enforce-spell-kit.mjs";
import { d20s } from "./lib/enforce-spell-tail.mjs";

const { test, finish } = suite("test-enforce-caster-features");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { classFeaturesFor } = await import("../src/lib/srd/features.ts");

// A feature the class table does not hand out at creation (a pick, a
// subclass's own): the sheet is written with it after the table is set.
function grant(world, id, ...names) {
  const sheet = world.sheet(id);
  world.patch(id, { features: [...sheet.features, ...names.map((name) => ({ name, source: "test" }))] });
}

const hurt = (world, id) => enemyOf(world, id).maxHp - enemyOf(world, id).currentHp;
const RANGER = {
  class: "ranger",
  level: 15,
  abilities: { dex: 16, wis: 14 },
  proficiencies: { saves: ["str", "dex"], skills: [], expertise: [], languages: ["Common"], tools: [], armor: ["light"], weapons: ["simple", "martial"] },
};

// ---- the wizard's capstones and the evoker ----

await test("A wizard's two Signature Spells are each cast once at 3rd level without a slot, and come back on a short rest.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Fireball", "Counterspell"], [], 20)]);
  grant(world, wizard.id, "Signature Spells: Fireball, Counterspell");
  world.dice(...new Array(8).fill(1), 1);
  const first = await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Fireball", enemyIds: [goblin.id], saveAbility: "dex", dc: 15 });
  world.clearDice();
  assert.equal(first.ok, true, first.error);
  assert.equal(world.sheet(wizard.id).spellcasting.slots["3"].used, 0);
  const { freshTurn } = await import("./lib/enforce-spells.mjs");
  await freshTurn(world);
  world.dice(...new Array(8).fill(1), 1);
  await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Fireball", enemyIds: [goblin.id], saveAbility: "dex", dc: 15 });
  world.clearDice();
  assert.equal(world.sheet(wizard.id).spellcasting.slots["3"].used, 1);
});

await test("An evoker's Sculpt Spells lets allies caught in the wizard's evocation succeed on the save and take no damage.", async () => {
  const { world, sheets: [wizard, fighter], enemies: [goblin] } = await table([caster("wizard", "int", ["Fireball"], [], 5), FIGHTER]);
  grant(world, wizard.id, "Sculpt Spells");
  const before = world.sheet(fighter.id).currentHp;
  world.dice(...new Array(8).fill(3), 1);
  const out = await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Fireball", enemyIds: [goblin.id], characterIds: [fighter.id], saveAbility: "dex", dc: 15, level: 3 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(hurt(world, goblin.id), 24);
  assert.equal(world.sheet(fighter.id).currentHp, before);
});

await test("Overchannel deals a 1st to 5th level evocation's maximum damage; a second use before a long rest costs the wizard 2d12 necrotic per spell level.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Fireball"], [], 14)]);
  grant(world, wizard.id, "Overchannel");
  world.dice(1);
  const out = await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Fireball", enemyIds: [goblin.id], saveAbility: "dex", dc: 15, level: 3, overchannel: true });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(hurt(world, goblin.id), 48);
  const { freshTurn } = await import("./lib/enforce-spells.mjs");
  await freshTurn(world);
  const hp = world.sheet(wizard.id).currentHp;
  world.dice(1, ...new Array(6).fill(1));
  await world.invoke("aoe_damage", { casterId: wizard.id, spell: "Fireball", enemyIds: [goblin.id], saveAbility: "dex", dc: 15, level: 3, overchannel: true });
  world.clearDice();
  assert.equal(hp - world.sheet(wizard.id).currentHp, 6);
});

await test("a Life cleric's 17th level grant is the feature Supreme Healing, and it makes healing its maximum", async () => {
  const features = classFeaturesFor("cleric", "life", 17);
  assert.ok(features.some((feature) => feature.name === "Supreme Healing"));
  const { world, sheets: [cleric, fighter] } = await table([caster("cleric", "wis", ["Cure Wounds"], [], 17), FIGHTER]);
  world.patch(cleric.id, { features });
  world.patch(fighter.id, { currentHp: 1 });
  world.dice(1);
  await world.invoke("heal", { characterId: fighter.id, casterId: cleric.id, spell: "Cure Wounds", level: 1 });
  world.clearDice();
  // 8 (the die at its most) + 4 (WIS) + 3 (Disciple of Life: 2 + the slot).
  assert.equal(world.sheet(fighter.id).currentHp, 1 + 15);
});

// ---- a fall, a save, a trait ----

await test("A creature under Feather Fall takes no falling damage and does not land prone.", async () => {
  const world = await openWorld();
  const wizard = world.addHero(caster("wizard", "int", ["Feather Fall"]));
  const fighter = world.addHero(FIGHTER);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Feather Fall", targetCharacterIds: [fighter.id], level: 1 });
  assert.equal(cast.ok, true, cast.error);
  const before = world.sheet(fighter.id).currentHp;
  world.dice(6, 6, 6, 6, 6, 6);
  await world.invoke("apply_hazard", { type: "falling", feet: 60, characterIds: [fighter.id] });
  world.clearDice();
  assert.equal(world.sheet(fighter.id).currentHp, before);
  assert.ok(!world.sheet(fighter.id).conditions.includes("prone"));
});

await test("An enemy's saving throw against a character's spell is kept as a roll row (the DM's to see), like every other roll.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Hold Person"])]);
  world.dice(7);
  await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Hold Person", saveAbility: "wis", level: 2 });
  world.clearDice();
  const rows = getDatabase()
    .prepare("SELECT total, dc, visibility, detail FROM rolls WHERE campaign_id = ? AND roll_kind = 'saving_throw' AND character_id IS NULL")
    .all(world.campaignId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total, 7);
  assert.equal(rows[0].visibility, "dm");
  assert.ok(rows[0].detail.includes(goblin.displayName));
});

await test("A Hunter ranger with Steel Will has advantage on saving throws against being frightened.", async () => {
  const { world, sheets: [ranger] } = await table([{ ...RANGER, level: 7 }]);
  grant(world, ranger.id, "Defensive Tactics: Steel Will");
  world.diceLog();
  world.dice(10, 10);
  await world.invoke("request_roll", { characterId: ranger.id, kind: "saving_throw", ability: "wis", dc: 13, against: "frightened" });
  world.clearDice();
  assert.equal(d20s(world.diceLog()), 2);
});

await test("the Hunter's Superior Hunter's Defense taken as Evasion answers an area effect", async () => {
  const { world, sheets: [ranger] } = await table([RANGER]);
  grant(world, ranger.id, "Superior Hunter's Defense: Evasion");
  const before = world.sheet(ranger.id).currentHp;
  world.dice(6, 6, 6, 6, 20);
  await world.invoke("aoe_damage", { damage: "4d6", type: "fire", saveAbility: "dex", dc: 10, halfOnSave: true, characterIds: [ranger.id] });
  world.clearDice();
  assert.equal(world.sheet(ranger.id).currentHp, before);
});

await test("The AI's advantage on request_roll counts only with a named circumstance the server cannot see; the DM console's still stands.", async () => {
  const { world, sheets: [fighter] } = await table([FIGHTER]);
  world.diceLog();
  world.dice(10, 10);
  await invokeAsAi(world, "request_roll", { characterId: fighter.id, kind: "skill_check", skill: "athletics", dc: 13, advantage: "advantage" });
  world.clearDice();
  assert.equal(d20s(world.diceLog()), 1, "no reason named: a straight roll");
  world.dice(10, 10);
  await invokeAsAi(world, "request_roll", { characterId: fighter.id, kind: "skill_check", skill: "athletics", dc: 13, advantage: "advantage", advantageReason: "a rope tied off to the post above" });
  world.clearDice();
  assert.equal(d20s(world.diceLog()), 2);
  world.dice(10, 10);
  await world.invoke("request_roll", { characterId: fighter.id, kind: "skill_check", skill: "athletics", dc: 13, advantage: "advantage" });
  world.clearDice();
  assert.equal(d20s(world.diceLog()), 2, "the console rules freely");
});

closeTables();
finish();
