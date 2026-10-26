// A complete card from the Hand is resolved by the engine before the
// narrator is asked (src/lib/dm/turn.ts directCard, intent-logic.ts
// directCardCall): the turn's first step runs the card's own tool call, and
// the model's first (and usually only) call narrates from its result. A
// card the model still has to judge (no fixed target, a spell, a card out
// of a fight) goes to the model first, as before.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-direct-card");
const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(world);
const kit = await combatKit(world);
const kara = world.addHero({ name: "Kara", class: "fighter", level: 3, maxHp: 30, abilities: { str: 16 }, proficiencies: TRAINED });

async function stage() {
  await kit.endFight();
  await kit.fight(1);
  world.patch(kara.id, { currentHp: 30, conditions: [], conditionMeta: {} });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 200 });
  kit.place(kara.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.giveTurn(kara.id);
  return enemy;
}

const toolCalls = (request) =>
  request.messages.flatMap((message) => (message.role === "assistant" && Array.isArray(message.tool_calls) ? message.tool_calls : []));
const results = (request) => request.messages.filter((message) => message.role === "tool").map((message) => JSON.parse(message.content));

await test("An attack card at a named enemy is rolled by the engine before the model is asked; the one model call narrates from the result.", async () => {
  const enemy = await stage();
  model.script([reply({ text: "Kara's blade finds the dummy's shoulder." })]);
  const dm = await model.turn(world, "Kara attacks the dummy with her longsword.", kara.id, kara.userId, {
    intent: { card: "attack", targetKind: "enemy", targetId: enemy.id, targetName: enemy.displayName },
  });
  assert.equal(model.requests.length, 1, "one model call: the narration");
  const [request] = model.requests;
  const calls = toolCalls(request);
  assert.equal(calls.length, 1, JSON.stringify(calls));
  assert.equal(calls[0].function.name, "pc_attack");
  const args = JSON.parse(calls[0].function.arguments);
  assert.equal(args.characterId, kara.id);
  assert.equal(args.targetEnemyId, enemy.id);
  const [result] = results(request);
  assert.ok(result && !result.error, `the attack resolved: ${JSON.stringify(result)}`);
  assert.ok(kit.lastRolls().some((roll) => /attack|damage/.test(roll.kind) && /goblin/i.test(roll.detail ?? "")), `the attack was rolled: ${JSON.stringify(kit.lastRolls()).slice(0, 300)}`);
  assert.ok(dm, "the narration followed");
  assert.match(dm.content, /shoulder/);
});

await test("A Dodge card is taken by the engine first, and the model narrates it.", async () => {
  await stage();
  model.script([reply({ text: "Kara raises her shield and watches the dummy." })]);
  await model.turn(world, "Kara dodges.", kara.id, kara.userId, { intent: { card: "basic", action: "dodge" } });
  assert.equal(model.requests.length, 1);
  const calls = toolCalls(model.requests[0]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "take_action");
  assert.equal(JSON.parse(calls[0].function.arguments).action, "dodge");
  const [result] = results(model.requests[0]);
  assert.ok(result && !result.error, JSON.stringify(result));
});

await test("An attack card with no fixed target goes to the model first, as before.", async () => {
  await stage();
  model.script([reply({ text: "Kara looks for an opening." })]);
  await model.turn(world, "Kara attacks.", kara.id, kara.userId, { intent: { card: "attack" } });
  assert.ok(model.requests.length >= 1);
  assert.equal(toolCalls(model.requests[0]).length, 0, "the first call carries no tool call of the engine's making");
});

await test("A spell card is left to the model: its choices are its own.", async () => {
  const enemy = await stage();
  model.script([reply({ text: "Kara mutters a word." })]);
  await model.turn(world, "Kara casts Fire Bolt at the dummy.", kara.id, kara.userId, {
    intent: { card: "spell", spell: "Fire Bolt", slotLevel: null, targetKind: "enemy", targetId: enemy.id },
  });
  assert.equal(toolCalls(model.requests[0]).length, 0);
});

await test("Out of a fight an attack card is not resolved ahead of the model.", async () => {
  await kit.endFight();
  model.script([reply({ text: "Kara's hand goes to her hilt." })]);
  await model.turn(world, "Kara attacks the merchant.", kara.id, kara.userId, {
    intent: { card: "attack", targetKind: "enemy", targetId: "nobody", targetName: "the merchant" },
  });
  assert.equal(toolCalls(model.requests[0]).length, 0);
});

model.close();
await finish();
