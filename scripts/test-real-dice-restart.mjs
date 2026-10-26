// A turn parked on a player's physical dice, across a server restart. The
// parked roll's row was already shown to survive a restart
// (test-enforce-persistence), and answering one was tested in a process
// that never restarted (test-enforce-player-word); nothing joined the two.
// That is the case real-dice tables hit: the host restarts the server while
// a player is still finding their d20, and the roll they type afterwards
// has to finish the turn, once, from the conversation the database kept.
//
// The restart closes the database handle (the file stays), wipes the DM's
// per-campaign state a process keeps on globalThis (the queue, the status,
// the turn requests, the narration slots, compaction, the X-card's pause),
// and boots as a new process does, through Next's startup hook
// (src/instrumentation.ts). State a module holds in its own scope (chapter
// pacing, model-client's learned routes) survives this in-process restart,
// so the test shows the database is enough to resume a parked turn, not
// that nothing else outlives a real one. The scripted fake model stands in
// for the backend, which a server restart does not touch.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call as callRoute } from "./lib/enforce-campaign.mjs";
import { call, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-real-dice-restart");

const { getDatabase } = await import("../src/lib/db/core.ts");
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { createDmTurn, createPendingRoll, getDmTurn, getLatestDmTurnId, listOpenPendingRolls, saveDmTurn } = await import(
  "../src/lib/db/dm-turns.ts"
);
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { getDmStatus } = await import("../src/lib/dm/status.ts");
const { dmQueueDepth, pauseDmQueue } = await import("../src/lib/dm/queue.ts");
const { agentTurnFor } = await import("../src/lib/dm/agent-turn.ts");
const { DM_HALTED_PREFIX } = await import("../src/lib/campaign-types.ts");
const { requestDmTurn } = await import("../src/lib/dm/loop.ts");
const { xCardRaised } = await import("../src/lib/dm/safety.ts");
const { register } = await import("../src/instrumentation.ts");

// The startup hook does its server work only in the node runtime.
process.env.NEXT_RUNTIME = "nodejs";

// What a restart takes: the database handle (the file stays, and the next
// query reopens it and runs the boot migrations) and the DM's maps on
// globalThis, which every caller reads afresh, with the flag that says this
// process already ran its restart recovery. Chapter pacing is not wiped
// here: chapter-close.ts keeps its own reference to the map from load time,
// so clearing the global would change nothing.
const IN_MEMORY = [
  "__odmDmQueues",
  "__odmDmDepths",
  "__odmDmDropped",
  "__odmDmPauses",
  "__odmDmStatus",
  "__odmTurnRequested",
  "__odmNarrationSlots",
  "__odmCompaction",
  "__odmDmRecovered",
];
async function restart() {
  getDatabase().close();
  globalThis.__localRoleplayDb = undefined;
  for (const key of IN_MEMORY) {
    globalThis[key] = undefined;
  }
  getDatabase().prepare("SELECT 1").get();
  await register();
}

await test("A roll parked for a player's own dice survives a restart, and the roll they enter afterwards finishes the turn once, from where it stopped.", async () => {
  // A table that lets players roll their own dice, and a player who does.
  const world = await openWorld({ gameSettings: { ttsEnabled: false, dicePolicy: "real_allowed" } });
  const kara = world.addHero({ name: "Kara", class: "fighter", level: 1, abilities: { str: 16 } });
  const userId = world.sheet(kara.id).userId;
  const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");
  const model = await fakeModel();
  model.pointAt(world);
  setMemberRealDice(world.campaignId, userId, true);

  // The DM narrates the setup and asks for the roll in one reply, as real
  // models usually do. That prose was written before the dice, so the turn
  // parks without it and the roll card does the asking (issue #531).
  model.script([
    reply({
      text: "The rusted gate groans and swings for Kara.",
      calls: [call("request_roll", { characterId: kara.id, kind: "saving_throw", ability: "str", dc: 12, reason: "the rusted gate swings at her" })],
    }),
    reply({ text: "Kara braces, and the gate slams against her shield instead of her ribs." }),
  ]);
  const before = await model.turn(world, "I put my shoulder to the crypt gate.", kara.id, userId);
  assert.equal(before, null, "the turn narrated before the roll came in");
  const turnId = getLatestDmTurnId(world.campaignId);
  assert.equal(getDmTurn(turnId).status, "awaiting_rolls");
  assert.equal(getDmStatus(world.campaignId), "awaiting_rolls");
  const [pending] = listOpenPendingRolls(world.campaignId);
  assert.ok(pending, "no roll was parked for Kara's dice");
  assert.equal(model.served(), 1);

  await restart();

  // The new process finds the turn still waiting and the roll still open,
  // and the table still reads as waiting on them.
  assert.equal(getDmTurn(turnId).status, "awaiting_rolls", "the restart lost the waiting turn");
  assert.deepEqual(listOpenPendingRolls(world.campaignId).map((entry) => entry.id), [pending.id]);
  assert.equal(getDmStatus(world.campaignId), "awaiting_rolls", "the restart reset a parked table to idle");

  world.signIn({ id: userId });
  const answered = await callRoute(submitRoute, "POST", { dice: [15] }, { campaignId: world.campaignId, pendingRollId: pending.id });
  assert.equal(answered.status, 200, JSON.stringify(answered.json));
  await settleQueue(world.campaignId);

  assert.equal(getDmTurn(turnId).status, "done", "the turn did not finish after the restart");
  assert.equal(getDmStatus(world.campaignId), "idle");
  assert.deepEqual(listOpenPendingRolls(world.campaignId), []);
  const said = listRecentMessages(world.campaignId, 50).filter((message) => message.authorType === "dm");
  assert.equal(said.length, 1, `expected one narration, found ${said.length}`);
  assert.doesNotMatch(said[0].content, /rusted gate groans/, "the prose written beside the roll reached the table");
  assert.match(said[0].content, /slams against her shield/);

  // It resumed rather than ran again: one more call, carrying the player's roll.
  assert.equal(model.served(), 2, "the turn's first call was made again");
  const results = model.requests
    .at(-1)
    .messages.filter((message) => message.role === "tool")
    .map((message) => JSON.parse(message.content));
  const roll = results.find((result) => result.rolledBy);
  assert.ok(roll, "the resumed call carried no roll result");
  assert.match(roll.rolledBy, /physical dice/, "the model was not told the player rolled it");
  assert.equal(roll.total, 18, "the player's 15 plus Strength 16's +3 did not reach the model");
  assert.equal(roll.success, true);

  // The same roll entered twice changes nothing: it is refused as already
  // resolved, and refused before a second roll row reaches the roll log.
  const rollsBefore = listRecentRolls(world.campaignId, 50).length;
  const twice = await callRoute(submitRoute, "POST", { dice: [15] }, { campaignId: world.campaignId, pendingRollId: pending.id });
  assert.equal(twice.status, 409, JSON.stringify(twice.json));
  assert.equal(listRecentRolls(world.campaignId, 50).length, rollsBefore, "the second submit recorded a roll");
  await settleQueue(world.campaignId);
  assert.equal(listRecentMessages(world.campaignId, 50).filter((message) => message.authorType === "dm").length, 1);
  assert.equal(model.served(), 2);

  setMemberRealDice(world.campaignId, userId, false);
  model.close();
  world.close();
});

// A table with one narration behind it and a turn parked on Kara's own d20.
async function parkedTable(gameSettings = {}) {
  const world = await openWorld({ gameSettings: { ttsEnabled: false, dicePolicy: "real_allowed", ...gameSettings } });
  const kara = world.addHero({ name: "Kara", class: "fighter", level: 1, abilities: { str: 16 } });
  const userId = world.sheet(kara.id).userId;
  const model = await fakeModel();
  model.pointAt(world);
  setMemberRealDice(world.campaignId, userId, true);
  model.script([
    reply({ text: "The crypt is quiet, and the gate is rusted shut." }),
    reply({ calls: [call("request_roll", { characterId: kara.id, kind: "saving_throw", ability: "str", dc: 12, reason: "the gate" })] }),
    reply({ text: "Kara braces, and the gate slams against her shield." }),
  ]);
  await model.turn(world, "I look around.", kara.id, userId);
  await model.turn(world, "I put my shoulder to the crypt gate.", kara.id, userId);
  const turnId = getLatestDmTurnId(world.campaignId);
  assert.equal(getDmTurn(turnId).status, "awaiting_rolls");
  const [pending] = listOpenPendingRolls(world.campaignId);
  assert.ok(pending, "no roll was parked for Kara's dice");
  return { world, kara, userId, model, turnId, pending };
}

// The lead's continue and reroll on the newest narration, as the table's
// buttons send them.
async function extendAndReroll(world) {
  const latest = listRecentMessages(world.campaignId, 50).filter((message) => message.authorType === "dm").at(-1);
  const params = { campaignId: world.campaignId, messageId: latest.id };
  world.signIn(world.owner);
  const extended = await callRoute(await world.route("campaigns/[campaignId]/messages/[messageId]/continue"), "POST", {}, params);
  const rerolled = await callRoute(await world.route("campaigns/[campaignId]/messages/[messageId]/renarrate"), "POST", { action: "reroll" }, params);
  await settleQueue(world.campaignId);
  return [extended.status, rerolled.status];
}

await test("A table parked on physical dice reads as waiting on them after a restart, and continue and reroll refuse as they did before it.", async () => {
  const { world, model } = await parkedTable();
  assert.equal(getDmStatus(world.campaignId), "awaiting_rolls");
  assert.deepEqual(await extendAndReroll(world), [409, 409], "continue or reroll ran while the turn waited on dice");
  await restart();
  assert.equal(getDmStatus(world.campaignId), "awaiting_rolls", "the restart reset a parked table to idle");
  const snapshot = await callRoute(await world.route("campaigns/[campaignId]"), "GET", undefined, { campaignId: world.campaignId });
  assert.equal(snapshot.json.dmStatus, "awaiting_rolls", "a client reloading after the restart lost the waiting status");
  const served = model.served();
  assert.deepEqual(await extendAndReroll(world), [409, 409], "continue or reroll ran while the turn waited on dice");
  assert.equal(model.served(), served, "a model call ran while the turn waited on dice");
  model.close();
  world.close();
});

await test("A parked turn the table walked past reads idle after a restart, as it did before; a person's adjudication after the park does not hide one still waiting.", async () => {
  const { world, kara, userId, model } = await parkedTable();
  // A person's adjudication opens a turn of its own without touching the
  // status line (an opportunity strike, a zone, the console).
  const person = createDmTurn(world.campaignId, [], "human_dm");
  person.status = "done";
  saveDmTurn(person);
  await restart();
  assert.equal(getDmStatus(world.campaignId), "awaiting_rolls", "a person's adjudication hid the parked turn");

  // Kara ignores the roll card and acts instead: the new turn answers her,
  // and the parked one is behind the story.
  model.script([reply({ text: "Kara steps back from the gate and studies the hinges." })]);
  await model.turn(world, "Never mind the gate; I look at the hinges.", kara.id, userId);
  assert.equal(getDmStatus(world.campaignId), "idle");
  assert.deepEqual(await extendAndReroll(world), [200, 200]);
  await restart();
  assert.equal(getDmStatus(world.campaignId), "idle", "the restart put a walked-past roll back on the status line");
  model.script([reply({ text: "The hinges are old iron, flaked with rust." }), reply({ text: "Rust flakes from old iron hinges." })]);
  assert.deepEqual(await extendAndReroll(world), [200, 200], "continue or reroll was refused for a roll the table walked past");

  // A monster pass a person delegated parks on a player's roll without ever
  // owning the line.
  const pass = createDmTurn(world.campaignId, [], "ai");
  createPendingRoll({
    campaignId: world.campaignId,
    turnId: pass.id,
    toolCallId: null,
    userId,
    characterId: kara.id,
    kind: "saving_throw",
    detail: "DEX save",
    expression: "1d20+0",
    advantage: "none",
    dc: 12,
    reason: "the ghoul's claws",
  });
  pass.status = "awaiting_rolls";
  saveDmTurn(pass);
  await restart();
  assert.equal(getDmStatus(world.campaignId), "idle", "a delegated monster pass put itself on the status line");
  model.close();
  world.close();
});

const notices = (world) =>
  listRecentMessages(world.campaignId, 50).filter(
    (message) => message.authorType === "system" && message.content.startsWith(DM_HALTED_PREFIX),
  );

// The last roll goes in while something else holds the DM queue (an Ask, a
// lore check, a chapter closing), so the resume it queues has not run yet.
async function rollWhileQueueHeld(world, userId, pending) {
  const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");
  pauseDmQueue(world.campaignId, "held by another job");
  world.signIn({ id: userId });
  const answered = await callRoute(submitRoute, "POST", { dice: [15] }, { campaignId: world.campaignId, pendingRollId: pending.id });
  assert.equal(answered.status, 200, JSON.stringify(answered.json));
  assert.equal(dmQueueDepth(world.campaignId), 1, "the last roll queued no resume");
}

await test("A turn the restart cut short is halted with the notice that offers Retry, and Retry narrates the player's roll once.", async () => {
  const { world, userId, model, turnId, pending } = await parkedTable();
  await rollWhileQueueHeld(world, userId, pending);
  // The process dies with the turn claimed and its model call in flight:
  // the row still says running, and nothing will ever finish it.
  const claimed = getDmTurn(turnId);
  claimed.status = "running";
  saveDmTurn(claimed);
  const served = model.served();

  await restart();
  assert.equal(getDmTurn(turnId).status, "failed", "the interrupted turn was left running");
  const [notice] = notices(world);
  assert.ok(notice, "the table was not told the DM stopped");
  assert.match(notice.content, /server restarted/);
  assert.equal(notice.dmTurnId, turnId, "the notice does not offer Retry");
  assert.equal(getDmStatus(world.campaignId), "idle");
  assert.equal(model.served(), served, "the boot called the model");

  model.script([reply({ text: "Kara braces, and the gate slams against her shield." })]);
  world.signIn(world.owner);
  const retried = await callRoute(await world.route("campaigns/[campaignId]/dm-turn/retry"), "POST", { turnId }, { campaignId: world.campaignId });
  assert.equal(retried.status, 200, JSON.stringify(retried.json));
  await settleQueue(world.campaignId);
  assert.equal(getDmTurn(turnId).status, "done");
  const said = listRecentMessages(world.campaignId, 50).filter((message) => message.authorType === "dm");
  assert.equal(said.length, 2, `expected the earlier narration and this one, found ${said.length}`);
  assert.match(said.at(-1).content, /slams against her shield/);
  // The roll the player entered reached the model, answered by the retry.
  const roll = model.results(model.requests[0]).map((entry) => entry.result).find((result) => result.rolledBy);
  assert.match(roll?.rolledBy ?? "", /physical dice/, "the retried turn lost the player's roll");
  assert.equal(roll.total, 18);
  model.close();
  world.close();
});

await test("A roll entered while another job held the queue, then a restart: the turn resumes at boot and narrates the roll once.", async () => {
  const { world, userId, model, turnId, pending } = await parkedTable();
  await rollWhileQueueHeld(world, userId, pending);
  const served = model.served();
  await restart();
  await settleQueue(world.campaignId);
  assert.equal(getDmTurn(turnId).status, "done", "the turn sits awaiting rolls with none left to enter");
  assert.equal(model.served(), served + 1, "the resumed turn did not make exactly one call");
  const roll = model.results(model.requests.at(-1)).map((entry) => entry.result).find((result) => result.rolledBy);
  assert.match(roll?.rolledBy ?? "", /physical dice/, "the resumed call lost the player's roll");
  assert.equal(roll.total, 18);
  const said = listRecentMessages(world.campaignId, 50).filter((message) => message.authorType === "dm");
  assert.equal(said.length, 2, `expected the earlier narration and this one, found ${said.length}`);
  assert.match(said.at(-1).content, /slams against her shield/);
  assert.equal(getDmStatus(world.campaignId), "idle");
  // A second boot in the same process changes nothing.
  await register();
  await settleQueue(world.campaignId);
  assert.equal(model.served(), served + 1, "a second boot resumed the turn again");
  model.close();
  world.close();
});

await test("A roll entered under a raised X-card, then a restart: the resume waits at the gate the card left up, and runs once the lead resumes.", async () => {
  const { world, userId, model, turnId, pending } = await parkedTable({ safety: { xCard: true } });
  const params = { campaignId: world.campaignId };
  world.signIn({ id: userId });
  const raised = await callRoute(await world.route("campaigns/[campaignId]/safety/x-card"), "POST", undefined, params);
  assert.equal(raised.status, 200, JSON.stringify(raised.json));
  const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");
  const answered = await callRoute(submitRoute, "POST", { dice: [15] }, { campaignId: world.campaignId, pendingRollId: pending.id });
  assert.equal(answered.status, 200, JSON.stringify(answered.json));
  const served = model.served();

  await restart();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(xCardRaised(world.campaignId), true, "the restart lowered the X-card");
  assert.equal(dmQueueDepth(world.campaignId), 1, "the resume was not queued at the gate");
  assert.equal(model.served(), served, "the DM narrated under a raised X-card");
  assert.equal(getDmTurn(turnId).status, "awaiting_rolls");

  world.signIn(world.owner);
  assert.equal((await callRoute(await world.route("campaigns/[campaignId]/safety/resume"), "POST", { action: "continue" }, params)).status, 200);
  await settleQueue(world.campaignId);
  assert.equal(getDmTurn(turnId).status, "done", "the turn did not resume once the table did");
  assert.match(listRecentMessages(world.campaignId, 50).filter((message) => message.authorType === "dm").at(-1).content, /slams against her shield/);
  model.close();
  world.close();
});

await test("A parked turn the story moved past before the restart is closed at boot, with no model call and no notice, and its roll is not narrated into the later scene.", async () => {
  const { world, kara, userId, model, turnId, pending } = await parkedTable();
  // The roll lands while another job holds the queue, and before its resume
  // runs a newer turn answers Kara's next line.
  await rollWhileQueueHeld(world, userId, pending);
  model.script([reply({ text: "Kara walks on into the crypt." })]);
  await model.turn(world, "I leave the gate and walk on.", kara.id, userId);
  const served = model.served();

  await restart();
  await settleQueue(world.campaignId);
  assert.equal(getDmTurn(turnId).status, "failed", "the stale parked turn was left waiting on dice");
  assert.equal(model.served(), served, "the stale turn was narrated");
  assert.deepEqual(notices(world), [], "the stale turn offered a Retry the story has moved past");
  const said = listRecentMessages(world.campaignId, 50).filter((message) => message.authorType === "dm");
  assert.match(said.at(-1).content, /walks on into the crypt/, "the old roll was narrated after the newer turn");
  model.close();
  world.close();
});

await test("At boot a delegated monster pass the restart cut short is closed without a notice, and an agent program's turn is left to its program.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const pass = createDmTurn(world.campaignId, [], "ai");
  const agent = agentTurnFor(world.campaignId);
  await restart();
  assert.equal(getDmTurn(pass.id).status, "failed", "the dead pass was left running");
  assert.equal(getDmTurn(agent.id).status, "running", "the agent program's turn was taken from it");
  assert.deepEqual(notices(world), [], "a turn with nothing to retry offered Retry");
  world.close();
});

