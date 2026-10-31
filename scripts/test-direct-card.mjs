// A complete card from the Hand is resolved by the engine before the
// narrator is asked (src/lib/dm/turn.ts directCards, intent-logic.ts
// directCardCall): the turn's first step runs the cards' own tool calls, and
// the model's first (and usually only) call narrates from the results. A
// card the model still has to judge (no fixed target, an area laid on the
// board, a rider, an attack out of a fight) goes to the model first, as
// before. Issue 570 widened the direct path from weapon attacks and Dodge,
// Dash and Disengage to spells at one target, features, the other basic
// actions, reactions and gear, to every card since the DM last spoke, and to
// cards played between fights.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-direct-card");
const { directCardCall } = await import("../src/lib/dm/intent-logic.ts");
const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(world);
const kit = await combatKit(world);
const kara = world.addHero({ name: "Kara", class: "fighter", level: 3, maxHp: 30, abilities: { str: 16 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Potion of Healing", qty: 1 }] });
const iris = world.addHero({
  name: "Iris",
  class: "wizard",
  level: 3,
  maxHp: 20,
  abilities: { int: 16 },
  equipment: [{ name: "Dagger", qty: 1 }],
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, known: [], prepared: ["Magic Missile", "Shield", "Mage Armor"], cantrips: ["Fire Bolt"], spellbook: ["Magic Missile", "Shield", "Mage Armor"] },
});
const sefa = world.addHero({
  name: "Sefa",
  class: "cleric",
  level: 3,
  maxHp: 24,
  abilities: { wis: 16 },
  equipment: [{ name: "Mace", qty: 1, equipped: true }],
  spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, known: [], prepared: ["Cure Wounds", "Bless"], cantrips: ["Sacred Flame"] },
});

async function stage(whose = kara) {
  await kit.endFight();
  await kit.fight(1);
  for (const hero of [kara, iris, sefa]) {
    world.patch(hero.id, { currentHp: hero.maxHp, conditions: [], conditionMeta: {} });
  }
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 200 });
  kit.place(kara.id, 5, 5);
  kit.place(iris.id, 4, 5);
  kit.place(sefa.id, 4, 6);
  kit.place(enemy.id, 5, 6);
  kit.giveTurn(whose.id);
  return enemy;
}

const toolCalls = (request) =>
  request.messages.flatMap((message) => (message.role === "assistant" && Array.isArray(message.tool_calls) ? message.tool_calls : []));
const results = (request) => request.messages.filter((message) => message.role === "tool").map((message) => JSON.parse(message.content));
const firstCall = (request, index = 0) => {
  const calls = toolCalls(request);
  return calls[index] ? { name: calls[index].function.name, args: JSON.parse(calls[index].function.arguments), id: calls[index].id } : null;
};

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
  assert.match(calls[0].id, /^card_/);
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
  const first = firstCall(model.requests[0]);
  assert.equal(first.name, "take_action");
  assert.equal(first.args.action, "dodge");
  const [result] = results(model.requests[0]);
  assert.ok(result && !result.error, JSON.stringify(result));
});

await test("An attack card with no fixed target goes to the model first, as before.", async () => {
  await stage();
  model.script([reply({ text: "Kara looks for an opening." })]);
  await model.turn(world, "Kara attacks.", kara.id, kara.userId, { intent: { card: "attack" } });
  assert.ok(model.requests.length >= 1);
  assert.equal(toolCalls(model.requests[0]).length, 0, "the first call carries no tool call of the engine's making");
  const transcript = model.requests[0].messages.map((message) => (typeof message.content === "string" ? message.content : "")).join("\n");
  assert.match(transcript, /Resolve it with pc_attack/, "a card the engine leaves asks the model for the call");
});

// ---- issue 570: the direct path widened ----

await test("A spell card at one enemy is cast by the engine with the spell's tool: an attack-roll spell through pc_attack, before any model call.", async () => {
  const enemy = await stage(iris);
  model.script([reply({ text: "A bolt of flame streaks across the gap." })]);
  await model.turn(world, "I cast Fire Bolt at Goblin 1.", iris.id, iris.userId, {
    intent: { card: "spell", spell: "Fire Bolt", slotLevel: null, targetKind: "enemy", targetId: enemy.id, targetName: enemy.displayName },
  });
  assert.equal(model.requests.length, 1, "one model call: the narration");
  const first = firstCall(model.requests[0]);
  assert.equal(first.name, "pc_attack", JSON.stringify(first));
  assert.equal(first.args.spell, "Fire Bolt");
  assert.equal(first.args.characterId, iris.id);
  assert.equal(first.args.targetEnemyId, enemy.id);
  assert.match(first.id, /^card_/);
  const [result] = results(model.requests[0]);
  assert.ok(result && !result.error, `the bolt resolved: ${JSON.stringify(result)}`);
  // The card's line in the transcript says the engine took it, so the model
  // does not cast it again (a scripted model that did cast twice).
  const transcript = model.requests[0].messages.map((message) => (typeof message.content === "string" ? message.content : "")).join("\n");
  assert.match(transcript, /The engine has resolved it/);
  assert.doesNotMatch(transcript, /Fire Bolt[^\n]*Resolve it with/);
});

