// The AI DM asks the engine for damage, healing and binding conditions
// rather than writing them (docs/dnd-rules-audit-2026-10-09-extent.md, F17;
// src/lib/dm/ai-gate.ts):
//
//   - apply_damage, heal, damage_enemy and split_damage take dice the server
//     rolls, or a total the server rolled this turn that nothing has spent;
//     a number of the model's own is refused and nothing changes.
//   - set_condition lays a binding condition only after the save the server
//     rolls; clear_condition never lifts one a spell or a save keeps.
//   - The console keeps its free hand.
//
// Dice forced; every check reads a stored sheet or enemy row.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-ai-gates");
const world = await openWorld();
const kit = await combatKit(world);
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");

const hero = world.addHero({ class: "fighter", level: 5, maxHp: 40, abilities: { wis: 10 }, proficiencies: TRAINED });

// One AI DM turn: every call in it shares the turn, as the model's do.
function aiTurn() {
  const turn = createDmTurn(world.campaignId, []);
  return (name, args = {}) => invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name, args });
}

async function stage() {
  await kit.endFight();
  await kit.fight(1);
  world.patch(hero.id, { currentHp: 40, tempHp: 0, conditions: [], conditionMeta: {} });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 100 });
  return enemy;
}
const hp = () => world.sheet(hero.id).currentHp;

// ---- damage and healing ----

await test("The AI's bare damage number is refused and the hit points stay.", async () => {
  await stage();
  const out = await aiTurn()("apply_damage", { characterId: hero.id, amount: 7, type: "slashing", reason: "a goblin's scimitar" });
  assert.equal(out.ok, false, "the model wrote damage the server never rolled");
  assert.equal(hp(), 40);
});

await test("Dice the AI sends are rolled by the server: 2d6 of 3 and 4 is 7.", async () => {
  await stage();
  world.dice(3, 4);
  const out = await aiTurn()("apply_damage", { characterId: hero.id, dice: "2d6", type: "bludgeoning", reason: "falling rubble" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(), 33);
});

await test("A damage total the server rolled this turn is accepted once, and only once.", async () => {
  await stage();
  const call = aiTurn();
  world.dice(5);
  const rolled = await call("request_roll", { characterId: hero.id, kind: "damage", expression: "1d8", reason: "poison" });
  world.clearDice();
  assert.equal(rolled.ok, true, rolled.error);
  const first = await call("apply_damage", { characterId: hero.id, amount: 5, type: "poison" });
  assert.equal(first.ok, true, first.error);
  assert.equal(hp(), 35);
  const again = await call("apply_damage", { characterId: hero.id, amount: 5, type: "poison" });
  assert.equal(again.ok, false, "one roll paid for two hits");
  assert.equal(hp(), 35);
});

await test("The AI's bare healing number is refused; healing dice are rolled by the server.", async () => {
  await stage();
  world.patch(hero.id, { currentHp: 20 });
  const call = aiTurn();
  const bare = await call("heal", { characterId: hero.id, amount: 15 });
  assert.equal(bare.ok, false);
  assert.equal(hp(), 20);
  world.dice(2, 3);
  const rolled = await call("heal", { characterId: hero.id, dice: "2d4+2" });
  world.clearDice();
  assert.equal(rolled.ok, true, rolled.error);
  assert.equal(hp(), 27);
});

await test("damage_enemy from a hazard takes dice from the AI, never a bare number.", async () => {
  const enemy = await stage();
  const call = aiTurn();
  const bare = await call("damage_enemy", { enemyId: enemy.id, amount: 25, type: "fire", source: "hazard", reason: "burning oil" });
  assert.equal(bare.ok, false);
  assert.equal(kit.enemy(enemy.id).currentHp, 100);
  world.dice(6, 6);
  const dice = await call("damage_enemy", { enemyId: enemy.id, dice: "2d6", type: "fire", source: "hazard", reason: "burning oil" });
  world.clearDice();
  assert.equal(dice.ok, true, dice.error);
  assert.equal(kit.enemy(enemy.id).currentHp, 88);
});

await test("split_damage from the AI needs the server's roll.", async () => {
  const enemy = await stage();
  const out = await aiTurn()("split_damage", { amount: 20, type: "fire", targets: [{ enemyId: enemy.id, share: "full" }, { characterId: hero.id, share: "half" }] });
  assert.equal(out.ok, false);
  assert.equal(hp(), 40);
  assert.equal(kit.enemy(enemy.id).currentHp, 100);
});

// ---- binding conditions ----

await test("The AI cannot paralyze a character without a save; with one, the server rolls it first.", async () => {
  await stage();
  const call = aiTurn();
  const bare = await call("set_condition", { characterId: hero.id, condition: "paralyzed", rounds: 10 });
  assert.equal(bare.ok, false);
  assert.equal(world.sheet(hero.id).conditions.includes("paralyzed"), false);
  world.dice(19);
  const made = await call("set_condition", { characterId: hero.id, condition: "paralyzed", saveAbility: "wis", saveDc: 13 });
  world.clearDice();
  assert.equal(made.ok, true, made.error);
  assert.equal(world.sheet(hero.id).conditions.includes("paralyzed"), false, "a made save still paralyzed");
  world.dice(2);
  const failed = await call("set_condition", { characterId: hero.id, condition: "paralyzed", saveAbility: "wis", saveDc: 13 });
  world.clearDice();
  assert.equal(failed.ok, true, failed.error);
  assert.ok(world.sheet(hero.id).conditions.includes("paralyzed"));
});

await test("The AI cannot lift a paralysis a spell keeps; the console can.", async () => {
  await stage();
  world.patch(hero.id, { conditions: ["paralyzed"], conditionMeta: { paralyzed: { spell: "Hold Person", source: "someone", saveEnds: { ability: "wis", dc: 13 } } } });
  const out = await aiTurn()("clear_condition", { characterId: hero.id, condition: "paralyzed" });
  assert.equal(out.ok, false);
  assert.ok(world.sheet(hero.id).conditions.includes("paralyzed"));
  const console = await world.invoke("clear_condition", { characterId: hero.id, condition: "paralyzed" });
  assert.equal(console.ok, true, console.error);
  assert.equal(world.sheet(hero.id).conditions.includes("paralyzed"), false);
});

await test("The console's own bare numbers still land.", async () => {
  await stage();
  const out = await world.invoke("apply_damage", { characterId: hero.id, amount: 6, type: "slashing" });
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(), 34);
});

world.close();
finish();