await test("A raised X-card is still raised after a restart: the table's next turn waits at the gate until the story's lead resumes, and a card already resumed stays down.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false, safety: { xCard: true } } });
  const kara = world.addHero({ name: "Kara", class: "fighter", level: 1 });
  const userId = world.sheet(kara.id).userId;
  const model = await fakeModel();
  model.pointAt(world);
  const params = { campaignId: world.campaignId };
  world.signIn({ id: userId });
  assert.equal((await callRoute(await world.route("campaigns/[campaignId]/safety/x-card"), "POST", undefined, params)).status, 200);

  await restart();
  assert.equal(xCardRaised(world.campaignId), true, "the restart lowered the X-card");
  const snapshot = await callRoute(await world.route("campaigns/[campaignId]"), "GET", undefined, params);
  assert.ok(snapshot.json.safetyPause, "a client reloading after the restart no longer sees the X-card");

  model.script([reply({ text: "The fog parts on the far bank, and nothing follows it." })]);
  world.say("player", "I wait for the fog to lift.", world.sheet(kara.id));
  requestDmTurn(world.campaignId);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(dmQueueDepth(world.campaignId), 1, "the turn did not wait at the gate");
  assert.equal(model.served(), 0, "the DM narrated under a raised X-card");

  world.signIn(world.owner);
  assert.equal((await callRoute(await world.route("campaigns/[campaignId]/safety/resume"), "POST", { action: "continue" }, params)).status, 200);
  await settleQueue(world.campaignId);
  assert.equal(model.served(), 1, "the turn did not run once the table resumed");

  await restart();
  assert.equal(xCardRaised(world.campaignId), false, "the restart raised a card the table had already resumed");
  model.close();
  world.close();
});

finish();