await test("A healing spell on an ally is rolled by the engine through heal, with the caster as casterId and the ally healed.", async () => {
  await stage(sefa);
  world.patch(kara.id, { currentHp: 10 });
  model.script([reply({ text: "Warmth closes the cut." })]);
  await model.turn(world, "I cast Cure Wounds on Kara.", sefa.id, sefa.userId, {
    intent: { card: "spell", spell: "Cure Wounds", slotLevel: 1, targetKind: "ally", targetId: kara.id, targetName: "Kara" },
  });
  const first = firstCall(model.requests[0]);
  assert.equal(first.name, "heal", JSON.stringify(first));
  assert.equal(first.args.characterId, kara.id);
  assert.equal(first.args.casterId, sefa.id);
  assert.equal(first.args.level, 1);
  const [result] = results(model.requests[0]);
  assert.ok(result && !result.error, JSON.stringify(result));
  assert.ok(world.sheet(kara.id).currentHp > 10, "Kara was healed");
  assert.equal(world.sheet(sefa.id).spellcasting.slots[1].used, 1, "the slot was spent");
});

await test("A buff on an ally goes through cast_buff with the ally as its target.", async () => {
  await stage(sefa);
  model.script([reply({ text: "A blessing settles on Kara." })]);
  await model.turn(world, "I cast Bless on Kara.", sefa.id, sefa.userId, {
    intent: { card: "spell", spell: "Bless", slotLevel: 1, targetKind: "ally", targetId: kara.id, targetName: "Kara" },
  });
  const first = firstCall(model.requests[0]);
  assert.equal(first.name, "cast_buff", JSON.stringify(first));
  assert.deepEqual(first.args.targetCharacterIds, [kara.id]);
  const [result] = results(model.requests[0]);
  assert.ok(result && !result.error, JSON.stringify(result));
});

await test("A reaction card to a hit is resolved by the engine through use_reaction, off the caster's turn.", async () => {
  const enemy = await stage(kara);
  await world.hitBy(iris.id, { enemyId: enemy.id, name: enemy.displayName, total: 19, vsAc: 12, raw: 5, attack: "Scimitar" });
  model.script([reply({ text: "A shimmering barrier flares." })]);
  await model.turn(world, "I cast Shield as a reaction.", iris.id, iris.userId, {
    intent: { card: "reaction", feature: "Shield", spell: "Shield", slotLevel: 1 },
  });
  const first = firstCall(model.requests[0]);
  assert.equal(first.name, "use_reaction", JSON.stringify(first));
  assert.equal(first.args.feature, "Shield");
  const [result] = results(model.requests[0]);
  assert.ok(result && !result.error, JSON.stringify(result));
});

await test("A gear card is handled by the engine: a potion drunk through use_item.", async () => {
  await stage(kara);
  world.patch(kara.id, { currentHp: 12 });
  model.script([reply({ text: "Kara drains the vial." })]);
  await model.turn(world, "I drink my Potion of Healing.", kara.id, kara.userId, {
    intent: { card: "gear", action: "use", item: "Potion of Healing", targetKind: "self", targetId: kara.id, targetName: "Kara" },
  });
  const first = firstCall(model.requests[0]);
  assert.equal(first.name, "use_item", JSON.stringify(first));
  assert.equal(first.args.item, "Potion of Healing");
  const [result] = results(model.requests[0]);
  assert.ok(result && !result.error, JSON.stringify(result));
  assert.ok(world.sheet(kara.id).currentHp > 12, "the potion healed");
});

await test("A Help card for an ally goes through take_action with the ally named.", async () => {
  await stage(kara);
  model.script([reply({ text: "Kara feints to draw the goblin's eye." })]);
  await model.turn(world, "I take the Help action for Iris.", kara.id, kara.userId, {
    intent: { card: "basic", action: "help", targetKind: "ally", targetId: iris.id, targetName: "Iris" },
  });
  const first = firstCall(model.requests[0]);
  assert.equal(first.name, "take_action", JSON.stringify(first));
  assert.equal(first.args.action, "help");
  assert.equal(first.args.targetCharacterId, iris.id);
});

