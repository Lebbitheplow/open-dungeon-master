// The rules audit's gate on the model's damage, healing and binding
// conditions (F17, src/lib/dm/ai-gate.ts), held on the AI's own turn.
// test-enforce-ai-gates.mjs drives the gate through invokeEngine with an AI
// turn, the door a delegated turn uses, and passes. But a DM turn runs the
// model's mutation and encounter calls itself (resolveModelCall in
// src/lib/dm/turn.ts), and those never reached the gate: a heal sent with
// the dice its own tool description offers was refused for having no
// amount, a number of the model's own was applied as written, and a
// paralysis landed with no save. Grok Build, run as the storyteller, hit
// the first of these live.
//
// Each case is one whole DM turn against the scripted fake model
// (scripts/lib/enforce-narrator.mjs), with every die forced.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-ai-gate-in-turn");

const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { MUTATION_CAP_PER_TURN } = await import("../src/lib/dm/mutations.ts");

const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const kit = await combatKit(world);
const model = await fakeModel();
model.pointAt(world);
const kara = world.addHero({ name: "Kara", class: "fighter", level: 5, abilities: { str: 16, dex: 10, con: 14, wis: 10 } });
const userId = world.sheet(kara.id).userId;
const maxHp = world.sheet(kara.id).maxHp;

// One DM turn: the model's call, then its narration. Returns what the tool
// answered.
async function turnWith(toolCall, line = "I press on.") {
  return (await turnWithAll([toolCall], line)).at(-1);
}

// The same, with several calls in the one reply; returns every answer.
async function turnWithAll(toolCalls, line = "I press on.") {
  model.script([reply({ calls: toolCalls }), reply({ text: "The moment passes. What do you do?" })]);
  await model.turn(world, line, kara.id, userId);
  assert.equal(world.clearDice(), 0, "a forced die went unrolled");
  const answers = model.requests[1].messages.filter((message) => message.role === "tool");
  return answers.slice(-toolCalls.length).map((answer) => JSON.parse(answer.content));
}

await test("Healing sent as dice, as the heal tool offers, is rolled by the server and lands.", async () => {
  world.patch(kara.id, { currentHp: 10 });
  world.dice(3, 4);
  const result = await turnWith(call("heal", { characterId: kara.id, dice: "2d4+2", reason: "a healer's draught" }));
  assert.ok(!result.error, `the heal was refused: ${result.error}`);
  assert.equal(world.sheet(kara.id).currentHp, 19, "2d4+2 on 3 and 4");
});

await test("Damage the model writes as its own number is refused, and the sheet is untouched.", async () => {
  world.patch(kara.id, { currentHp: maxHp });
  const result = await turnWith(call("apply_damage", { characterId: kara.id, amount: 30, type: "fire", reason: "the brazier" }));
  assert.match(result.error ?? "", /Damage is rolled by the server/);
  assert.equal(world.sheet(kara.id).currentHp, maxHp);
});

await test("Damage sent as dice is rolled by the server.", async () => {
  world.patch(kara.id, { currentHp: maxHp });
  world.dice(5, 2);
  const result = await turnWith(call("apply_damage", { characterId: kara.id, dice: "2d6", type: "fire", reason: "the brazier" }));
  assert.ok(!result.error, `the damage was refused: ${result.error}`);
  assert.equal(world.sheet(kara.id).currentHp, maxHp - 7);
});

await test("A paralysis with no save is refused; with one, the server rolls it and a failure lays it.", async () => {
  const conditions = () => world.sheet(kara.id).conditions.map((entry) => entry.toLowerCase());
  const bare = await turnWith(call("set_condition", { characterId: kara.id, condition: "paralyzed", reason: "the ghoul's touch" }));
  assert.match(bare.error ?? "", /cannot be made paralyzed by narration alone/);
  assert.ok(!conditions().includes("paralyzed"), "a paralysis landed with no save");

  world.dice(2);
  const saved = await turnWith(
    call("set_condition", { characterId: kara.id, condition: "paralyzed", saveAbility: "con", saveDc: 10, rounds: 1, reason: "the ghoul's touch" }),
  );
  assert.ok(!saved.error, `the saved paralysis was refused: ${saved.error}`);
  assert.ok(conditions().includes("paralyzed"), "a failed save did not lay the paralysis");
});

await test("A call past the turn's mutation cap is refused before the gate rolls its dice.", async () => {
  world.patch(kara.id, { currentHp: 1 });
  const before = listRecentRolls(world.campaignId, 500).length;
  world.dice(...Array.from({ length: MUTATION_CAP_PER_TURN }, () => 1));
  const heals = Array.from({ length: MUTATION_CAP_PER_TURN + 1 }, () =>
    call("heal", { characterId: kara.id, dice: "1d4", reason: "a trickle of warmth" }),
  );
  model.script([reply({ calls: heals }), reply({ text: "The warmth fades. What do you do?" })]);
  await model.turn(world, "I rest a moment.", kara.id, userId);
  assert.equal(world.clearDice(), 0, "a forced die went unrolled");
  const answers = model.requests[1].messages.filter((message) => message.role === "tool").map((message) => JSON.parse(message.content));
  assert.match(answers.at(-1).error ?? "", /Mutation limit reached/);
  assert.equal(listRecentRolls(world.campaignId, 500).length - before, MUTATION_CAP_PER_TURN, "the capped call rolled its dice anyway");
  assert.equal(world.sheet(kara.id).currentHp, 1 + MUTATION_CAP_PER_TURN);
});