await test("Every card since the DM last spoke is resolved, in the order played: a cast posted before a typed line still goes to the engine.", async () => {
  const enemy = await stage(iris);
  // The player's card, then a typed afterthought with no card.
  const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
  const { allocateSeq } = await import("../src/lib/db/campaigns.ts");
  insertCampaignMessage({
    campaignId: world.campaignId,
    seq: allocateSeq(world.campaignId),
    authorType: "player",
    userId: iris.userId,
    characterId: iris.id,
    content: "I cast Fire Bolt at Goblin 1.",
    intent: { card: "spell", spell: "Fire Bolt", slotLevel: null, targetKind: "enemy", targetId: enemy.id, targetName: enemy.displayName },
  });
  model.script([reply({ text: "The bolt flies as she shouts." })]);
  await model.turn(world, "And I shout a warning to Kara!", iris.id, iris.userId);
  const first = firstCall(model.requests[0]);
  assert.equal(first?.name, "pc_attack", JSON.stringify(toolCalls(model.requests[0])));
  assert.equal(first.args.spell, "Fire Bolt");
});

await test("An area spell is left to the model, aimed at one enemy or laid on a square, and so is a spell the content has no resolution for.", async () => {
  const enemy = await stage(iris);
  assert.equal(
    directCardCall({ card: "spell", spell: "Web", slotLevel: 2, targetKind: "enemy", targetId: enemy.id, atX: 5, atY: 6 }, iris.id, { inFight: true, resolution: "save" }),
    null,
    "a square laid on the board is the model's",
  );
  // A Fireball aimed at one goblin: cast_at_enemy would roll that goblin
  // alone, so the burst is the model's to lay over everyone in it.
  assert.equal(directCardCall({ card: "spell", spell: "Fireball", slotLevel: 3, targetKind: "enemy", targetId: enemy.id }, iris.id, { inFight: true, resolution: "save", area: true }), null);
  assert.equal(directCardCall({ card: "spell", spell: "Chill Touch", slotLevel: null, targetKind: "enemy", targetId: enemy.id }, iris.id, { inFight: true, resolution: null }), null);
  assert.equal(directCardCall({ card: "spell", spell: "Find Familiar", slotLevel: 1 }, iris.id, { inFight: false, resolution: "summon" }), null);
  assert.equal(directCardCall({ card: "rider", rider: "Sneak Attack" }, kara.id, { inFight: true }), null);
});

await test("Between fights a healing spell on an ally is cast by the engine, while a card aimed at an enemy waits for the model to start the fight.", async () => {
  await kit.endFight();
  world.patch(kara.id, { currentHp: 10 });
  model.script([reply({ text: "Sefa kneels and the wound knits." })]);
  await model.turn(world, "I cast Cure Wounds on Kara.", sefa.id, sefa.userId, {
    intent: { card: "spell", spell: "Cure Wounds", slotLevel: 1, targetKind: "ally", targetId: kara.id, targetName: "Kara" },
  });
  const first = firstCall(model.requests[0]);
  assert.equal(first?.name, "heal", JSON.stringify(toolCalls(model.requests[0])));
  assert.ok(world.sheet(kara.id).currentHp > 10, "Kara was healed between fights");
  assert.equal(directCardCall({ card: "spell", spell: "Fire Bolt", slotLevel: null, targetKind: "enemy", targetId: "nobody" }, iris.id, { inFight: false, resolution: "attack" }), null);
});

// Issue 570: matching the tool's name was enough, so a use_spell_slot passed
// for an attack-roll spell the engine never rolled. The correction now runs
// for a card the engine could not resolve itself (no fixed target).
const corrected = () => model.requests.some((request) => request.messages.some((message) => message.role === "user" && /nothing resolved it/.test(String(message.content))));

await test("A spell card with no fixed target answered only by spending a slot is sent back to the spell's tool once.", async () => {
  await stage(iris);
  model.script([
    reply({ calls: [call("use_spell_slot", { characterId: iris.id, spell: "Fire Bolt" })] }),
    reply({ text: "Iris mutters a word." }),
    reply({ text: "The bolt goes wide." }),
  ]);
  await model.turn(world, "I cast Fire Bolt at the nearest goblin.", iris.id, iris.userId, {
    intent: { card: "spell", spell: "Fire Bolt", slotLevel: null },
  });
  assert.ok(corrected(), "the corrective call was made");
  const correction = model.requests.flatMap((request) => request.messages).find((message) => /nothing resolved it/.test(String(message.content)));
  assert.match(String(correction.content), /use_spell_slot does not cast it/);
});

await test("A spell card the spell's own tool answered, for the card's caster, is not sent back.", async () => {
  const enemy = await stage(iris);
  model.script([
    reply({ calls: [call("pc_attack", { characterId: iris.id, targetEnemyId: enemy.id, spell: "Fire Bolt" })] }),
    reply({ text: "Iris mutters a word." }),
  ]);
  await model.turn(world, "I cast Fire Bolt at the nearest goblin.", iris.id, iris.userId, {
    intent: { card: "spell", spell: "Fire Bolt", slotLevel: null },
  });
  assert.equal(corrected(), false);
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