// Found playing Quick Start with Codex: a falling net restrains, the model
// rolls Athletics and lifts the net with clear_condition, and the gate
// refuses (the trap is the hold's source) while naming only the cures. The
// net is broken the way its rule says, through the escape action.
await test("A falling net's restraint is not lifted by hand; take_action escape makes the net's DC 10 Strength check and frees her on a success.", async () => {
  const conditions = () => world.sheet(kara.id).conditions.map((entry) => entry.toLowerCase());
  world.patch(kara.id, { conditions: [], conditionMeta: {} });
  world.dice(15);
  const net = await turnWith(call("apply_hazard", { type: "trap", trap: "Falling Net", characterIds: [kara.id], reason: "the crypt stair" }));
  assert.ok(!net.error, net.error);
  assert.ok(conditions().includes("restrained"), "the net did not restrain her");

  const lifted = await turnWith(call("clear_condition", { characterId: kara.id, condition: "restrained", reason: "she heaves it off" }));
  assert.match(lifted.error ?? "", /take_action escape/);
  assert.ok(conditions().includes("restrained"));

  world.dice(4);
  const stuck = await turnWith(call("take_action", { characterId: kara.id, action: "escape" }), "I heave at the net.");
  assert.equal(stuck.success, false, JSON.stringify(stuck));
  assert.ok(conditions().includes("restrained"), "a failed check freed her");

  world.dice(9);
  const free = await turnWith(call("take_action", { characterId: kara.id, action: "escape" }), "I heave again.");
  assert.equal(free.success, true, JSON.stringify(free));
  assert.match(free.check ?? "", /vs DC 10/);
  assert.ok(!conditions().includes("restrained"), "a successful check left her restrained");
});

// What Codex did, twice: the check through request_roll, then
// clear_condition in the same reply. The server's own roll, reaching the
// net's DC, is the escape; a failed one, or a check of another kind, is not.
await test("The net's hold lifts after a server-rolled Athletics check that reaches DC 10, and not after a failed one or a Perception check.", async () => {
  const conditions = () => world.sheet(kara.id).conditions.map((entry) => entry.toLowerCase());
  const athletics = call("request_roll", { characterId: kara.id, kind: "skill_check", skill: "athletics", dc: 10, reason: "heaving the net off" });
  const lift = call("clear_condition", { characterId: kara.id, condition: "restrained", reason: "the net comes off" });
  world.patch(kara.id, { conditions: [], conditionMeta: {} });
  world.dice(15);
  await turnWith(call("apply_hazard", { type: "trap", trap: "Falling Net", characterIds: [kara.id], reason: "the crypt stair" }));
  assert.ok(conditions().includes("restrained"));

  world.dice(3);
  const [, failed] = await turnWithAll([athletics, lift], "I heave at it.");
  assert.match(failed.error ?? "", /take_action escape/, "a failed check lifted the net");
  assert.ok(conditions().includes("restrained"));

  world.dice(18);
  const [, looked] = await turnWithAll(
    [call("request_roll", { characterId: kara.id, kind: "skill_check", skill: "perception", dc: 10, reason: "looking for the net's edge" }), lift],
    "I look for the edge.",
  );
  assert.match(looked.error ?? "", /take_action escape/, "a Perception check lifted the net");

  world.dice(9);
  const [, lifted] = await turnWithAll([athletics, lift], "I heave again.");
  assert.ok(!lifted.error, `a successful check did not lift the net: ${lifted.error}`);
  assert.ok(!conditions().includes("restrained"));
});

await test("Damage to an enemy the model writes as its own number is refused, and the enemy is untouched.", async () => {
  world.patch(kara.id, { conditions: [], conditionMeta: {} });
  await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [kara.id]: 19 }, enemyFace: 1 });
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { maxHp: 7, currentHp: 7 });
  const result = await turnWith(call("damage_enemy", { enemyId: goblin.id, amount: 7, reason: "a lucky stone" }), "I throw a stone.");
  assert.match(result.error ?? "", /Damage is rolled by the server/);
  assert.equal(world.enemies()[0].currentHp, 7);
});

await test("A request_roll the model sends on its turn passes the gate too: an advantage claimed with a reason and no source is asked, and nothing is rolled.", async () => {
  const before = listRecentRolls(world.campaignId, 50).length;
  const result = await turnWith(
    call("request_roll", { kind: "skill_check", characterId: kara.id, skill: "athletics", difficulty: "moderate", advantage: "advantage", advantageReason: "the goblin is tangled in the canvas", reason: "shoving the goblin" }),
    "I shove the goblin.",
  );
  assert.match(result.error ?? "", /names no advantageSource/);
  assert.equal(listRecentRolls(world.campaignId, 50).length, before, "a roll was made past the gate");
});

model.close();
world.close();
finish();
